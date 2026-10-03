import { z } from 'zod';
import { query, queryAll, queryOne, transaction } from '../../config/database.js';
import { notFound, conflict } from '../../utils/errors.js';
import { booleanFlag } from '../../utils/helpers.js';
import { pagination, paginatedMeta } from '../../middleware/pagination.js';
import { recordAudit } from './audit.js';
import { where, unaccentedMatch } from './filters.js';

export const enrollmentsQuerySchema = pagination.extend({
  status: z.enum(['active', 'canceled', 'refunded']).optional(),
  courseId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  courseStatus: z.enum(['draft', 'in_review', 'published', 'archived']).optional(),
  search: z.string().trim().max(120).optional(),
  orderBy: z.enum(['recent', 'progress', 'course']).default('recent'),
});

const SORTS = {
  recent: 'e.enrolled_at DESC',
  progress: '"progressPercent" DESC NULLS LAST, e.enrolled_at DESC',
  course: 'c.title ASC, e.enrolled_at DESC',
};

/**
 * Todas as matrículas da plataforma.
 *
 * Reaproveita a view `course_progress`, que já conta aulas e concluídas. O
 * `status` distingue o que ainda vale: `canceled`/`refunded` continuam na lista
 * porque o histórico de pagamento importa, só não dão mais acesso.
 */
export async function listEnrollments(filters) {
  const f = where();
  if (filters.status) f.add('e.status = ?::enrollment_status', filters.status);
  if (filters.courseId) f.add('e.course_id = ?', filters.courseId);
  if (filters.userId) f.add('e.user_id = ?', filters.userId);
  if (filters.courseStatus) f.add('c.status = ?::course_status', filters.courseStatus);
  if (filters.search) f.add(`(${unaccentedMatch(['u.name', 'u.email', 'c.title'], '?')})`, filters.search);

  const from = `
    FROM enrollments e
    JOIN users u ON u.id = e.user_id
    JOIN courses c ON c.id = e.course_id
    LEFT JOIN course_progress cp ON cp.enrollment_id = e.id
  `;

  const { rows: countRows } = await query(`SELECT count(*)::int AS total ${from} ${f.sql}`, f.params);
  const total = countRows[0].total;

  const { sql, params } = f.limitOffset(filters.limit, (filters.page - 1) * filters.limit);
  const enrollments = await queryAll(
    `SELECT e.id, e.status, e.enrolled_at AS "enrolledAt", e.last_accessed_at AS "lastAccessedAt",
            e.completed_at AS "completedAt", e.canceled_at AS "canceledAt",
            e.cancel_reason AS "cancelReason",
            u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
            c.id AS "courseId", c.title AS "courseTitle", c.slug AS "courseSlug",
            c.status AS "courseStatus", c.certificate_enabled AS "certificateEnabled",
            coalesce(cp.total_lessons, 0) AS "totalLessons",
            coalesce(cp.completed_lessons, 0) AS "completedLessons",
            coalesce(cp.progress_percent, 0) AS "progressPercent",
            (SELECT count(*) FROM certificates cert
              WHERE cert.user_id = e.user_id AND cert.course_id = e.course_id)::int AS "certificateCount"
       ${from} ${f.sql} ORDER BY ${SORTS[filters.orderBy]} ${sql}`,
    params,
  );

  const { rows: summary } = await query(
    `SELECT count(*) FILTER (WHERE e.status = 'active')::int AS active,
            count(*) FILTER (WHERE e.status = 'canceled')::int AS canceled,
            count(*) FILTER (WHERE e.status = 'refunded')::int AS refunded,
            count(*) FILTER (WHERE e.completed_at IS NOT NULL)::int AS completed
       ${from} ${f.sql}`,
    f.params,
  );

  return {
    enrollments,
    meta: paginatedMeta({ page: filters.page, limit: filters.limit, total }),
    summary: summary[0],
  };
}

/**
 * Cancela a matrícula.
 *
 * NÃO faz DELETE. `lesson_progress` e `quiz_attempts` pendem da matrícula com
 * ON DELETE CASCADE: apagar a linha apagaria o progresso e o histórico de
 * quizzes do aluno sem nenhum rastro. O `status` marca a saída e preserva tudo.
 *
 * O certificado é revogado junto, porque ele atesta a conclusão de um curso que
 * o aluno não pode mais cursar.
 */
export async function cancelEnrollment(actor, enrollmentId, reason) {
  const row = await queryOne(
    `SELECT e.id, e.status, e.user_id, e.course_id, e.completed_at,
            u.name AS "userName", u.email AS "userEmail", c.title AS "courseTitle"
       FROM enrollments e JOIN users u ON u.id = e.user_id JOIN courses c ON c.id = e.course_id
      WHERE e.id = $1`,
    [enrollmentId],
  );
  if (!row) throw notFound('Matrícula não encontrada.');
  if (row.status !== 'active') {
    throw conflict(`Esta matrícula já está ${row.status === 'refunded' ? 'reembolsada' : 'cancelada'}.`);
  }

  const clean = reason?.trim() || 'Matrícula cancelada pela administração.';

  return transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE enrollments
          SET status = 'canceled', canceled_at = now(), canceled_by = $2, cancel_reason = $3
        WHERE id = $1
        RETURNING id, status, canceled_at AS "canceledAt", cancel_reason AS "cancelReason"`,
      [enrollmentId, actor.id, clean],
    );

    // `COALESCE` porque pode haver certificado já revogado; o motivo, esse,
    // só é gravado agora — um certificado revogado antes desta migration não
    // tinha motivo, e não é para a gente inventar um retrospectivo.
    const { rows: certs } = await client.query(
      `UPDATE certificates
          SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = $3
        WHERE user_id = $1 AND course_id = $2 AND revoked_at IS NULL RETURNING id`,
      [row.user_id, row.course_id, clean],
    );

    // O aluno perde o acesso imediatamente, sem esperar o token expirar.
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [row.user_id]);

    await recordAudit(client, actor, 'enrollment.cancel', { type: 'enrollment', id: enrollmentId }, {
      summary: `Matrícula de ${row.userName} em "${row.courseTitle}" cancelada${row.completed_at ? ' (curso já concluído)' : ''}. Motivo: ${clean}`,
      before: { status: 'active', completed: Boolean(row.completed_at) },
      after: { status: 'canceled', revokedCertificates: certs.length },
    });

    return { enrollment: rows[0], revokedCertificates: certs.length };
  });
}

/** Reinscreve uma matrícula cancelada, reaproveitando o progresso guardado. */
export async function reactivateEnrollment(actor, enrollmentId) {
  const row = await queryOne(
    `SELECT e.id, e.status, u.name AS "userName", c.title AS "courseTitle"
       FROM enrollments e JOIN users u ON u.id = e.user_id JOIN courses c ON c.id = e.course_id
      WHERE e.id = $1`,
    [enrollmentId],
  );
  if (!row) throw notFound('Matrícula não encontrada.');
  if (row.status === 'active') throw conflict('Esta matrícula já está ativa.');
  if (row.status === 'refunded') {
    throw conflict('Uma matrícula reembolsada não volta: o aluno precisa comprar de novo.');
  }

  return transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE enrollments
          SET status = 'active', canceled_at = NULL, canceled_by = NULL, cancel_reason = NULL
        WHERE id = $1 RETURNING id, status`,
      [enrollmentId],
    );
    await recordAudit(client, actor, 'enrollment.reactivate', { type: 'enrollment', id: enrollmentId }, {
      summary: `Matrícula de ${row.userName} em "${row.courseTitle}" reativada com o progresso preservado`,
      before: { status: row.status },
      after: { status: 'active' },
    });
    return rows[0];
  });
}

export const certificatesQuerySchema = pagination.extend({
  revoked: booleanFlag(),
  courseId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
});

export async function listCertificates(filters) {
  const f = where();
  if (filters.revoked !== undefined) {
    f.add(filters.revoked ? 'cert.revoked_at IS NOT NULL' : 'cert.revoked_at IS NULL');
  }
  if (filters.courseId) f.add('cert.course_id = ?', filters.courseId);
  if (filters.userId) f.add('cert.user_id = ?', filters.userId);
  if (filters.search) f.add(`(${unaccentedMatch(['u.name', 'u.email', 'cert.code'], '?')})`, filters.search);

  const from = `
    FROM certificates cert
    JOIN users u ON u.id = cert.user_id
    JOIN courses c ON c.id = cert.course_id
  `;

  const { rows: countRows } = await query(`SELECT count(*)::int AS total ${from} ${f.sql}`, f.params);
  const total = countRows[0].total;

  const { sql, params } = f.limitOffset(filters.limit, (filters.page - 1) * filters.limit);
  const certificates = await queryAll(
    `SELECT cert.id, cert.code, cert.final_score AS "finalScore",
            cert.issued_at AS "issuedAt", cert.revoked_at AS "revokedAt",
            cert.revoked_reason AS "revokedReason",
            u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
            c.id AS "courseId", c.title AS "courseTitle", c.slug AS "courseSlug"
       ${from} ${f.sql} ORDER BY cert.issued_at DESC ${sql}`,
    params,
  );

  const { rows: summary } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE cert.revoked_at IS NOT NULL)::int AS revoked
       ${from} ${f.sql}`,
    f.params,
  );

  return {
    certificates,
    meta: paginatedMeta({ page: filters.page, limit: filters.limit, total }),
    summary: summary[0],
  };
}

/** Revoga ou restaura um certificado, com motivo no registro. */
export async function setCertificateRevoked(actor, certificateId, revoked, reason) {
  const cert = await queryOne(
    `SELECT cert.id, cert.code, cert.revoked_at, cert.revoked_reason, cert.final_score,
            u.name AS "userName", c.title AS "courseTitle"
       FROM certificates cert JOIN users u ON u.id = cert.user_id JOIN courses c ON c.id = cert.course_id
      WHERE cert.id = $1`,
    [certificateId],
  );
  if (!cert) throw notFound('Certificado não encontrado.');
  if (revoked && cert.revoked_at) throw conflict('Este certificado já está revogado.');
  if (!revoked && !cert.revoked_at) throw conflict('Este certificado está válido.');

  const clean = reason?.trim() || null;

  return transaction(async (client) => {
    // O motivo vai para o próprio certificado, não só para a auditoria: é o que
    // a ficha do aluno mostra quando pergunta por que perdeu o certificado.
    // Restaurar limpa o motivo junto com a data, senão o certificado voltaria
    // exibindo a justificativa de uma revogação que não existe mais.
    const { rows } = await client.query(
      `UPDATE certificates
          SET revoked_at = $2, revoked_reason = $3
        WHERE id = $1
        RETURNING id, code, revoked_at AS "revokedAt", revoked_reason AS "revokedReason"`,
      [certificateId, revoked ? new Date() : null, revoked ? clean : null],
    );
    await recordAudit(
      client,
      actor,
      revoked ? 'certificate.revoke' : 'certificate.restore',
      { type: 'certificate', id: certificateId },
      {
        summary: revoked
          ? `Certificado ${cert.code} de ${cert.userName} ("${cert.courseTitle}") revogado${clean ? `. Motivo: ${clean}` : ''}`
          : `Certificado ${cert.code} de ${cert.userName} restaurado`,
        before: { revokedAt: cert.revoked_at, reason: cert.revoked_reason },
        after: { revokedAt: rows[0].revokedAt, reason: clean },
      },
    );
    return rows[0];
  });
}
