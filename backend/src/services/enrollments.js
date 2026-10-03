import { query, queryAll, queryOne, transaction } from '../config/database.js';
import { notFound, conflict, forbidden, paymentRequired } from '../utils/errors.js';
import { POINTS, awardPoints, syncBadges } from './gamification.js';
import { issueCertificate } from './certificates.js';
import { logger } from '../utils/logger.js';

const ENROLLMENT_CTE = `
  SELECT
    e.id, e.user_id AS "userId", e.course_id AS "courseId",
    e.enrolled_at AS "enrolledAt",
    e.completed_at AS "completedAt",
    e.last_accessed_at AS "lastAccessedAt",
    c.title, c.slug, c.cover_url AS "coverUrl", c.level, c.duration_minutes AS "courseDurationMinutes",
    i.name AS "instructorName",
    cp.total_lessons AS "totalLessons",
    cp.completed_lessons AS "completedLessons",
    cp.progress_percent AS "progressPercent"
  FROM enrollments e
  JOIN courses c ON c.id = e.course_id
  JOIN users i   ON i.id = c.instructor_id
  JOIN course_progress cp ON cp.enrollment_id = e.id
`;

/**
 * Matrícula existente do usuário no curso (ou null).
 *
 * `activeOnly` filtra `canceled` e `refunded`. A linha continua existindo depois
 * de um cancelamento ou reembolso — de propósito, é ela que preserva o progresso
 * caso a pessoa volte — mas existir não é o mesmo que estar matriculado.
 */
export const findEnrollment = (userId, courseId, { activeOnly = false } = {}) =>
  queryOne(
    `SELECT * FROM enrollments
      WHERE user_id = $1 AND course_id = $2${activeOnly ? " AND status = 'active'" : ''}`,
    [userId, courseId],
  );

/**
 * Garante que o usuário esteja matriculado. Chamado pelas rotas de player,
 * progresso e quiz para centralizar a regra de acesso.
 */
export async function assertEnrolled(userId, courseId) {
  const enrollment = await findEnrollment(userId, courseId, { activeOnly: true });
  if (!enrollment) {
    // Distinguir "nunca se matriculou" de "a matrícula foi cancelada" muda o que
    // a tela oferece: no primeiro caso o botão é "matricular-se", no segundo é
    // "reativar". Mandar 402 nos dois casos deixaria a pessoa achando que
    // precisa pagar de novo.
    const previous = await findEnrollment(userId, courseId);
    if (previous) {
      throw forbidden(
        previous.status === 'refunded'
          ? 'Este pedido foi reembolsado, então o acesso às aulas está encerrado.'
          : 'Sua matrícula neste curso está cancelada.',
        { courseId, enrollmentStatus: previous.status },
      );
    }
    throw paymentRequired('Você precisa matricular-se neste curso para acessar as aulas.', {
      courseId,
      hint: 'POST /enrollments (gratuito) ou POST /orders (pago)',
    });
  }
  return enrollment;
}

export async function enrollFree(userId, courseId) {
  const enrollment = await transaction(async (client) => {
    const { rows: courses } = await client.query(
      'SELECT id, title, price_cents, status FROM courses WHERE id = $1 FOR UPDATE',
      [courseId],
    );
    const course = courses[0];
    if (!course) throw notFound('Curso não encontrado.');
    if (course.status !== 'published') throw notFound('Curso indisponível.');
    if (course.price_cents > 0) {
      throw conflict('Este curso é pago. Finalize a compra para se matricular.', {
        courseId,
        priceCents: course.price_cents,
      });
    }

    const { rows: created } = await client.query(
      `INSERT INTO enrollments (user_id, course_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, course_id) DO NOTHING
       RETURNING *`,
      [userId, courseId],
    );
    if (created[0]) {
      await client.query('UPDATE courses SET students_count = students_count + 1 WHERE id = $1', [courseId]);
      return created[0];
    }

    /*
     * Curso gratuito que foi cancelado: matricular-se de novo é gratuito, então
     * não faz sentido manter a pessoa de fora. Mesma reativação do fluxo pago,
     * preservando o progresso. `last_accessed_at` é atualizado porque, para
     * quem está voltando, este é o acesso de agora.
     */
    const { rows: existing } = await client.query(
      `UPDATE enrollments
          SET status           = 'active',
              canceled_at      = NULL,
              canceled_by      = NULL,
              cancel_reason    = NULL,
              last_accessed_at = now()
        WHERE user_id = $1 AND course_id = $2
        RETURNING *`,
      [userId, courseId],
    );
    return existing[0];
  });

  await syncBadges(userId);
  return enrollment;
}

/** Cria a matrícula a partir de um pedido pago. Idempotente por pedido. */
export async function enrollFromOrder({ userId, courseId, orderId }, { client: transactionClient } = {}) {
  const createEnrollment = async (client) => {
    const { rows: created } = await client.query(
      `INSERT INTO enrollments (user_id, course_id, order_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, course_id) DO NOTHING
       RETURNING *`,
      [userId, courseId, orderId],
    );
    if (created[0]) {
      await client.query('UPDATE courses SET students_count = students_count + 1 WHERE id = $1', [courseId]);
      return { enrollment: created[0], reactivated: false };
    }

    /*
     * A linha já existe, e aí está o bug que esta função corrigia mal: um
     * simples `order_id = coalesce(...)` devolvia a matrícula no estado em que
     * estava. Se ela vinha de um reembolso (`refunded`), o aluno pagava de novo
     * e continuava sem acesso, porque `assertEnrolled` só aceita `active`.
     *
     * Por isso a reativação acontece aqui, e não só no painel: comprar é o que
     * justifica o acesso. Vale para `refunded` e para `canceled` (quem cancelou
     * e voltou a pagar precisa entrar).
     *
     * `students_count` não volta a ser incrementado porque a linha nunca deixou
     * de existir, e `last_accessed_at` fica intacto para o histórico de quando
     * a pessoa parou.
     */
    const { rows: previous } = await client.query(
      'SELECT status FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [userId, courseId],
    );
    const previousStatus = previous[0]?.status ?? 'active';

    /*
     * `order_id` passa a ser o pedido ATUAL, e não o primeiro (`coalesce`).
     * Mantendo o antigo, a matrícula ficava ligada ao pedido reembolsado, e o
     * pagamento novo — o que realmente deu direito ao acesso — não aparecia em
     * lugar nenhum. A reativação é a única situação em que isto muda: o
     * webhook repetido do MESMO pedido entra pelo `alreadyPaid` e nem chega
     * aqui, então não há risco de a linha ficar saltando entre pedidos.
     */
    const { rows: updated } = await client.query(
      `UPDATE enrollments
          SET status        = 'active',
              order_id      = $3,
              canceled_at   = NULL,
              canceled_by   = NULL,
              cancel_reason = NULL
        WHERE user_id = $1 AND course_id = $2
        RETURNING *`,
      [userId, courseId, orderId],
    );
    const enrollment = updated[0];
    if (!enrollment) throw notFound('Matrícula não encontrada.');

    return { enrollment, reactivated: previousStatus !== 'active', previousStatus };
  };

  const outcome = transactionClient
    ? await createEnrollment(transactionClient)
    : await transaction(createEnrollment);
  if (!transactionClient) await syncBadges(userId);
  return outcome;
}

export async function listEnrollments(userId, { status = 'all' } = {}) {
  const filter = {
    all: '',
    in_progress: 'AND e.completed_at IS NULL',
    completed: 'AND e.completed_at IS NOT NULL',
  }[status];

  const rows = await queryAll(`${ENROLLMENT_CTE} WHERE e.user_id = $1 ${filter} ORDER BY e.last_accessed_at DESC`, [
    userId,
  ]);
  return rows;
}

export const getEnrollment = async (userId, courseId) => {
  const row = await queryOne(`${ENROLLMENT_CTE} WHERE e.user_id = $1 AND e.course_id = $2`, [userId, courseId]);
  if (!row) throw notFound('Matrícula não encontrada.');
  return row;
};

/* ------------------------------------------------------------------ *
 * Regras de conclusão
 *
 * Concluir uma aula destrava pontos e, fechando o curso, um certificado.
 * Se o campo `completed` viesse do navegador sem conferência, bastava um
 * script mandando `completed: true` em todas as aulas para obter o
 * certificado sem ver nada. O servidor passou então a SOMAR o tempo
 * realmente assistido.
 * ------------------------------------------------------------------ */

/** Fração da aula que precisa ser assistida para contar como concluída. */
export const COMPLETION_RATIO = 0.9;

/**
 * Margem sobre o tempo decorrido. O player envia um heartbeat a cada ~15s, com
 * folga de relógio e de agendamento; sem essa margem, um heartbeat atrasado
 * seria contado como se o aluno tivesse parado de ver.
 */
const HEARTBEAT_SLACK_SECONDS = 30;

/**
 * Multiplicador do tempo real. Alguém assistindo a 2x chega a 2x do conteúdo em
 * metade do tempo, e isso é legítimo. Acima disso passamos a exigir que o
 * heartbeat seja mais frequente, o que na prática só acontece com um vídeo em
 * reprodução normal.
 */
const MAX_PLAYBACK_RATE = 2;

/** Abaixo disto o avanço é ruído de arredondamento, não progresso real. */
const MIN_HEARTBEAT_GAIN = 1;

/**
 * Quanto tempo assistido vale esta atualização, a partir do que o navegador
 * informou e do que já sabíamos.
 *
 *   * `elapsed`  = segundos transcorridos desde o heartbeat anterior;
 *   * `advanced` = quanto o vídeo andou nesse intervalo.
 *
 * A auditoria fica em `min(advanced, elapsed * MAX_PLAYBACK_RATE)`, com uma
 * folga de relógio. É isso que torna `completed: true` inútil para forjar: o
 * jogador pode afirmar o que quiser, mas o que CRESCE no banco é o avanço
 * limitado pelo tempo que passou. Um `seek` para o fim, por mais que seja
 * instantâneo, credita no máximo a folga de um heartbeat.
 *
 * @returns {{ credit: number, reset: boolean }} segundos a somar e se o
 *   cliente voltou para trás (o que zera a contagem do próximo avanço).
 */
function creditForHeartbeat({ previous, positionSeconds, now = new Date() }) {
  // Primeira atualização desta aula (ou recomeço): não há com o que comparar,
  // então nada é creditado. O crédito começa do segundo heartbeat.
  if (!previous?.last_reported_at) {
    return { credit: 0, reset: true };
  }

  const elapsed = Math.floor((now.getTime() - new Date(previous.last_reported_at).getTime()) / 1000);
  if (elapsed <= 0) return { credit: 0, reset: false };

  // Voltou para trás (seek para o início, troca de aula, recarregar a página):
  // o próximo avanço parte de uma nova base, senão a posição antiga continuaria
  // valendo e um rewatch inteiro contaria duas vezes.
  const previousPosition = previous.last_reported_position ?? 0;
  if (positionSeconds < previousPosition) return { credit: 0, reset: true };

  const advanced = positionSeconds - previousPosition;
  if (advanced < MIN_HEARTBEAT_GAIN) return { credit: 0, reset: false };

  const allowed = elapsed * MAX_PLAYBACK_RATE + HEARTBEAT_SLACK_SECONDS;
  return { credit: Math.max(0, Math.min(advanced, allowed)), reset: false };
}

/**
 * Conclusão de uma aula de vídeo: exige tempo assistido de verdade.
 *
 * `watchedSeconds` nunca passa da duração, então repetir a mesma aula não
 * acumula crédito extra.
 */
const videoCompletion = (lesson, watchedSeconds) =>
  lesson.duration_seconds > 0 && watchedSeconds >= lesson.duration_seconds * COMPLETION_RATIO;

/**
 * Registra/sincroniza o progresso de uma aula e, se for a última, fecha o
 * curso: credita o bônus, avalia badges e emite o certificado.
 *
 * O que o navegador manda é tratado como *relato*, não como prova: `completed`
 * só vale para os tipos de aula em que não há tempo a medir, e `positionSeconds`
 * só vira tempo assistido na proporção do que o vídeo realmente avançou.
 *
 * @returns {{ progress: object, courseCompleted: boolean, newBadges: object[] }}
 */
export async function saveLessonProgress(userId, lessonId, { positionSeconds, completed }) {
  const lesson = await queryOne(
    `SELECT l.id, l.title, l.type, l.duration_seconds, l.video_url, l.module_id, m.course_id
       FROM lessons l JOIN modules m ON m.id = l.module_id
      WHERE l.id = $1`,
    [lessonId],
  );
  if (!lesson) throw notFound('Aula não encontrada.');

  const enrollment = await assertEnrolled(userId, lesson.course_id);

  const reportedPosition = Math.max(0, Math.floor(positionSeconds ?? 0));
  const previous = await queryOne(
    `SELECT watched_seconds, last_reported_position, last_reported_at
       FROM lesson_progress WHERE enrollment_id = $1 AND lesson_id = $2`,
    [enrollment.id, lessonId],
  );

  // Aula de quiz não tem tempo a medir: quem responde é o `submitAttempt`.
  const isQuiz = lesson.type === 'quiz';
  // Aula sem vídeo real (o modo demonstração do seed) também não tem tempo.
  const hasPlayableVideo = lesson.type === 'video' && Boolean(lesson.video_url);

  const { credit, reset } = isQuiz
    ? { credit: 0, reset: true }
    : creditForHeartbeat({ previous, positionSeconds: reportedPosition });

  const watchedBefore = previous?.watched_seconds ?? 0;
  // Teto na duração: reassistir a mesma aula não gera crédito infinito.
  const watchedAfter = hasPlayableVideo
    ? Math.min(watchedBefore + credit, lesson.duration_seconds)
    : watchedBefore;

  /*
   * Quem pode concluir sem tempo a medir: texto, a demonstração sem vídeo e o
   * quiz (via aprovação). Para vídeo e para a demonstração com arquivo, o
   * `completed: true` do cliente é IGNORADO de propósito — é exatamente o campo
   * que permitia forjar certificados.
   */
  const canCompleteManually = isQuiz || lesson.type === 'text' || !hasPlayableVideo;
  const autoCompleted = isQuiz ? false : hasPlayableVideo && videoCompletion(lesson, watchedAfter);
  const isCompleted = canCompleteManually ? completed === true || autoCompleted : autoCompleted;

  const { rows } = await query(
    `INSERT INTO lesson_progress
       (enrollment_id, lesson_id, position_seconds, completed, completed_at, last_watched_at,
        watched_seconds, last_reported_position, last_reported_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN now() ELSE NULL END, now(), $5, $6, now())
     ON CONFLICT (enrollment_id, lesson_id) DO UPDATE
       SET position_seconds         = GREATEST(lesson_progress.position_seconds, EXCLUDED.position_seconds),
           completed                = lesson_progress.completed OR EXCLUDED.completed,
           completed_at             = COALESCE(lesson_progress.completed_at, EXCLUDED.completed_at),
           last_watched_at          = now(),
           watched_seconds          = GREATEST(lesson_progress.watched_seconds, EXCLUDED.watched_seconds),
           last_reported_position   = CASE WHEN $7 THEN EXCLUDED.last_reported_position
                                           ELSE GREATEST(lesson_progress.last_reported_position,
                                                         EXCLUDED.last_reported_position) END,
           last_reported_at         = now()
     RETURNING *`,
    [
      enrollment.id,
      lessonId,
      reportedPosition,
      isCompleted,
      watchedAfter,
      reportedPosition,
      reset,
    ],
  );

  const progress = rows[0];
  await query('UPDATE enrollments SET last_accessed_at = now() WHERE id = $1', [enrollment.id]);

  // Pontos por aula (idempotente via ref_id = lesson_progress.id).
  if (progress.completed) {
    await awardPoints(null, {
      userId,
      points: POINTS['lesson.completed'],
      reason: 'lesson.completed',
      refType: 'lesson_progress',
      refId: progress.id,
    });
  }

  const summary = await getCourseProgress(userId, lesson.course_id);
  let courseCompleted = false;
  const newBadges = [];

  if (summary.totalLessons > 0 && summary.completedLessons >= summary.totalLessons && !summary.completedAt) {
    courseCompleted = true;
    newBadges.push(...(await completeCourse(userId, lesson.course_id)));
  }

  return {
    progress,
    courseCompleted,
    newBadges,
    summary,
    // O player usa isto para mostrar quanto falta e para não anunciar
    // conclusão que o servidor ainda não aceitou.
    completion: {
      required: hasPlayableVideo ? Math.ceil(lesson.duration_seconds * COMPLETION_RATIO) : 0,
      watched: progress.watched_seconds,
      ratio: COMPLETION_RATIO,
      completed: progress.completed,
    },
  };
}

/**
 * Conclui uma aula que não tem tempo a medir (quiz) e fecha o curso se for a
 * última. Usada pelo `submitAttempt` quando o aluno é aprovado.
 *
 * @returns {{ courseCompleted: boolean, newBadges: object[] }}
 */
export async function completeLessonWithoutTime(userId, lessonId) {
  const lesson = await queryOne(
    `SELECT l.id, m.course_id
       FROM lessons l JOIN modules m ON m.id = l.module_id
      WHERE l.id = $1`,
    [lessonId],
  );
  if (!lesson) throw notFound('Aula não encontrada.');

  const enrollment = await assertEnrolled(userId, lesson.course_id);

  const { rows } = await query(
    `INSERT INTO lesson_progress
       (enrollment_id, lesson_id, completed, completed_at, last_watched_at)
     VALUES ($1, $2, true, now(), now())
     ON CONFLICT (enrollment_id, lesson_id) DO UPDATE
       SET completed       = true,
           completed_at    = COALESCE(lesson_progress.completed_at, now()),
           last_watched_at = now()
     RETURNING *`,
    [enrollment.id, lessonId],
  );

  const progress = rows[0];
  await query('UPDATE enrollments SET last_accessed_at = now() WHERE id = $1', [enrollment.id]);
  await awardPoints(null, {
    userId,
    points: POINTS['lesson.completed'],
    reason: 'lesson.completed',
    refType: 'lesson_progress',
    refId: progress.id,
  });

  const summary = await getCourseProgress(userId, lesson.course_id);
  let courseCompleted = false;
  const newBadges = [];

  if (summary.totalLessons > 0 && summary.completedLessons >= summary.totalLessons && !summary.completedAt) {
    courseCompleted = true;
    newBadges.push(...(await completeCourse(userId, lesson.course_id)));
  }

  return { courseCompleted, newBadges };
}

/** Fecha o curso: bônus de pontos + certificado + badges. */
export async function completeCourse(userId, courseId) {
  await query('UPDATE enrollments SET completed_at = now() WHERE user_id = $1 AND course_id = $2 AND completed_at IS NULL', [
    userId,
    courseId,
  ]);

  const enrollment = await findEnrollment(userId, courseId);
  if (enrollment) {
    await awardPoints(null, {
      userId,
      points: POINTS['course.completed'],
      reason: 'course.completed',
      refType: 'enrollment',
      refId: enrollment.id,
    });
  }

  const newBadges = await syncBadges(userId);

  // Certificado só para cursos com a opção habilitada.
  const course = await queryOne('SELECT certificate_enabled FROM courses WHERE id = $1', [courseId]);
  if (course?.certificate_enabled) {
    /*
     * Uma falha aqui NÃO pode derrubar a conclusão do curso: o aluno concluiu,
     * ganhou os pontos e o erro é de emissão (não estar 100% ainda, curso com
     * certificado desligado, corrida). O `.catch(() => null)` anterior
     * engolia tudo sem deixar rastro — o aluno ficava sem certificado e sem
     * nenhum log para investigar. Agora o motivo fica registrado e o aluno pode
     * pedir a emissão pela tela.
     */
    try {
      await issueCertificate(userId, courseId);
    } catch (err) {
      logger.warn(
        { err: err.message, userId, courseId },
        'Curso concluído, mas o certificado não foi emitido',
      );
    }
  }

  return newBadges.map((b) => ({ key: b.key, name: b.name, icon: b.icon }));
}

export async function getCourseProgress(userId, courseId) {
  const row = await queryOne(
    `SELECT cp.total_lessons AS "totalLessons",
            cp.completed_lessons AS "completedLessons",
            cp.progress_percent AS "progressPercent",
            cp.completed_at AS "completedAt",
            cp.last_accessed_at AS "lastAccessedAt"
       FROM course_progress cp
       JOIN enrollments e ON e.id = cp.enrollment_id
      WHERE e.user_id = $1 AND e.course_id = $2`,
    [userId, courseId],
  );
  if (!row) throw notFound('Matrícula não encontrada.');
  return row;
}

/**
 * Estrutura completa do curso (módulos + aulas) já combinada com o progresso
 * do aluno e com o estado de bloqueio de cada aula.
 */
export async function getCourseOutline(userId, courseId) {
  const course = await queryOne(
    `SELECT c.id, c.title, c.slug, c.subtitle, c.level, c.status,
            c.certificate_enabled AS "certificateEnabled",
            c.duration_minutes AS "durationMinutes",
            i.name AS "instructorName"
       FROM courses c JOIN users i ON i.id = c.instructor_id
      WHERE c.id = $1`,
    [courseId],
  );
  if (!course) throw notFound('Curso não encontrado.');

  const enrollment = userId ? await findEnrollment(userId, courseId) : null;

  const lessons = await queryAll(
    `SELECT l.id, l.module_id AS "moduleId", l.title, l.type, l.position,
            l.duration_seconds AS "durationSeconds",
            l.is_preview AS "isPreview",
            l.video_url AS "videoUrl",
            l.content,
            lp.position_seconds AS "lastPosition",
            (COALESCE(lp.watched_seconds, 0)) AS "watchedSeconds",
            (COALESCE(lp.completed, false)) AS completed
       FROM lessons l
       JOIN modules m ON m.id = l.module_id
       LEFT JOIN lesson_progress lp
         ON lp.lesson_id = l.id AND lp.enrollment_id = $2
      WHERE m.course_id = $1
      ORDER BY m.position, l.position`,
    [courseId, enrollment?.id ?? null],
  );

  const modules = await queryAll(
    'SELECT id, title, description, position FROM modules WHERE course_id = $1 ORDER BY position',
    [courseId],
  );

  const hasAccess = Boolean(enrollment);
  const shaped = modules.map((m) => ({
    ...m,
    lessons: lessons
      .filter((l) => l.moduleId === m.id)
      .map((l) => ({
        ...l,
        // Vídeo e texto ficam bloqueados até matricular; preview é público.
        locked: !hasAccess && !l.isPreview,
        videoUrl: l.locked ? null : l.videoUrl,
        content: l.locked ? null : l.content,
        /*
         * O player usa isto para decidir se mostra o botão "Concluir aula".
         * Vídeo com arquivo é medido pelo servidor (tempo assistido), então o
         * botão sumir e quem conclui é o próprio player ao chegar a 90%.
         */
        requiresWatchTime: l.type === 'video' && Boolean(l.videoUrl),
        requiredWatchSeconds: l.durationSeconds > 0
          ? Math.ceil(l.durationSeconds * COMPLETION_RATIO)
          : 0,
      })),
  }));

  return {
    course,
    enrollment,
    modules: shaped,
    totalLessons: lessons.length,
    completedLessons: lessons.filter((l) => l.completed).length,
  };
}
