/**
 * Testes de regressão dos quatro bugs corrigidos.
 *
 *   1. recompra depois de reembolso restaura acesso E certificado
 *   2. contrato do quiz (`prompt` / `passPercent`) bate com o que o player lê
 *   3. `completed: true` no corpo HTTP não conclui vídeo; só tempo assistido
 *   4. o currículo do player expõe o que a barra de tempo assistido precisa
 *
 * Cada teste monta o próprio estado (curso novo publicado, conta nova) em vez
 * de depender de linhas do seed, para poder rodar várias vezes seguidas.
 *
 * Requer o banco migrado e populado (npm run db:reset).
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, queryOne, queryAll } from '../src/config/database.js';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const ORIGIN = API.replace(/\/api\/v1\/?$/, '');
const PASSWORD = 'learnup123';
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const stamp = randomUUID().replace(/-/g, '').slice(0, 10);
const unique = (prefix) => `${prefix}${stamp}${randomUUID().replace(/-/g, '').slice(0, 4)}`;

let server = null;
let adminToken;
let instructorToken;
let studentToken;
let studentId;

/** Duração curta para o heartbeat não exigir minutos de espera real. */
const VIDEO_SECONDS = 120;
/** 90% de 120s = 108s. */
const REQUIRED = Math.ceil(VIDEO_SECONDS * 0.9);

async function reachable() {
  try {
    const res = await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

before(async () => {
  if (!(await reachable())) {
    server = spawn(process.execPath, ['src/server.js'], {
      cwd: rootDir,
      stdio: 'ignore',
      env: { ...process.env, NODE_ENV: 'test', RATE_LIMIT: 'false' },
    });
    let up = false;
    for (let i = 0; i < 40; i += 1) {
      if (await reachable()) {
        up = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!up) {
      server?.kill();
      throw new Error('A API não subiu. Rode "npm run db:reset" antes dos testes.');
    }
  }

  adminToken = await loginAs('admin@learnup.dev');
  instructorToken = await loginAs('bruno@learnup.dev');

  const email = `regressao.${stamp}@learnup.dev`;
  const { status } = await call('POST', '/auth/register', {
    body: { name: 'Aluno Regressão', email, password: 'senha1234', acceptTerms: true },
  });
  assert.equal(status, 201, `cadastro do aluno de teste falhou: ${JSON.stringify(email)}`);
  studentToken = await loginAs(email, 'senha1234');
  studentId = (await loginUser(email, 'senha1234')).id;
});

after(() => {
  server?.kill();
});

async function call(method, path, { body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const asAdmin = (method, path, body) => call(method, path, { token: adminToken, body });
const asStudent = (method, path, body) => call(method, path, { token: studentToken, body });

async function loginAs(email, password = PASSWORD) {
  const { status, data } = await call('POST', '/auth/login', { body: { email, password } });
  assert.equal(status, 200, `login de ${email} falhou`);
  return data.accessToken;
}

async function loginUser(email, password = PASSWORD) {
  const { data } = await call('POST', '/auth/login', { body: { email, password } });
  return data.user;
}

/**
 * Curso novo e publicado, com o currículo pedido. `lessons` recebe a mesma
 * forma que a API de currículo espera.
 */
async function publishedCourse(lessons, overrides = {}) {
  const { status, data } = await call('POST', '/courses', {
    token: instructorToken,
    body: { title: unique('Regressão '), status: 'draft', ...overrides },
  });
  assert.equal(status, 201, `criação do curso falhou: ${JSON.stringify(data)}`);
  const course = data.course;

  assert.equal(
    (await call('PUT', `/courses/${course.id}/curriculum`, {
      token: instructorToken,
      body: { modules: [{ title: 'Módulo 1', lessons }] },
    })).status,
    200,
    'o currículo deveria ter sido salvo',
  );
  assert.equal(
    (await asAdmin('POST', `/admin/courses/${course.id}/publish`, { reason: 'teste' })).status,
    200,
    'o curso deveria ter publicado',
  );
  /*
   * A visão do admin não traz o currículo (ele é salvo e não devolvido), então
   * o id da primeira aula vem direto do banco.
   */
  const row = await queryOne(
    `SELECT l.id FROM lessons l
       JOIN modules m ON m.id = l.module_id
      WHERE m.course_id = $1 ORDER BY m.position, l.position LIMIT 1`,
    [course.id],
  );
  assert.ok(row?.id, 'o currículo salvo devia ter pelo menos uma aula');
  return { ...course, firstLessonId: row.id };
}

const videoLesson = () => ({
  title: 'Aula com vídeo',
  type: 'video',
  durationSeconds: VIDEO_SECONDS,
  videoUrl: 'https://example.test/aula-protegida',
});

const textLesson = () => ({ title: 'Aula de texto', type: 'text', content: 'conteúdo' });

/** Compra pendente e confirmação pelo provedor mock. */
async function buy(courseId) {
  const { status, data } = await asStudent('POST', '/payments/orders', { courseId, method: 'pix' });
  assert.equal(status, 201, `checkout falhou: ${JSON.stringify(data)}`);
  const { status: paid } = await asStudent('POST', `/payments/mock/${data.order.id}/confirm`);
  assert.equal(paid, 200, 'pagamento confirmado');
  return data.order;
}

/*
 * `enrollments` não guarda a percentagem: ela vem de `course_progress`, que é
 * calculada. O JOIN é o que o `enrollmentOf` do admin.test.js também faz.
 */
const enrollmentRow = async (userId, courseId) =>
  queryOne(
    `SELECT e.status, e.completed_at, cp.progress_percent
       FROM enrollments e
       LEFT JOIN course_progress cp ON cp.enrollment_id = e.id
      WHERE e.user_id = $1 AND e.course_id = $2`,
    [userId, courseId],
  );

/**
 * Empurra `seconds` no relógio do servidor.
 *
 * O crédito de tempo assistido é limitado pelo tempo REAL decorrido, para
 * impedir que um `seek` instantâneo conte como minutos de vídeo. O teste
 * precisa então avançar esse relógio, e esperar de verdade deixaria a suíte
 * lenta demais. Rewind é a mesma prova pelo caminho inverso.
 *
 * A linha de progresso é criada se ainda não existir: o primeiro heartbeat
 * é o que estabelece `last_reported_at`, e sem ele não há relógio para reescrever.
 */
async function rewindProgress(seconds, { userId = studentId, courseId, lessonId }) {
  await query(
    `INSERT INTO lesson_progress (enrollment_id, lesson_id, last_reported_at)
     SELECT e.id, $1, now() - make_interval(secs => $4)
       FROM enrollments e
      WHERE e.user_id = $2 AND e.course_id = $3
     ON CONFLICT (enrollment_id, lesson_id) DO UPDATE
        SET last_reported_at = now() - make_interval(secs => $4)`,
    [lessonId, userId, courseId, seconds],
  );
}

/** Um heartbeat: envia a posição depois de o relógio ter corrido `elapsed`. */
async function heartbeat({ courseId, lessonId, positionSeconds, elapsed, completed = false }) {
  await rewindProgress(elapsed, { courseId, lessonId });
  const { status, data } = await asStudent('PUT', `/enrollments/${courseId}/lessons/${lessonId}`, {
    positionSeconds,
    completed,
  });
  assert.equal(status, 200, `progresso falhou: ${JSON.stringify(data)}`);
  return data;
}

// ===========================================================================
// Bug 1 — recompra depois de reembolso
// ===========================================================================

describe('recompra depois de reembolso', () => {
  test('devolve o acesso e o progresso, e o certificado quando o curso já foi concluído', async () => {
    const course = await publishedCourse([textLesson()], {
      priceCents: 3900,
      certificateEnabled: true,
    });
    const lesson = { id: course.firstLessonId };

    const paidOrder = await buy(course.id);

    // Conclui o curso pelo caminho normal (texto aceita conclusão manual).
    const first = await asStudent('PUT', `/enrollments/${course.id}/lessons/${lesson.id}`, {
      positionSeconds: 0,
      completed: true,
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.courseCompleted, true, 'o curso de uma aula só fecha ao concluir a aula');

    const enrollment = await enrollmentRow(studentId, course.id);
    assert.equal(enrollment.status, 'active');
    assert.ok(enrollment.completed_at, 'o curso devia constar como concluído');

    const certBefore = await queryOne(
      'SELECT code, revoked_at FROM certificates WHERE user_id = $1 AND course_id = $2',
      [studentId, course.id],
    );
    assert.ok(certBefore, 'o certificado deveria ter sido emitido na conclusão');
    assert.equal(certBefore.revoked_at, null);

    /*
     * O reembolso é deste primeiro pedido. Tentar um NOVO checkout daria 409,
     * porque a matrícula está ativa — e o caminho certo para o cenário é
     * estornar a compra que já existe, que é o que o admin faria.
     */
    assert.equal(
      (await asAdmin('POST', `/admin/orders/${paidOrder.id}/refund`, { reason: 'arrependimento' })).status,
      200,
      'reembolso falhou',
    );

    assert.notEqual(
      (await enrollmentRow(studentId, course.id)).status,
      'active',
      'o reembolso precisa tirar o acesso',
    );
    const certRefunded = await queryOne(
      'SELECT revoked_at FROM certificates WHERE user_id = $1 AND course_id = $2',
      [studentId, course.id],
    );
    assert.ok(certRefunded.revoked_at, 'o reembolso precisa revogar o certificado');

    /*
     * Recompra. Este é o bug: a matrícula existia com status `refunded`, e a
     * criação do pedido a tratava como acesso válido — então a pessoa pagava de
     * novo e continuava sem acesso.
     */
    const { status: checkoutStatus, data: checkoutData } = await asStudent('POST', '/payments/orders', {
      courseId: course.id,
      method: 'pix',
    });
    assert.equal(
      checkoutStatus,
      201,
      `a recompra tem de ser aceita depois do reembolso: ${JSON.stringify(checkoutData)}`,
    );

    const { status: paidStatus } = await asStudent(
      'POST',
      `/payments/mock/${checkoutData.order.id}/confirm`,
    );
    assert.equal(paidStatus, 200);

    const after = await enrollmentRow(studentId, course.id);
    assert.equal(after.status, 'active', 'a recompra precisa reativar o acesso');
    assert.equal(
      after.progress_percent,
      enrollment.progress_percent,
      'o progresso não pode ser zerado na recompra',
    );

    const outline = await asStudent('GET', `/enrollments/${course.id}/outline`);
    assert.equal(outline.status, 200, 'a pessoa pagou e precisa conseguir abrir as aulas');
    assert.equal(
      outline.data.modules[0].lessons[0].completed,
      true,
      'a aula concluída antes do reembolso continua concluída',
    );

    /*
     * O certificado foi revogado pelo reembolso, então a recompra precisa
     * trazê-lo de volta. O código (link público) é preservado: quem já tinha o
     * link passa a ver um certificado válido, e não um link morto.
     */
    const certAfter = await queryOne(
      'SELECT code, revoked_at, revoked_reason FROM certificates WHERE user_id = $1 AND course_id = $2',
      [studentId, course.id],
    );
    assert.equal(certAfter.revoked_at, null, 'a recompra precisa restaurar o certificado');
    assert.equal(certAfter.revoked_reason, null);
    assert.equal(certAfter.code, certBefore.code, 'o código público do certificado é preservado');

    const listed = await asStudent('GET', '/certificates');
    assert.equal(listed.status, 200);
    assert.ok(
      listed.data.certificates.some((c) => c.courseId === course.id),
      'o certificado restaurado tem de aparecer na lista do aluno',
    );

    /*
     * A matrícula tem de ficar ligada ao pedido que deu direito ao acesso. Com
     * o `coalesce` antigo, a linha continuava apontando para o pedido
     * reembolsado e o pagamento novo não aparecia em lugar nenhum.
     */
    const { rows: linked } = await query(
      'SELECT order_id FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [studentId, course.id],
    );
    assert.equal(linked.length, 1, 'a recompra não pode criar uma segunda matrícula');
    assert.equal(
      linked[0].order_id,
      checkoutData.order.id,
      'a matrícula precisa apontar para o pedido da recompra, não para o reembolsado',
    );
    assert.notEqual(linked[0].order_id, paidOrder.id, 'o vínculo antigo do reembolso tem de ser substituído');
  });

  test('não deixa comprar o mesmo curso duas vezes com acesso já ativo', async () => {
    const course = await publishedCourse([textLesson()], { priceCents: 2900 });
    await buy(course.id);

    const { status } = await asStudent('POST', '/payments/orders', {
      courseId: course.id,
      method: 'pix',
    });
    assert.equal(status, 409, 'com matrícula ativa, nova compra deve ser recusada');
  });

  test('pagamento repetido do mesmo pedido não duplica a matrícula', async () => {
    const course = await publishedCourse([textLesson()], { priceCents: 2900 });
    const { data } = await asStudent('POST', '/payments/orders', {
      courseId: course.id,
      method: 'pix',
    });
    const orderId = data.order.id;

    assert.equal((await asStudent('POST', `/payments/mock/${orderId}/confirm`)).status, 200);
    // O webhook repete a confirmação: é o caso normal de um provider.
    assert.equal((await asStudent('POST', `/payments/mock/${orderId}/confirm`)).status, 200);

    const { rows } = await query(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [studentId, course.id],
    );
    assert.equal(rows.length, 1, 'o webhook repetido não pode criar uma segunda matrícula');
  });
});

// ===========================================================================
// Bug 3 — conclusão de vídeo depende de tempo assistido
// ===========================================================================

describe('tempo assistido de vídeo', () => {
  test('completed: true no corpo não conclui uma aula de vídeo', async () => {
    const course = await publishedCourse([videoLesson()], { priceCents: 3900 });
    const lesson = { id: course.firstLessonId };
    await buy(course.id);

    /*
     * Esta é a requisição que forjava certificado antes: o navegador dizia
     * "acabei" e o servidor acreditava.
     */
    const { status, data } = await asStudent('PUT', `/enrollments/${course.id}/lessons/${lesson.id}`, {
      positionSeconds: VIDEO_SECONDS,
      completed: true,
    });
    assert.equal(status, 200);
    assert.equal(data.progress.completed, false, 'o cliente não pode concluir vídeo sozinho');
    assert.equal(data.completion.completed, false);
    assert.equal(data.completion.required, REQUIRED, 'o player precisa saber o quanto falta');
  });

  test('avançar a posição de uma vez credita no máximo um heartbeat', async () => {
    const course = await publishedCourse([videoLesson()], { priceCents: 3900 });
    const lesson = { id: course.firstLessonId };
    await buy(course.id);

    await asStudent('PUT', `/enrollments/${course.id}/lessons/${lesson.id}`, {
      positionSeconds: 0,
      completed: false,
    });
    // Seek do início ao fim com 1s de relógio: o crédito é a folga de relógio
    // (30s), não os 120s que o vídeo "avançou".
    const seeked = await heartbeat({
      courseId: course.id,
      lessonId: lesson.id,
      positionSeconds: VIDEO_SECONDS,
      elapsed: 1,
    });
    assert.ok(
      seeked.progress.watched_seconds <= 40,
      `um seek instantâneo creditou ${seeked.progress.watched_seconds}s de tempo assistido`,
    );
    assert.equal(
      seeked.progress.completed,
      false,
      `seek não pode concluir: creditou ${seeked.progress.watched_seconds}s de ${REQUIRED}s`,
    );
  });

  test('assISTIR de verdade acumula tempo e conclui aos 90%', async () => {
    const course = await publishedCourse([videoLesson()], { priceCents: 3900 });
    const lesson = { id: course.firstLessonId };
    await buy(course.id);

    // Primeiro heartbeat só estabelece a base de comparação.
    await heartbeat({ courseId: course.id, lessonId: lesson.id, positionSeconds: 0, elapsed: 0 });

    let position = 0;
    let last = null;
    // 6 heartbeats de 20s = 120s de vídeo, bem acima dos 108s exigidos.
    for (let i = 0; i < 6 && !last?.progress?.completed; i += 1) {
      position += 20;
      last = await heartbeat({
        courseId: course.id,
        lessonId: lesson.id,
        positionSeconds: position,
        elapsed: 20,
      });
    }

    assert.equal(
      last.progress.completed,
      true,
      `assistir ${position}s de ${VIDEO_SECONDS}s devia concluir; creditado ${last.progress.watched_seconds}s`,
    );
    assert.ok(last.progress.watched_seconds >= REQUIRED);
    assert.equal(last.completion.completed, true);

    // E a conclusão tem de refletir no progresso do curso.
    const { data: outline } = await asStudent('GET', `/enrollments/${course.id}/outline`);
    assert.equal(outline.modules[0].lessons[0].completed, true);
  });

  test('reassistir a mesma aula não acumula tempo acima da duração', async () => {
    const course = await publishedCourse([videoLesson()], { priceCents: 3900 });
    const lesson = { id: course.firstLessonId };
    await buy(course.id);

    await heartbeat({ courseId: course.id, lessonId: lesson.id, positionSeconds: 0, elapsed: 0 });
    // Volta ao início e reassiste a aula inteira mais uma vez.
    for (let i = 0; i < 12; i += 1) {
      await heartbeat({
        courseId: course.id,
        lessonId: lesson.id,
        positionSeconds: (i % 6) * 20,
        elapsed: 20,
      });
    }

    const row = await queryOne(
      `SELECT watched_seconds FROM lesson_progress lp
         JOIN enrollments e ON e.id = lp.enrollment_id
        WHERE e.user_id = $1 AND lp.lesson_id = $2`,
      [studentId, lesson.id],
    );
    assert.ok(
      row.watched_seconds <= VIDEO_SECONDS,
      `o tempo assistido passou da duração da aula: ${row.watched_seconds}s`,
    );
  });

  test('texto continua aceitando conclusão manual', async () => {
    const course = await publishedCourse([textLesson()], { priceCents: 3900 });
    const lesson = { id: course.firstLessonId };
    await buy(course.id);

    const { status, data } = await asStudent('PUT', `/enrollments/${course.id}/lessons/${lesson.id}`, {
      positionSeconds: 0,
      completed: true,
    });
    assert.equal(status, 200);
    assert.equal(data.progress.completed, true, 'texto não tem tempo a medir e deve concluir na mão');
  });

  test('o currículo informa o player de que a aula exige tempo assistido', async () => {
    const course = await publishedCourse([videoLesson(), textLesson()], { priceCents: 3900 });
    await buy(course.id);

    const { status, data } = await asStudent('GET', `/enrollments/${course.id}/outline`);
    assert.equal(status, 200);
    const [video, text] = data.modules[0].lessons;

    assert.equal(video.requiresWatchTime, true, 'vídeo com arquivo precisa de tempo assistido');
    assert.equal(video.requiredWatchSeconds, REQUIRED);
    assert.equal(typeof video.watchedSeconds, 'number', 'o player precisa do tempo já creditado');

    assert.equal(text.requiresWatchTime, false, 'texto não é medido por tempo');
    assert.equal(text.requiredWatchSeconds, 0);
  });
});

// ===========================================================================
// Bug 2 — contrato do quiz
// ===========================================================================

/*
 * Não existe rota para criar quiz: os questionários vêm do seed. O teste usa
 * um curso pago do seed que tenha aula de quiz e compra nele, e confere o
 * contrato que o player consome.
 */
describe('contrato do quiz', () => {
  let ctx = null;

  async function setup() {
    if (ctx) return ctx;

    const { data: catalog } = await asStudent('GET', '/courses');
    let found = null;
    /*
     * O `outline` responde 403 sem matrícula, então o curso com quiz é
     * descoberto pelo detalhe público (que traz `type` por aula) e só depois
     * é comprado.
     */
    for (const c of catalog.courses.filter((x) => x.priceCents > 0)) {
      const { status, data } = await asStudent('GET', `/courses/${c.id}`);
      if (status !== 200) continue;
      const quizLesson = (data.course.modules ?? [])
        .flatMap((m) => m.lessons ?? [])
        .find((l) => l.type === 'quiz');
      if (quizLesson) {
        found = { course: c, lessonId: quizLesson.id };
        break;
      }
    }
    assert.ok(found, 'o seed precisa de um curso pago com aula de quiz');

    await buy(found.course.id);
    ctx = found;
    return ctx;
  }

  test('o player recebe prompt e passPercent, os campos que ele lê', async () => {
    const { lessonId } = await setup();

    const { status, data } = await asStudent('GET', `/quizzes/lessons/${lessonId}`);
    assert.equal(status, 200);
    const quiz = data.quiz;

    /*
     * O frontend lia `q.stem` e `quiz.passScore`, campos que a API nunca
     * devolveu: o enunciado de cada pergunta aparecia em branco e a nota
     * mínima caía no 70 padrão, mentindo sobre a regra do quiz.
     */
    assert.equal(typeof quiz.passPercent, 'number', 'a nota mínima precisa vir da API');
    assert.equal(quiz.passScore, undefined, 'o nome antigo não pode voltar a aparecer');
    assert.ok(quiz.questions.length > 0, 'o quiz do seed tem perguntas');
    for (const q of quiz.questions) {
      assert.equal(typeof q.prompt, 'string', 'o enunciado tem de vir em `prompt`');
      assert.ok(q.prompt.length > 0, 'o enunciado não pode chegar vazio');
      assert.equal(q.stem, undefined, 'o nome antigo não pode voltar a aparecer');
      assert.ok(q.options.length >= 2, 'toda pergunta precisa de alternativas');
    }
  });

  test('aprovar o quiz conclui a aula de quiz', async () => {
    const { course, lessonId } = await setup();

    const before = await asStudent('GET', `/enrollments/${course.id}/outline`);
    const wasCompleted =
      before.data.modules.flatMap((m) => m.lessons).find((l) => l.id === lessonId)?.completed;

    /*
     * O gabarito não é exposto ao aluno (é justamente o que o teste anterior
     * confere), então o teste lê do banco. São TODAS as perguntas: responder
     * só uma daria nota baixa e o teste não provaria nada sobre a aprovação.
     */
    const answers = await queryAll(
      `SELECT qq.id AS question_id, o.id AS option_id
         FROM quizzes q
         JOIN quiz_questions qq ON qq.quiz_id = q.id
         JOIN quiz_options o ON o.question_id = qq.id AND o.is_correct
        WHERE q.lesson_id = $1
        ORDER BY qq.position`,
      [lessonId],
    );
    assert.ok(answers.length > 0, 'o quiz do seed precisa de alternativas corretas');
    const payload = answers.map((a) => ({ questionId: a.question_id, optionId: a.option_id }));

    const { status, data } = await asStudent('POST', `/quizzes/lessons/${lessonId}/attempts`, {
      answers: payload,
    });
    // A rota responde 200, não 201: a tentativa é um recurso já existente que
    // recebe uma resposta nova, não um recurso novo.
    assert.equal(status, 200, `tentativa falhou: ${JSON.stringify(data)}`);
    assert.equal(data.passed, true, 'acertar tudo tem de aprovar');
    assert.equal(data.scorePercent, 100);

    /*
     * Antes, responder certo não marcava a aula: o quiz só credava pontos e a
     * aula ficava pendente para sempre, então um curso que terminava em quiz
     * nunca fechava e o certificado não saía.
     */
    const row = await queryOne(
      `SELECT lp.completed FROM lesson_progress lp
         JOIN enrollments e ON e.id = lp.enrollment_id
        WHERE e.user_id = $1 AND lp.lesson_id = $2`,
      [studentId, lessonId],
    );
    assert.equal(
      row?.completed,
      true,
      `aprovar o quiz tem de concluir a aula (antes=${wasCompleted})`,
    );
  });
});
