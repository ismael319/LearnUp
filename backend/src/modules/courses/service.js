import { z } from 'zod';
import { query, queryAll, queryOne, transaction } from '../../config/database.js';
import { notFound, badRequest, forbidden } from '../../utils/errors.js';
import { booleanFlag } from '../../utils/helpers.js';
import { paginatedMeta } from '../../middleware/pagination.js';
import { findEnrollment } from '../../services/enrollments.js';

export const catalogQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  instructor: z.string().uuid().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  free: booleanFlag(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc', 'rating', 'popular']).default('relevance'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(12),
});

const SORTS = {
  relevance: 'c.students_count DESC, c.rating_avg DESC',
  newest: 'c.published_at DESC NULLS LAST',
  price_asc: 'c.price_cents ASC',
  price_desc: 'c.price_cents DESC',
  rating: 'c.rating_avg DESC, c.rating_count DESC',
  popular: 'c.students_count DESC',
};

const COURSE_CARD = `
  c.id, c.title, c.slug, c.subtitle, c.cover_url AS "coverUrl",
  c.level, c.price_cents AS "priceCents",
  c.original_price_cents AS "originalPriceCents",
  c.duration_minutes AS "durationMinutes",
  c.rating_avg::float8 AS "ratingAvg", c.rating_count AS "ratingCount",
  c.students_count AS "studentsCount",
  c.published_at AS "publishedAt",
  cat.name AS "categoryName", cat.slug AS "categorySlug",
  u.id AS "instructorId", u.name AS "instructorName"
`;

/**
 * Catálogo com filtros combináveis. Monta o WHERE dinamicamente com
 * placeholders parametrizados ($1, $2, ...) — nunca interpola valor do
 * usuário na string SQL.
 */
export async function listCourses(filters, userId) {
  const values = [];
  const where = [`c.status = 'published'`];
  const add = (sql, value) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };

  if (filters.search) {
    values.push(filters.search);
    const p = `$${values.length}`;
    // `unaccent_immutable` nos dois lados: o termo digitado e o documento indexado.
    where.push(
      `(to_tsvector('portuguese', unaccent_immutable(coalesce(c.title,'') || ' ' || coalesce(c.subtitle,'') || ' ' || coalesce(c.description,'')))
          @@ plainto_tsquery('portuguese', unaccent_immutable(${p}))
        OR unaccent_immutable(c.title) ILIKE '%' || unaccent_immutable(${p}) || '%')`,
    );
  }
  if (filters.category) add('cat.slug = ?', filters.category);
  if (filters.level) add('c.level = ?', filters.level);
  if (filters.instructor) add('c.instructor_id = ?', filters.instructor);
  if (filters.free) where.push('c.price_cents = 0');
  if (filters.minPrice != null) add('c.price_cents >= ?', filters.minPrice);
  if (filters.maxPrice != null) add('c.price_cents <= ?', filters.maxPrice);

  const from = `
    FROM courses c
    LEFT JOIN categories cat ON cat.id = c.category_id
    JOIN users u ON u.id = c.instructor_id
    WHERE ${where.join(' AND ')}
  `;

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total ${from}`,
    values,
  );
  const total = countRows[0].total;

  const limit = filters.limit;
  const offset = (filters.page - 1) * limit;
  const rows = await queryAll(
    `SELECT ${COURSE_CARD} ${from} ORDER BY ${SORTS[filters.sort]} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );

  // Marca quais cursos o usuário já possui (badge "matriculado" no card).
  let enrolledIds = new Set();
  if (userId && rows.length) {
    const { rows: er } = await query(
      'SELECT course_id FROM enrollments WHERE user_id = $1 AND course_id = ANY($2::uuid[])',
      [userId, rows.map((r) => r.id)],
    );
    enrolledIds = new Set(er.map((r) => r.course_id));
  }

  return {
    courses: rows.map((r) => ({ ...r, enrolled: enrolledIds.has(r.id) })),
    meta: paginatedMeta({ page: filters.page, limit, total }),
  };
}

export const listCategories = () =>
  queryAll(
    `SELECT cat.id, cat.name, cat.slug, cat.icon,
            count(c.id) FILTER (WHERE c.status = 'published')::int AS "courseCount"
       FROM categories cat
       LEFT JOIN courses c ON c.category_id = cat.id
      GROUP BY cat.id
      ORDER BY cat.name`,
  );

/**
 * `courses.id` é uuid e `courses.slug` é text. Se a mesma cláusula tentasse
 * comparar os dois com o mesmo placeholder ($1), o Postgres inferiria $1 como
 * uuid a partir da primeira comparação e a segunda estouraria com
 * `operator does not exist: text = uuid`. Então o formato do identificador
 * é conferido em JS e só a coluna certa é consultada.
 */
function courseKeyColumn(identifier, alias = 'c') {
  return /^[0-9a-f-]{36}$/i.test(String(identifier)) ? `${alias}.id = $1` : `${alias}.slug = $1`;
}

async function loadCourse(identifier) {
  const byId = /^[0-9a-f-]{36}$/i.test(identifier);
  return queryOne(
    `SELECT ${COURSE_CARD},
            c.description, c.status,
            c.certificate_enabled AS "certificateEnabled",
            c.instructor_id AS "instructorId",
            u.avatar_url AS "instructorAvatarUrl", u.bio AS "instructorBio"
       FROM courses c
       LEFT JOIN categories cat ON cat.id = c.category_id
       JOIN users u ON u.id = c.instructor_id
       WHERE ${byId ? 'c.id = $1' : 'c.slug = $1'}
         AND c.status = 'published'`,
    [identifier],
  );
}

/** Detalhe do curso + se o usuário está matriculado. */
export async function getCourseDetail(identifier, userId) {
  const course = await loadCourse(identifier);
  if (!course) throw notFound('Curso não encontrado.');

  const enrollment = userId ? await findEnrollment(userId, course.id) : null;

  const { rows: moduleRows } = await query(
    `SELECT m.id, m.title, m.description, m.position,
            (SELECT count(*) FROM lessons l WHERE l.module_id = m.id)::int AS "lessonCount",
            (SELECT coalesce(sum(l.duration_seconds), 0) FROM lessons l WHERE l.module_id = m.id)::int
              AS "durationSeconds"
       FROM modules m WHERE m.course_id = $1 ORDER BY m.position`,
    [course.id],
  );

  // O catálogo público recebe somente metadados para montar a ementa. URLs e
  // conteúdo das aulas continuam exclusivos da rota autenticada de player.
  const lessons = await queryAll(
    `SELECT l.id, l.module_id AS "moduleId", l.title, l.type, l.position,
            l.duration_seconds AS "durationSeconds", l.is_preview AS "isPreview"
       FROM lessons l
       JOIN modules m ON m.id = l.module_id
      WHERE m.course_id = $1
      ORDER BY m.position, l.position`,
    [course.id],
  );

  const lessonsByModule = new Map();
  for (const lesson of lessons) {
    const { moduleId, ...publicLesson } = lesson;
    const moduleLessons = lessonsByModule.get(moduleId) ?? [];
    moduleLessons.push(publicLesson);
    lessonsByModule.set(moduleId, moduleLessons);
  }
  const modules = moduleRows.map((module) => ({
    ...module,
    lessons: lessonsByModule.get(module.id) ?? [],
  }));
  const previews = lessons
    .filter((lesson) => lesson.isPreview)
    .map(({ moduleId, ...lesson }) => ({
      ...lesson,
      moduleTitle: moduleRows.find((module) => module.id === moduleId)?.title ?? null,
    }));

  return {
    ...course,
    modules,
    previewLessons: previews,
    enrolled: Boolean(enrollment),
    enrollment: enrollment ?? null,
    canPreview: previews.length > 0,
  };
}

export const listReviews = (courseId) =>
  queryAll(
    `SELECT r.id, r.rating, r.comment, r.created_at AS "createdAt",
            u.name AS "userName", u.avatar_url AS "avatarUrl"
       FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE r.course_id = $1 AND r.hidden_at IS NULL
      ORDER BY r.created_at DESC LIMIT 20`,
    [courseId],
  );

/**
 * Recalcula média e contagem de um curso a partir das avaliações VISÍVEIS.
 *
 * Fica exportado porque a regra "avaliação oculta não conta" precisa ser a mesma
 * em todo lugar: ao criar uma avaliação e ao ocultá-la pelo painel. Se cada
 * chamada escrevesse o próprio SQL, a moderação passaria a usar um filtro
 * diferente e a nota do curso ficaria inconsistente com o que aparece na página.
 */
export const recomputeCourseRating = (courseId) =>
  query(
    `UPDATE courses c
        SET rating_avg = coalesce((SELECT round(avg(rating)::numeric, 2) FROM reviews
                                   WHERE course_id = c.id AND hidden_at IS NULL), 0),
            rating_count = (SELECT count(*) FROM reviews
                             WHERE course_id = c.id AND hidden_at IS NULL)
      WHERE c.id = $1`,
    [courseId],
  );

export async function createReview(userId, courseId, { rating, comment }) {
  const { rows } = await query(
    `INSERT INTO reviews (course_id, user_id, rating, comment)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (course_id, user_id) DO UPDATE
       SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, hidden_at = NULL, hidden_by = NULL
     RETURNING id, rating, comment, created_at AS "createdAt"`,
    [courseId, userId, rating, comment ?? null],
  );

  await recomputeCourseRating(courseId);
  return rows[0];
}

/** Cursos relacionados (mesma categoria, excluindo o próprio). */
export const relatedCourses = async (courseId, limit = 4) => {
  const { rows } = await query(
    `SELECT ${COURSE_CARD}
       FROM courses c
       LEFT JOIN categories cat ON cat.id = c.category_id
       JOIN users u ON u.id = c.instructor_id
      WHERE c.status = 'published'
        AND c.id <> $1
        AND c.category_id = (SELECT category_id FROM courses WHERE id = $1)
      ORDER BY c.students_count DESC
      LIMIT $2`,
    [courseId, limit],
  );
  return rows;
};

export const listInstructors = () =>
  queryAll(
    `SELECT u.id, u.name, u.avatar_url AS "avatarUrl", u.bio,
            count(c.id)::int AS "courseCount"
       FROM users u
       LEFT JOIN courses c ON c.instructor_id = u.id AND c.status = 'published'
      WHERE u.role IN ('instructor', 'admin')
      GROUP BY u.id
      ORDER BY "courseCount" DESC, u.name`,
  );

/**
 * Status que o instrutor pode gravar sozinho.
 *
 * `published` e `archived` são decisões da administração: publicar um curso
 * coloca conteúdo de terceiros no ar, e arquivar tira. O instrutor trabalha em
 * `draft` e manda para `in_review`.
 */
const INSTRUCTOR_STATUSES = ['draft', 'in_review'];

function assertStatusAllowed(actor, status) {
  if (actor.role === 'admin') return;
  if (!INSTRUCTOR_STATUSES.includes(status)) {
    throw forbidden(
      'Somente a administração publica um curso. Envie para revisão e aguarde a aprovação.',
    );
  }
}

/**
 * Cria/atualiza um curso. Usado pelo instrutor (e pelo admin).
 * `actor` é quem faz a chamada: o dono do curso é sempre ele, exceto quando
 * um admin informa explicitamente outro instrutor.
 */
export async function upsertCourse(actor, payload) {
  assertStatusAllowed(actor, payload.status ?? 'draft');

  // O slug é único: antes do ON CONFLICT, verificamos se o curso existente
  // pertence a quem está tentando usá-lo. Sem isso, qualquer instrutor
  // sobrescreveria o curso de outro apenas informando o slug.
  const { rows: clashes } = await query('SELECT id, instructor_id FROM courses WHERE slug = $1', [
    payload.slug,
  ]);
  const clash = clashes[0];
  if (clash && actor.role !== 'admin' && clash.instructor_id !== actor.id) {
    throw forbidden('Já existe um curso com este endereço e ele não é seu.');
  }

  let instructorId = actor.id;
  if (actor.role === 'admin' && payload.instructorId) {
    const { rows: owners } = await query(
      `SELECT id FROM users WHERE id = $1 AND role IN ('instructor', 'admin')`,
      [payload.instructorId],
    );
    if (!owners[0]) throw badRequest('O instrutor informado não existe ou não pode ser dono de curso.');
    instructorId = owners[0].id;
  }

  // $13 = o ator NÃO é admin. Nesse caso, um curso que já está no ar ou
  // arquivado não pode ser derrubado de volta a rascunho por um POST acidental:
  // quem publica e quem arquiva é a administração.
  const isInstructor = actor.role !== 'admin';

  const { rows } = await query(
    `INSERT INTO courses
       (instructor_id, category_id, title, slug, subtitle, description, cover_url,
        level, status, price_cents, original_price_cents, duration_minutes, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::course_level, $9::course_status, $10, $11, $12,
             CASE WHEN $9::text = 'published' THEN now() ELSE NULL END)
     ON CONFLICT (slug) DO UPDATE
       SET category_id = EXCLUDED.category_id, title = EXCLUDED.title,
           subtitle = EXCLUDED.subtitle, description = EXCLUDED.description,
           cover_url = EXCLUDED.cover_url, level = EXCLUDED.level,
           status = CASE
                      WHEN courses.status IN ('published', 'archived') AND $13::boolean
                        THEN courses.status
                      ELSE EXCLUDED.status
                    END,
           price_cents = EXCLUDED.price_cents,
           original_price_cents = EXCLUDED.original_price_cents,
           duration_minutes = EXCLUDED.duration_minutes
     RETURNING *`,
    [
      instructorId,
      payload.categoryId ?? null,
      payload.title,
      payload.slug,
      payload.subtitle ?? null,
      payload.description ?? null,
      payload.coverUrl ?? null,
      payload.level ?? 'beginner',
      payload.status ?? 'draft',
      payload.priceCents ?? 0,
      payload.originalPriceCents ?? null,
      payload.durationMinutes ?? 0,
      isInstructor,
    ],
  );
  return rows[0];
}

/**
 * Cursos sob gestão do ator. O instrutor vê apenas os seus; o admin vê todos.
 * Traz rascunhos (que `listCourses` esconde) e os números que a área de
 * gestão precisa mostrar: alunos matriculados e receita paga.
 */
export async function listManagedCourses(actor) {
  const { rows } = await query(
    `SELECT
       c.id, c.title, c.slug, c.subtitle, c.cover_url AS "coverUrl",
       c.level, c.status, c.price_cents AS "priceCents",
       c.duration_minutes AS "durationMinutes", c.published_at AS "publishedAt",
       cat.name AS "categoryName",
       u.id AS "instructorId", u.name AS "instructorName",
       (SELECT count(*) FROM enrollments e WHERE e.course_id = c.id)::int AS "studentsCount",
       (SELECT count(*) FROM modules m WHERE m.course_id = c.id)::int AS "moduleCount",
       (SELECT count(*) FROM lessons l JOIN modules m ON m.id = l.module_id
         WHERE m.course_id = c.id)::int AS "lessonCount",
       (SELECT coalesce(sum(o.amount_cents), 0) FROM orders o
         WHERE o.course_id = c.id AND o.status = 'paid')::int AS "revenueCents"
     FROM courses c
     LEFT JOIN categories cat ON cat.id = c.category_id
     JOIN users u ON u.id = c.instructor_id
     WHERE $2::boolean OR c.instructor_id = $1
     ORDER BY c.status, c.title`,
    [actor.id, actor.role === 'admin'],
  );

  return rows.map((r) => ({ ...r, ownedByMe: r.instructorId === actor.id }));
}

/**
 * Curso completo para edição, incluindo rascunhos e aulas sem preview.
 * `getCourseDetail` serve a vitrine e esconde justamente o que o editor precisa.
 */
export async function getCourseForEditing(actor, courseId) {
  const { rows } = await query(
    `SELECT c.id, c.title, c.slug, c.subtitle, c.description, c.cover_url AS "coverUrl",
            c.category_id AS "categoryId", cat.name AS "categoryName",
            c.level, c.status, c.price_cents AS "priceCents",
            c.original_price_cents AS "originalPriceCents",
            c.duration_minutes AS "durationMinutes",
            c.instructor_id AS "instructorId", u.name AS "instructorName"
     FROM courses c
     LEFT JOIN categories cat ON cat.id = c.category_id
     JOIN users u ON u.id = c.instructor_id
     WHERE ${courseKeyColumn(courseId)}`,
    [courseId],
  );

  const course = rows[0];
  if (!course) throw notFound('Curso não encontrado.');
  if (actor.role !== 'admin' && course.instructorId !== actor.id) {
    throw forbidden('Você só pode editar os seus cursos.');
  }

  const modules = await queryAll(
    `SELECT m.id, m.title, m.description, m.position,
            coalesce(
              json_agg(
                json_build_object(
                  'id', l.id, 'title', l.title, 'description', l.description,
                  'type', l.type, 'position', l.position,
                  'durationSeconds', l.duration_seconds, 'videoUrl', l.video_url,
                  'content', l.content, 'isPreview', l.is_preview
                ) ORDER BY l.position
              ) FILTER (WHERE l.id IS NOT NULL), '[]'
            ) AS lessons
     FROM modules m
     LEFT JOIN lessons l ON l.module_id = m.id
     WHERE m.course_id = $1
     GROUP BY m.id
     ORDER BY m.position`,
    [course.id],
  );

  return { ...course, modules };
}

/** Atualiza os metadados de um curso que já existe (sem tocar no currículo). */
export async function updateCourse(actor, courseId, payload) {
  // Sem `AS c` aqui: a consulta usa o nome da tabela, então o prefixo é `courses`.
  const current = await queryOne(`SELECT * FROM courses WHERE ${courseKeyColumn(courseId, 'courses')}`, [courseId]);
  if (!current) throw notFound('Curso não encontrado.');
  if (actor.role !== 'admin' && current.instructor_id !== actor.id) {
    throw forbidden('Você só pode editar os seus cursos.');
  }

  // Publicar é decisão da administração (ver `assertStatusAllowed`).
  if (payload.status !== undefined) assertStatusAllowed(actor, payload.status);

  // Um curso já no ar não volta a rascunho por um PATCH do instrutor: a decisão
  // de tirar do ar também é da administração.
  if (
    actor.role !== 'admin' &&
    ['published', 'archived'].includes(current.status) &&
    ['draft', 'in_review'].includes(payload.status)
  ) {
    throw forbidden(
      'Este curso já está publicado ou arquivado. Peça à administração para alterá-lo.',
    );
  }

  // A troca de slug passa pela mesma trava do upsert, senão seria uma brecha
  // para "sequestrar" o endereço de outro curso.
  if (payload.slug && payload.slug !== current.slug) {
    const { rows: clash } = await query('SELECT instructor_id FROM courses WHERE slug = $1', [payload.slug]);
    if (clash[0] && clash[0].instructor_id !== current.instructor_id) {
      throw forbidden('Já existe um curso com este endereço.');
    }
  }

  /*
   * A montagem é dinâmica por um motivo que já custou bug antes: com
   * `COALESCE($4, subtitle)` não dá para distinguir "o cliente não mandou o
   * campo" de "o cliente mandou null para limpar". O Zod dá `undefined` no
   * primeiro caso e `null` no segundo, e só a montagem em JS respeita isso.
   */
  const assignments = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (payload.title !== undefined) set('title', payload.title);
  if (payload.slug !== undefined) set('slug', payload.slug);
  if (payload.subtitle !== undefined) set('subtitle', payload.subtitle);
  if (payload.description !== undefined) set('description', payload.description);
  if (payload.coverUrl !== undefined) set('cover_url', payload.coverUrl);
  if (payload.categoryId !== undefined) set('category_id', payload.categoryId);
  if (payload.level !== undefined) set('level', payload.level);
  if (payload.priceCents !== undefined) set('price_cents', payload.priceCents);
  if (payload.originalPriceCents !== undefined) set('original_price_cents', payload.originalPriceCents);
  if (payload.durationMinutes !== undefined) set('duration_minutes', payload.durationMinutes);

  const nextStatus = payload.status ?? current.status;
  if (payload.status !== undefined) set('status', nextStatus);

  // `published_at`/`approved_at` só avançam: despublicar não apaga o histórico
  // de quando o curso entrou no ar.
  if (nextStatus === 'published') {
    if (!current.published_at) set('published_at', new Date());
    if (current.status !== 'published') {
      set('approved_at', new Date());
      set('approved_by', actor.id);
    }
  }

  if (!assignments.length) return current;

  values.push(current.id);
  const { rows } = await query(
    `UPDATE courses SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return rows[0];
}

/**
 * Salva o currículo inteiro, reaproveitando o que já existe.
 *
 * Uma versão anterior apagava todos os módulos e recriava do zero. Como
 * `lesson_progress.lesson_id` é `ON DELETE CASCADE`, isso destruía o progresso
 * e o histórico de quiz de todos os alunos matriculados a cada salvamento.
 * Aqui o que continua no currículo é atualizado no lugar (mesmo `id`) e só o
 * que o instrutor removeu de fato é excluído.
 *
 * O cliente manda o `id` das aulas e módulos que já existiam; os itens novos
 * vêm sem `id`.
 */
export async function replaceCurriculum(courseId, modules, actor) {
  if (!Array.isArray(modules)) throw badRequest('`modules` deve ser uma lista.');

  return transaction(async (client) => {
    // O lock mantém a autorização e a reordenação consistentes entre si.
    const { rows: courses } = await client.query(
      'SELECT instructor_id FROM courses WHERE id = $1 FOR UPDATE',
      [courseId],
    );
    const course = courses[0];
    if (!course) throw notFound('Curso não encontrado.');
    if (actor.role !== 'admin' && course.instructor_id !== actor.id) {
      throw forbidden('Você não pode alterar o currículo deste curso.');
    }

    const { rows: currentModules } = await client.query(
      'SELECT id FROM modules WHERE course_id = $1',
      [courseId],
    );
    const { rows: currentLessons } = await client.query(
      `SELECT l.id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE m.course_id = $1`,
      [courseId],
    );

    // Só é possível reaproveitar id que pertence a este curso.
    const reusableModules = new Set(currentModules.map((m) => m.id));
    const reusableLessons = new Set(currentLessons.map((l) => l.id));
    const keptModules = new Set();
    const keptLessons = new Set();

    /*
     * `UNIQUE (course_id, position)` e `UNIQUE (module_id, position)` tornam
     * qualquer reordenação uma corrida: gravar a posição final de um item
     * colidiria com outro que ainda ocupa aquela posição. Estacionamos tudo
     * num faixa alta antes de escrever as posições definitivas, e no fim
     * apagamos o que sobrou (inclusive o que sobrou estacionado).
     */
    const PARKED = 100000;
    await client.query(
      `UPDATE lessons SET position = position + $2
        WHERE module_id IN (SELECT id FROM modules WHERE course_id = $1)`,
      [courseId, PARKED],
    );
    await client.query('UPDATE modules SET position = position + $2 WHERE course_id = $1', [courseId, PARKED]);

    for (const [mi, mod] of modules.entries()) {
      let moduleId;
      if (mod.id && reusableModules.has(mod.id)) {
        await client.query(
          'UPDATE modules SET title = $2, description = $3, position = $4 WHERE id = $1',
          [mod.id, mod.title, mod.description ?? null, mi + 1],
        );
        moduleId = mod.id;
      } else {
        const { rows } = await client.query(
          `INSERT INTO modules (course_id, title, description, position)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [courseId, mod.title, mod.description ?? null, mi + 1],
        );
        moduleId = rows[0].id;
      }
      keptModules.add(moduleId);

      for (const [li, lesson] of (mod.lessons ?? []).entries()) {
        const values = [
          moduleId,
          lesson.title,
          lesson.description ?? null,
          lesson.type ?? 'video',
          li + 1,
          lesson.durationSeconds ?? 0,
          lesson.videoUrl ?? null,
          lesson.content ?? null,
          lesson.isPreview ?? false,
        ];

        if (lesson.id && reusableLessons.has(lesson.id)) {
          // `module_id` na lista permite mover a aula entre módulos sem perdê-la.
          await client.query(
            `UPDATE lessons SET
               module_id = $1, title = $2, description = $3, type = $4::lesson_type,
               position = $5, duration_seconds = $6, video_url = $7, content = $8, is_preview = $9
             WHERE id = $10`,
            [...values, lesson.id],
          );
          keptLessons.add(lesson.id);
        } else {
          const { rows } = await client.query(
            `INSERT INTO lessons
               (module_id, title, description, type, position, duration_seconds, video_url, content, is_preview)
             VALUES ($1, $2, $3, $4::lesson_type, $5, $6, $7, $8, $9) RETURNING id`,
            values,
          );
          keptLessons.add(rows[0].id);
        }
      }
    }

    for (const id of reusableLessons) {
      if (!keptLessons.has(id)) await client.query('DELETE FROM lessons WHERE id = $1', [id]);
    }
    for (const id of reusableModules) {
      if (!keptModules.has(id)) await client.query('DELETE FROM modules WHERE id = $1', [id]);
    }

    return getCourseOutlineSummary(courseId, client);
  });
}

async function getCourseOutlineSummary(courseId, client) {
  const { rows } = await client.query(
    `SELECT
       (SELECT count(*) FROM modules WHERE course_id = $1)::int AS "moduleCount",
       (SELECT count(*) FROM lessons l JOIN modules m ON m.id = l.module_id
         WHERE m.course_id = $1)::int AS "lessonCount",
       (SELECT coalesce(sum(l.duration_seconds), 0) FROM lessons l
         JOIN modules m ON m.id = l.module_id WHERE m.course_id = $1)::int AS "totalSeconds"`,
    [courseId],
  );
  return rows[0];
}
