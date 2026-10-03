import { z } from 'zod';
import { query, queryAll, queryOne, transaction } from '../../config/database.js';
import { badRequest, notFound, conflict, forbidden } from '../../utils/errors.js';
import { pagination, paginatedMeta } from '../../middleware/pagination.js';
import { recordAudit, AUDIT_ACTIONS } from './audit.js';
import { where, unaccentedMatch } from './filters.js';

export const usersQuerySchema = pagination.extend({
  search: z.string().trim().max(120).optional(),
  role: z.enum(['student', 'instructor', 'admin']).optional(),
  status: z.enum(['active', 'blocked']).optional(),
  orderBy: z.enum(['recent', 'name', 'enrollments']).default('recent'),
});

const SORTS = {
  recent: 'u.created_at DESC',
  name: 'u.name ASC',
  enrollments: '"enrollmentCount" DESC, u.name ASC',
};

const USER_ROW = `
  u.id, u.name, u.email, u.role, u.avatar_url AS "avatarUrl",
  u.bio, u.points, u.created_at AS "createdAt",
  u.blocked_at AS "blockedAt", u.blocked_reason AS "blockedReason",
  (SELECT count(*) FROM enrollments e WHERE e.user_id = u.id AND e.status = 'active')::int AS "enrollmentCount",
  (SELECT count(*) FROM courses c WHERE c.instructor_id = u.id)::int AS "courseCount"
`;

/** Lista usuários com busca por nome/e-mail, filtro por papel e paginação. */
export async function listUsers(filters) {
  const f = where();
  if (filters.search) {
    f.add(`(${unaccentedMatch(['u.name', 'u.email'], '?')})`, filters.search);
  }
  if (filters.role) f.add('u.role = ?', filters.role);
  if (filters.status === 'blocked') f.add('u.blocked_at IS NOT NULL');
  if (filters.status === 'active') f.add('u.blocked_at IS NULL');

  const { rows: countRows } = await query(`SELECT count(*)::int AS total FROM users u ${f.sql}`, f.params);
  const total = countRows[0].total;

  const { sql, params } = f.limitOffset(filters.limit, (filters.page - 1) * filters.limit);
  const rows = await queryAll(
    `SELECT ${USER_ROW} FROM users u ${f.sql} ORDER BY ${SORTS[filters.orderBy]} ${sql}`,
    params,
  );

  return { users: rows, meta: paginatedMeta({ page: filters.page, limit: filters.limit, total }) };
}

/**
 * Ficha completa de um usuário, para o painel: perfil, cursos que dá, matrículas
 * ativas, pedidos e conquistas. Reúne o que antes estava espalhado em quatro
 * tabelas e obrigava o admin a abrir cinco telas.
 */
export async function getUserDetail(userId) {
  const user = await queryOne(
    `SELECT u.id, u.name, u.email, u.role, u.avatar_url AS "avatarUrl", u.bio,
            u.points, u.streak_days AS "streakDays",
            u.created_at AS "createdAt", u.updated_at AS "updatedAt",
            u.blocked_at AS "blockedAt", u.blocked_reason AS "blockedReason"
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (!user) throw notFound('Usuário não encontrado.');

  const [enrollments, courses, orders, badges, certificates] = await Promise.all([
    queryAll(
      `SELECT e.id, e.status, e.enrolled_at AS "enrolledAt", e.completed_at AS "completedAt",
              e.canceled_at AS "canceledAt", e.cancel_reason AS "cancelReason",
              c.id AS "courseId", c.title AS "courseTitle", c.slug, c.status AS "courseStatus",
              (SELECT count(*) FROM modules m WHERE m.course_id = c.id)::int AS "moduleCount",
              (SELECT count(*) FROM lessons l JOIN modules m2 ON m2.id = l.module_id
                WHERE m2.course_id = c.id)::int AS "lessonCount"
         FROM enrollments e JOIN courses c ON c.id = e.course_id
        WHERE e.user_id = $1 ORDER BY e.enrolled_at DESC`,
      [userId],
    ),
    queryAll(
      `SELECT c.id, c.title, c.slug, c.status,
              (SELECT count(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active')::int AS "studentCount"
         FROM courses c WHERE c.instructor_id = $1 ORDER BY c.created_at DESC`,
      [userId],
    ),
    queryAll(
      `SELECT o.id, o.status, o.method, o.amount_cents AS "amountCents", o.currency,
              o.created_at AS "createdAt", o.paid_at AS "paidAt", c.title AS "courseTitle"
         FROM orders o JOIN courses c ON c.id = o.course_id
        WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 20`,
      [userId],
    ),
    queryAll(
      `SELECT ub.id, ub.awarded_at AS "awardedAt", b.id AS "badgeId", b.key, b.name, b.icon, b.points
         FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
        WHERE ub.user_id = $1 ORDER BY ub.awarded_at DESC`,
      [userId],
    ),
    queryAll(
      `SELECT ct.id, ct.code, ct.course_id AS "courseId", ct.final_score AS "finalScore",
              ct.issued_at AS "issuedAt", ct.revoked_at AS "revokedAt", c.title AS "courseTitle"
         FROM certificates ct JOIN courses c ON c.id = ct.course_id
        WHERE ct.user_id = $1 ORDER BY ct.issued_at DESC`,
      [userId],
    ),
  ]);

  const spentCents = orders
    .filter((o) => o.status === 'paid')
    .reduce((sum, o) => sum + o.amountCents, 0);

  return {
    user,
    enrollments,
    courses,
    orders,
    badges,
    certificates,
    summary: {
      activeEnrollments: enrollments.filter((e) => e.status === 'active').length,
      paidCents: spentCents,
      courseCount: courses.length,
      badgeCount: badges.length,
      revokedCertificates: certificates.filter((c) => c.revokedAt).length,
    },
  };
}

/**
 * Muda o papel de um usuário.
 * O papel vem dentro do token, então a sessão do alvo é invalidada para que
 * ele volte a buscar as permissões na próxima chamada.
 */
export async function changeUserRole(actor, userId, role) {
  const target = await queryOne('SELECT id, name, email, role FROM users WHERE id = $1', [userId]);
  if (!target) throw notFound('Usuário não encontrado.');

  if (target.id === actor.id && role !== 'admin') {
    throw badRequest('Você não pode remover o próprio acesso de administrador.');
  }

  // A plataforma precisa continuar com alguém capaz de administrá-la.
  if (target.role === 'admin' && role !== 'admin') {
    const { rows } = await query("SELECT count(*)::int AS total FROM users WHERE role = 'admin'");
    if (rows[0].total <= 1) throw conflict('Esta é a última conta de administrador da plataforma.');
  }

  return transaction(async (client) => {
    const { rows } = await client.query(
      'UPDATE users SET role = $2 WHERE id = $1 RETURNING id, name, email, role',
      [target.id, role],
    );
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [target.id]);

    await recordAudit(client, actor, 'user.role.change', { type: 'user', id: target.id }, {
      summary: `${target.name} (${target.email}) passou de ${target.role} para ${role}`,
      before: { role: target.role },
      after: { role },
    });

    return rows[0];
  });
}

/**
 * Bloqueia ou desbloqueia um usuário.
 *
 * Bloquear define `blocked_at` e derruba as sessões; o `authenticate` recusa o
 * token na requisição seguinte, então o efeito é imediato e não espera o token
 * expirar.
 */
export async function setUserBlocked(actor, userId, blocked, reason) {
  const target = await queryOne('SELECT id, name, email, role, blocked_at FROM users WHERE id = $1', [
    userId,
  ]);
  if (!target) throw notFound('Usuário não encontrado.');

  if (blocked && target.id === actor.id) {
    throw badRequest('Você não pode bloquear a própria conta.');
  }

  if (blocked && target.role === 'admin') {
    const { rows } = await query("SELECT count(*)::int AS total FROM users WHERE role = 'admin'");
    if (rows[0].total <= 1) throw conflict('Esta é a última conta de administrador da plataforma.');
  }

  if (blocked && target.blocked_at) throw conflict('Este usuário já está bloqueado.');
  if (!blocked && !target.blocked_at) throw conflict('Este usuário não está bloqueado.');

  const clean = blocked ? (reason?.trim() || 'Bloqueado pela administração.') : null;

  return transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE users SET blocked_at = $2, blocked_reason = $3
        WHERE id = $1
        RETURNING id, name, email, role, blocked_at AS "blockedAt", blocked_reason AS "blockedReason"`,
      [target.id, blocked ? new Date() : null, clean],
    );
    if (blocked) await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [target.id]);

    await recordAudit(client, actor, blocked ? 'user.block' : 'user.unblock', { type: 'user', id: target.id }, {
      summary: blocked
        ? `${target.name} (${target.email}) foi bloqueado. Motivo: ${clean}`
        : `${target.name} (${target.email}) foi desbloqueado`,
      before: { blockedAt: target.blocked_at },
      after: { blockedAt: blocked ? rows[0].blockedAt : null, blockedReason: clean },
    });

    return rows[0];
  });
}

/** Senha redefinida pelo admin, para recuperar o acesso de um aluno. */
export async function setUserPassword(actor, userId, plain) {
  const target = await queryOne('SELECT id, name, email FROM users WHERE id = $1', [userId]);
  if (!target) throw notFound('Usuário não encontrado.');

  const bcrypt = await import('bcryptjs');
  const { config } = await import('../../config/env.js');
  const hash = await bcrypt.hash(plain, config.auth.bcryptRounds);

  await transaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [target.id, hash]);
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [target.id]);
    await recordAudit(client, actor, 'user.password.reset', { type: 'user', id: target.id }, {
      // A senha nunca entra no log; só o fato de que foi trocada.
      summary: `Senha de ${target.name} (${target.email}) redefinida pelo administrador`,
    });
  });

  return { user: { id: target.id, name: target.name, email: target.email } };
}

/** Números gerais da plataforma para o painel do administrador. */
export async function platformOverview() {
  const [users, courses, enrollments, revenue, moderation, pending] = await Promise.all([
    query(`SELECT
             count(*) FILTER (WHERE role = 'student')::int    AS students,
             count(*) FILTER (WHERE role = 'instructor')::int AS instructors,
             count(*) FILTER (WHERE role = 'admin')::int      AS admins,
             count(*) FILTER (WHERE blocked_at IS NOT NULL)::int AS blocked
           FROM users`),
    query(`SELECT
             count(*) FILTER (WHERE status = 'published')::int AS published,
             count(*) FILTER (WHERE status = 'draft')::int     AS drafts,
             count(*) FILTER (WHERE status = 'in_review')::int AS "inReview",
             count(*) FILTER (WHERE status = 'archived')::int  AS archived,
             count(*)::int AS total
           FROM courses`),
    query(`SELECT
             count(*) FILTER (WHERE status = 'active')::int   AS active,
             count(*) FILTER (WHERE status = 'canceled')::int AS canceled,
             count(*) FILTER (WHERE status = 'refunded')::int AS refunded,
             count(*)::int AS total
           FROM enrollments`),
    query(`SELECT
             coalesce(sum(amount_cents) FILTER (WHERE status = 'paid'), 0)::int AS "paidCents",
             coalesce(sum(amount_cents) FILTER (WHERE status = 'refunded'), 0)::int AS "refundedCents",
             count(*) FILTER (WHERE status = 'pending')::int AS "pendingOrders"
           FROM orders`),
    query(`SELECT
             (SELECT count(*) FROM reviews WHERE hidden_at IS NOT NULL)::int AS "hiddenReviews",
             (SELECT count(*) FROM posts WHERE hidden_at IS NOT NULL)::int AS "hiddenPosts",
             (SELECT count(*) FROM comments WHERE hidden_at IS NOT NULL)::int AS "hiddenComments"`),
    query("SELECT count(*)::int AS total FROM courses WHERE status = 'in_review'"),
  ]);

  const enr = enrollments.rows[0];

  return {
    users: users.rows[0],
    courses: courses.rows[0],
    /*
     * `enrollments` continua sendo o TOTAL, como o painel já esperava. O
     * detalhamento por status (ativas, canceladas, reembolsadas) vai em
     * `enrollmentStats`: trocar um número por objeto quebraria os consumidores
     * que já leem `overview.enrollments` como contagem.
     */
    enrollments: enr.total,
    enrollmentStats: enr,
    orders: revenue.rows[0],
    moderation: moderation.rows[0],
    revenueCents: revenue.rows[0].paidCents,
    refundedCents: revenue.rows[0].refundedCents,
    pendingReview: pending.rows[0].total,
  };
}

export const auditQuerySchema = pagination.extend({
  action: z.enum(AUDIT_ACTIONS).optional(),
  entityType: z.string().trim().max(40).optional(),
  actorId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
});

/** Histórico de ações do admin, filtrável. */
export async function listAuditLogs(filters) {
  const f = where();
  if (filters.action) f.add('a.action = ?', filters.action);
  if (filters.entityType) f.add('a.entity_type = ?', filters.entityType);
  if (filters.actorId) f.add('a.actor_id = ?', filters.actorId);
  if (filters.search) f.add(`(${unaccentedMatch(['a.summary', 'a.actor_name'], '?')})`, filters.search);

  const { rows: countRows } = await query(`SELECT count(*)::int AS total FROM audit_logs a ${f.sql}`, f.params);
  const total = countRows[0].total;

  const { sql, params } = f.limitOffset(filters.limit, (filters.page - 1) * filters.limit);
  const logs = await queryAll(
    `SELECT a.id, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId",
            a.actor_id AS "actorId", a.actor_name AS "actorName", a.actor_email AS "actorEmail",
            a.summary, a.before, a.after, a.created_at AS "createdAt"
       FROM audit_logs a ${f.sql} ORDER BY a.created_at DESC ${sql}`,
    params,
  );

  return { logs, meta: paginatedMeta({ page: filters.page, limit: filters.limit, total }) };
}

/** Remove logs antigos. Usado só por manutenção, não pelo painel. */
export async function pruneAuditLogs(before) {
  if (!(before instanceof Date) || Number.isNaN(before.getTime())) {
    throw forbidden('Data de corte inválida.');
  }
  const { rows } = await query('DELETE FROM audit_logs WHERE created_at < $1 RETURNING id', [before]);
  return { removed: rows.length };
}
