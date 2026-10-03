import { z } from 'zod';
import { query, queryAll, queryOne, transaction } from '../../config/database.js';
import { badRequest, notFound, conflict } from '../../utils/errors.js';
import { pagination, paginatedMeta } from '../../middleware/pagination.js';
import { recordAudit } from './audit.js';
import { where, unaccentedMatch } from './filters.js';

export const adminCoursesQuerySchema = pagination.extend({
  status: z.enum(['draft', 'in_review', 'published', 'archived']).optional(),
  instructorId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
  orderBy: z.enum(['recent', 'title', 'students', 'revenue', 'status']).default('recent'),
});

const SORTS = {
  recent: 'c.created_at DESC',
  title: 'c.title ASC',
  students: '"studentsCount" DESC, c.title ASC',
  revenue: '"revenueCents" DESC, c.title ASC',
  status: 'c.status ASC, c.created_at DESC',
};

/**
 * Todos os cursos da plataforma, com os números que decidem o que moderar
 * primeiro: quantos alunos, quanto gerou e há quanto tempo está em revisão.
 */
export async function listCoursesForAdmin(filters) {
  const f = where();
  if (filters.status) f.add('c.status = ?::course_status', filters.status);
  if (filters.instructorId) f.add('c.instructor_id = ?', filters.instructorId);
  if (filters.categoryId) f.add('c.category_id = ?', filters.categoryId);
  if (filters.search) f.add(`(${unaccentedMatch(['c.title', 'c.subtitle'], '?')})`, filters.search);

  const from = `
    FROM courses c
    LEFT JOIN categories cat ON cat.id = c.category_id
    JOIN users u ON u.id = c.instructor_id
  `;

  const { rows: countRows } = await query(`SELECT count(*)::int AS total ${from} ${f.sql}`, f.params);
  const total = countRows[0].total;

  const { sql, params } = f.limitOffset(filters.limit, (filters.page - 1) * filters.limit);
  const courses = await queryAll(
    `SELECT c.id, c.title, c.slug, c.subtitle, c.cover_url AS "coverUrl", c.level, c.status,
            c.price_cents AS "priceCents", c.duration_minutes AS "durationMinutes",
            c.created_at AS "createdAt", c.published_at AS "publishedAt",
            c.approved_at AS "approvedAt",
            cat.id AS "categoryId", cat.name AS "categoryName",
            u.id AS "instructorId", u.name AS "instructorName", u.email AS "instructorEmail",
            (SELECT count(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active')::int AS "studentsCount",
            -- Contagem de pedidos em qualquer estado: é o que decide se o curso
            -- pode ser excluído, então a tela precisa saber antes de oferecer o botão.
            (SELECT count(*) FROM orders o WHERE o.course_id = c.id)::int AS "orderCount",
            (SELECT count(*) FROM reviews r WHERE r.course_id = c.id AND r.hidden_at IS NULL)::int AS "reviewCount",
            (SELECT round(avg(r.rating)::numeric, 1) FROM reviews r
              WHERE r.course_id = c.id AND r.hidden_at IS NULL) AS "ratingAvg",
            (SELECT count(*) FROM modules m WHERE m.course_id = c.id)::int AS "moduleCount",
            (SELECT count(*) FROM lessons l JOIN modules m ON m.id = l.module_id
              WHERE m.course_id = c.id)::int AS "lessonCount",
            (SELECT coalesce(sum(o.amount_cents), 0) FROM orders o
              WHERE o.course_id = c.id AND o.status = 'paid')::int AS "revenueCents"
       ${from} ${f.sql} ORDER BY ${SORTS[filters.orderBy]} ${sql}`,
    params,
  );

  return { courses, meta: paginatedMeta({ page: filters.page, limit: filters.limit, total }) };
}

/** Transições permitidas, com o texto que vai para a auditoria. */
const TRANSITIONS = {
  approve: { from: ['in_review', 'draft'], to: 'published', action: 'course.approve' },
  reject: { from: ['in_review'], to: 'draft', action: 'course.reject' },
  publish: { from: ['draft', 'in_review', 'archived'], to: 'published', action: 'course.publish' },
  unpublish: { from: ['published'], to: 'draft', action: 'course.unpublish' },
  archive: { from: ['published', 'draft', 'in_review'], to: 'archived', action: 'course.archive' },
  restore: { from: ['archived'], to: 'draft', action: 'course.unpublish' },
};

export const courseActionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

/**
 * Move o curso entre estados. É a única porta de entrada para
 * `published`/`archived` — o `PATCH /courses/:id` do instrutor recusa esses
 * status, então decidir publicação é uma prerrogativa da administração.
 */
export async function transitionCourse(actor, courseId, action, reason) {
  const rule = TRANSITIONS[action];
  if (!rule) throw badRequest(`Ação desconhecida: ${action}`);

  const course = await queryOne(
    `SELECT c.id, c.title, c.slug, c.status, c.published_at, c.instructor_id,
            u.name AS "instructorName"
       FROM courses c JOIN users u ON u.id = c.instructor_id WHERE c.id = $1`,
    [courseId],
  );
  if (!course) throw notFound('Curso não encontrado.');

  if (!rule.from.includes(course.status)) {
    const label = { in_review: 'em revisão', draft: 'rascunho', published: 'publicado', archived: 'arquivado' };
    throw conflict(
      `Não é possível ${action} um curso ${label[course.status] ?? course.status}.`,
    );
  }

  const clean = reason?.trim() || null;

  return transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE courses SET
         status = $2::course_status,
         published_at = CASE
           WHEN $2::text = 'published' AND published_at IS NULL THEN now()
           ELSE published_at END,
         approved_at = CASE
           WHEN $2::text = 'published' AND status <> 'published' THEN now()
           WHEN $2::text <> 'published' THEN NULL
           ELSE approved_at END,
         approved_by = CASE
           WHEN $2::text = 'published' AND status <> 'published' THEN $3
           WHEN $2::text <> 'published' THEN NULL
           ELSE approved_by END
       WHERE id = $1
       RETURNING id, title, slug, status, published_at AS "publishedAt",
                 approved_at AS "approvedAt", approved_by AS "approvedBy"`,
      [course.id, rule.to, actor.id],
    );

    // Aluno que já pagou continua com acesso a um curso arquivado: arquivar
    // tira o curso do catálogo, não cancela a matrícula de quem comprou.
    await recordAudit(client, actor, rule.action, { type: 'course', id: course.id }, {
      summary: `${action}: "${course.title}" (${course.instructorName}) — ${course.status} → ${rule.to}${clean ? `. Motivo: ${clean}` : ''}`,
      before: { status: course.status },
      after: { status: rule.to, reason: clean },
    });

    return rows[0];
  });
}

/**
 * Exclusão definitiva.
 *
 * Recusada quando há matrícula **ou** pedido. Apagar o curso leva junto módulos,
 * aulas, progresso e avaliações em cascata, e o pedido órfão quebraria o
 * histórico financeiro de quem já pagou. Nos dois casos a resposta aponta o
 * caminho seguro: arquivar.
 */
export async function deleteCourse(actor, courseId, reason) {
  const course = await queryOne(
    `SELECT c.id, c.title, c.status,
            (SELECT count(*) FROM enrollments e WHERE e.course_id = c.id)::int AS "enrollmentCount",
            (SELECT count(*) FROM orders o WHERE o.course_id = c.id)::int AS "orderCount"
       FROM courses c WHERE c.id = $1`,
    [courseId],
  );
  if (!course) throw notFound('Curso não encontrado.');

  if (course.enrollmentCount > 0 || course.orderCount > 0) {
    throw conflict(
      `Este curso tem ${course.enrollmentCount} matrícula(s) e ${course.orderCount} pedido(s). Excluir apagaria o histórico dos alunos — arquive o curso.`,
    );
  }

  return transaction(async (client) => {
    // O que sobrou (posts, avaliações, pedidos) também sai: são filhos do curso.
    await client.query('DELETE FROM courses WHERE id = $1', [course.id]);
    await recordAudit(client, actor, 'course.delete', { type: 'course', id: course.id }, {
      summary: `Curso "${course.title}" (${course.status}) excluído definitivamente`,
      before: { id: course.id, title: course.title, status: course.status },
      // O motivo fica no log porque a exclusão não tem volta: é a única pista
      // sobre por que o sumiu.
      after: reason ? { reason } : null,
    });
    return { deleted: { id: course.id, title: course.title } };
  });
}

/** Detalhe de um curso para o admin: números, avaliações e matrículas. */
export async function getCourseForAdmin(courseId) {
  const course = await queryOne(
    `SELECT c.id, c.title, c.slug, c.subtitle, c.description, c.cover_url AS "coverUrl",
            c.status, c.level, c.price_cents AS "priceCents",
            c.original_price_cents AS "originalPriceCents",
            c.duration_minutes AS "durationMinutes", c.certificate_enabled AS "certificateEnabled",
            c.created_at AS "createdAt", c.published_at AS "publishedAt",
            c.approved_at AS "approvedAt",
            cat.id AS "categoryId", cat.name AS "categoryName",
            u.id AS "instructorId", u.name AS "instructorName", u.email AS "instructorEmail",
            ap.name AS "approvedByName"
       FROM courses c
       LEFT JOIN categories cat ON cat.id = c.category_id
       JOIN users u ON u.id = c.instructor_id
       LEFT JOIN users ap ON ap.id = c.approved_by
      WHERE c.id = $1`,
    [courseId],
  );
  if (!course) throw notFound('Curso não encontrado.');

  const [enrollments, orders, reviews, revenue] = await Promise.all([
    queryAll(
      `SELECT e.id, e.status, e.enrolled_at AS "enrolledAt", e.completed_at AS "completedAt",
              u.id AS "userId", u.name AS "userName", u.email AS "userEmail"
         FROM enrollments e JOIN users u ON u.id = e.user_id
        WHERE e.course_id = $1 ORDER BY e.enrolled_at DESC LIMIT 50`,
      [courseId],
    ),
    queryAll(
      `SELECT o.id, o.status, o.method, o.amount_cents AS "amountCents",
              o.created_at AS "createdAt", o.paid_at AS "paidAt",
              u.name AS "userName"
         FROM orders o JOIN users u ON u.id = o.user_id
        WHERE o.course_id = $1 ORDER BY o.created_at DESC LIMIT 50`,
      [courseId],
    ),
    queryAll(
      `SELECT r.id, r.rating, r.comment, r.hidden_at AS "hiddenAt", r.created_at AS "createdAt",
              u.name AS "userName"
         FROM reviews r JOIN users u ON u.id = r.user_id
        WHERE r.course_id = $1 ORDER BY r.created_at DESC`,
      [courseId],
    ),
    query(
      `SELECT coalesce(sum(amount_cents) FILTER (WHERE status = 'paid'), 0)::int AS "paidCents",
              count(*) FILTER (WHERE status = 'paid')::int AS "paidOrders",
              count(*) FILTER (WHERE status = 'refunded')::int AS "refundedOrders"
         FROM orders WHERE course_id = $1`,
      [courseId],
    ),
  ]);

  return { course, enrollments, orders, reviews, revenue: revenue.rows[0] };
}
