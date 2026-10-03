import { z } from 'zod';
import { query, queryAll } from '../../config/database.js';
import { notFound } from '../../utils/errors.js';

export const reportQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
});

/**
 * Série temporal de receita e matrículas.
 *
 * Usa `generate_series` para os dias do intervalo em vez de agrupar os pedidos:
 * sem isso, um dia sem venda simplesmente não aparece no resultado, e o gráfico
 * mostra uma linha reta que sugere "receita constante" onde o houve uma falha.
 */
export async function revenueSeries({ days }) {
  const rows = await queryAll(
    `WITH span AS (
       SELECT generate_series(current_date - ($1::int - 1), current_date, interval '1 day')::date AS day
     )
     SELECT span.day,
            coalesce(p.revenueCents, 0)::int AS "revenueCents",
            coalesce(p.orders, 0)::int        AS orders,
            coalesce(p.refunds, 0)::int       AS refunds,
            coalesce(p.refundCents, 0)::int   AS "refundCents",
            coalesce(e.enrollments, 0)::int   AS enrollments
       FROM span
       LEFT JOIN (
         SELECT created_at::date AS day,
                sum(amount_cents) FILTER (WHERE status = 'paid')::int AS revenueCents,
                count(*) FILTER (WHERE status = 'paid')::int AS orders,
                count(*) FILTER (WHERE status = 'refunded')::int AS refunds,
                sum(amount_cents) FILTER (WHERE status = 'refunded')::int AS refundCents
           FROM orders
          WHERE created_at >= current_date - ($1::int - 1)
          GROUP BY created_at::date
       ) p ON p.day = span.day
       LEFT JOIN (
         SELECT enrolled_at::date AS day, count(*)::int AS enrollments
           FROM enrollments
          WHERE enrolled_at >= current_date - ($1::int - 1)
          GROUP BY enrolled_at::date
       ) e ON e.day = span.day
      ORDER BY span.day`,
    [days],
  );

  // Taxa média de reembolso do período: número que o admin quer ver antes de
  // perguntar por que a receita do mês caiu.
  const { rows: totals } = await query(
    `SELECT count(*)::int AS "totalOrders",
            count(*) FILTER (WHERE status = 'paid')::int AS "paidOrders",
            count(*) FILTER (WHERE status = 'refunded')::int AS "refundedOrders",
            coalesce(sum(amount_cents) FILTER (WHERE status = 'paid'), 0)::int AS "paidCents",
            coalesce(sum(amount_cents) FILTER (WHERE status = 'refunded'), 0)::int AS "refundedCents"
       FROM orders WHERE created_at >= current_date - ($1::int - 1)`,
    [days],
  );

  const t = totals[0];
  const paid = Math.max(1, t.paidOrders + t.refundedOrders);

  return {
    series: rows,
    totals: {
      ...t,
      refundRate: Math.round((t.refundedOrders / paid) * 1000) / 10,
      averageTicketCents: t.paidOrders ? Math.round(t.paidCents / t.paidOrders) : 0,
    },
  };
}

/** Cursos que mais vendem, com receita e nota média. */
export async function topCourses({ limit = 8 } = {}) {
  return queryAll(
    `SELECT c.id, c.title, c.slug, c.status, c.cover_url AS "coverUrl",
            u.name AS "instructorName",
            (SELECT count(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active')::int AS students,
            (SELECT count(*) FROM orders o WHERE o.course_id = c.id AND o.status = 'paid')::int AS orders,
            (SELECT coalesce(sum(o.amount_cents), 0) FROM orders o
              WHERE o.course_id = c.id AND o.status = 'paid')::int AS "revenueCents",
            (SELECT round(avg(r.rating)::numeric, 1) FROM reviews r
              WHERE r.course_id = c.id AND r.hidden_at IS NULL) AS "ratingAvg",
            (SELECT count(*) FROM reviews r WHERE r.course_id = c.id AND r.hidden_at IS NULL)::int AS "reviewCount"
       FROM courses c JOIN users u ON u.id = c.instructor_id
      ORDER BY "revenueCents" DESC, students DESC
      LIMIT $1`,
    [limit],
  );
}

/** Instrutores com mais receita e mais alunos. */
export async function topInstructors({ limit = 8 } = {}) {
  return queryAll(
    `SELECT u.id, u.name, u.email, u.avatar_url AS "avatarUrl",
            count(DISTINCT c.id)::int AS courses,
            (SELECT count(*) FROM enrollments e
               JOIN courses c2 ON c2.id = e.course_id
              WHERE c2.instructor_id = u.id AND e.status = 'active')::int AS students,
            (SELECT coalesce(sum(o.amount_cents), 0) FROM orders o
               JOIN courses c3 ON c3.id = o.course_id
              WHERE c3.instructor_id = u.id AND o.status = 'paid')::int AS "revenueCents"
       FROM users u JOIN courses c ON c.instructor_id = u.id
      GROUP BY u.id
      ORDER BY "revenueCents" DESC
      LIMIT $1`,
    [limit],
  );
}

/**
 * Conclusão de cada curso: quantos começaram, quantos terminaram e onde a
 * turma trava. É a métrica que diz ao instrutor o que revisar.
 */
export async function courseCompletion({ limit = 10 } = {}) {
  return queryAll(
    `SELECT c.id, c.title, c.slug, c.status,
            (SELECT count(*) FROM modules m WHERE m.course_id = c.id)::int AS "moduleCount",
            (SELECT count(*) FROM lessons l JOIN modules m ON m.id = l.module_id
              WHERE m.course_id = c.id)::int AS "lessonCount",
            coalesce((SELECT sum(cp.total_lessons) FROM course_progress cp
               JOIN enrollments e ON e.id = cp.enrollment_id
              WHERE e.course_id = c.id AND e.status = 'active'), 0)::int AS "lessonsForStudents",
            (SELECT count(*) FROM enrollments e
              WHERE e.course_id = c.id AND e.status = 'active')::int AS students,
            (SELECT count(*) FROM enrollments e
              WHERE e.course_id = c.id AND e.status = 'active' AND e.completed_at IS NOT NULL)::int AS completed,
            coalesce((SELECT avg(cp.progress_percent) FROM course_progress cp
               JOIN enrollments e ON e.id = cp.enrollment_id
              WHERE e.course_id = c.id AND e.status = 'active'), 0)::int AS "avgProgress"
       FROM courses c
      WHERE c.status <> 'archived'
      ORDER BY students DESC, c.created_at DESC
      LIMIT $1`,
    [limit],
  );
}

/** Atividade por dia: cadastros, matrículas, cursos e posts. */
export async function activitySeries({ days }) {
  return queryAll(
    `WITH span AS (
       SELECT generate_series(current_date - ($1::int - 1), current_date, interval '1 day')::date AS day
     )
     SELECT span.day,
            coalesce(u.signups, 0)::int AS signups,
            coalesce(e.enrollments, 0)::int AS enrollments,
            coalesce(p.posts, 0)::int AS posts,
            coalesce(r.reviews, 0)::int AS reviews
       FROM span
       LEFT JOIN (SELECT created_at::date AS day, count(*)::int AS signups FROM users
                   WHERE created_at >= current_date - ($1::int - 1) GROUP BY created_at::date) u ON u.day = span.day
       LEFT JOIN (SELECT enrolled_at::date AS day, count(*)::int AS enrollments FROM enrollments
                   WHERE enrolled_at >= current_date - ($1::int - 1) GROUP BY enrolled_at::date) e ON e.day = span.day
       LEFT JOIN (SELECT created_at::date AS day, count(*)::int AS posts FROM posts
                   WHERE created_at >= current_date - ($1::int - 1) GROUP BY created_at::date) p ON p.day = span.day
       LEFT JOIN (SELECT created_at::date AS day, count(*)::int AS reviews FROM reviews
                   WHERE created_at >= current_date - ($1::int - 1) GROUP BY created_at::date) r ON r.day = span.day
      ORDER BY span.day`,
    [days],
  );
}

/** Resumo executivo do topo do painel. */
export async function executiveSummary() {
  const [head, funnel, catalog] = await Promise.all([
    query(`SELECT
        (SELECT count(*) FROM users)::int AS users,
        (SELECT count(*) FROM users WHERE created_at >= now() - interval '30 days')::int AS "newUsers30d",
        (SELECT count(*) FROM orders WHERE status = 'paid' AND paid_at >= now() - interval '30 days')::int AS "orders30d",
        (SELECT coalesce(sum(amount_cents), 0) FROM orders
          WHERE status = 'paid' AND paid_at >= now() - interval '30 days')::int AS "revenue30dCents",
        (SELECT coalesce(sum(amount_cents), 0) FROM orders
          WHERE status = 'paid' AND paid_at < now() - interval '30 days')::int AS "revenueBefore30dCents"`),
    query(`SELECT
        (SELECT count(*) FROM courses WHERE status = 'published')::int AS published,
        (SELECT count(*) FROM courses WHERE status = 'draft')::int AS drafts,
        (SELECT count(*) FROM courses WHERE status = 'in_review')::int AS "inReview",
        (SELECT count(*) FROM enrollments WHERE status = 'active')::int AS "activeEnrollments",
        (SELECT count(*) FROM enrollments WHERE status = 'active' AND completed_at IS NOT NULL)::int AS completed,
        (SELECT count(*) FROM users WHERE blocked_at IS NOT NULL)::int AS blocked`),
    query(`SELECT
        (SELECT count(*) FROM categories)::int AS categories,
        (SELECT count(*) FROM badges)::int AS badges,
        (SELECT count(*) FROM posts)::int AS posts,
        (SELECT count(*) FROM comments)::int AS comments,
        (SELECT count(*) FROM reviews WHERE hidden_at IS NULL)::int AS "visibleReviews",
        (SELECT count(*) FROM reviews WHERE hidden_at IS NOT NULL)::int AS "hiddenReviews",
        (SELECT count(*) FROM certificates)::int AS certificates,
        (SELECT count(*) FROM certificates WHERE revoked_at IS NOT NULL)::int AS "revokedCertificates"`),
  ]);

  const h = head.rows[0];
  // Variação de receita: janela de 30 dias contra os 30 anteriores. `null`
  // quando não havia receita antes — "crescimento infinito" não é informação.
  const variation =
    h.revenueBefore30dCents > 0
      ? Math.round(((h.revenue30dCents - h.revenueBefore30dCents) / h.revenueBefore30dCents) * 1000) / 10
      : null;

  return {
    ...h,
    ...catalog.rows[0],
    ...funnel.rows[0],
    revenueVariation: variation,
  };
}

/** Um curso com o funil de progresso, para a tela de detalhe. */
export async function courseFunnel(courseId) {
  const row = await query(
    `SELECT c.id, c.title, c.slug, c.status,
        (SELECT count(*) FROM modules m WHERE m.course_id = c.id)::int AS "moduleCount",
        (SELECT count(*) FROM lessons l JOIN modules m ON m.id = l.module_id
          WHERE m.course_id = c.id)::int AS "lessonCount",
        (SELECT count(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active')::int AS students,
        (SELECT count(*) FROM enrollments e
          WHERE e.course_id = c.id AND e.status = 'active' AND e.completed_at IS NOT NULL)::int AS completed
       FROM courses c WHERE c.id = $1`,
    [courseId],
  );
  const course = row.rows[0];
  if (!course) throw notFound('Curso não encontrado.');

  // Quantos alunos concluíram pelo menos 1, 25%, 50%, 75% e 100%. Um funil
  // mostra exatamente em qual módulo a turma está caindo.
  const buckets = await queryAll(
    `SELECT
        count(*) FILTER (WHERE cp.progress_percent >= 1)::int   AS "atLeast1",
        count(*) FILTER (WHERE cp.progress_percent >= 25)::int  AS "atLeast25",
        count(*) FILTER (WHERE cp.progress_percent >= 50)::int  AS "atLeast50",
        count(*) FILTER (WHERE cp.progress_percent >= 75)::int  AS "atLeast75",
        count(*) FILTER (WHERE cp.progress_percent >= 100)::int AS "atLeast100"
       FROM enrollments e
       JOIN course_progress cp ON cp.enrollment_id = e.id
      WHERE e.course_id = $1 AND e.status = 'active'`,
    [courseId],
  );

  return { course, funnel: buckets[0] };
}
