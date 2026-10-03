import PDFDocument from 'pdfkit';
import { query, queryAll, queryOne } from '../config/database.js';
import { notFound, badRequest } from '../utils/errors.js';
import { generateCertificateCode } from '../utils/helpers.js';

/** Nota média do aluno no curso, usada como `finalScore`. */
async function averageQuizScore(userId, courseId) {
  const row = await queryOne(
    `SELECT round(avg(qa.score_percent))::smallint AS score
       FROM quiz_attempts qa
       JOIN quizzes q  ON q.id = qa.quiz_id
       JOIN lessons l  ON l.id = q.lesson_id
       JOIN modules m  ON m.id = l.module_id
      WHERE qa.user_id = $1 AND m.course_id = $2 AND qa.passed`,
    [userId, courseId],
  );
  return row?.score ?? null;
}

/** Conclusão mínima exigida para emitir certificado. */
export const PASS_PERCENT_TO_ISSUE = 100;

/**
 * Emite (ou devolve) o certificado do aluno. Idempotente por
 * (user, course) — a constraint UNIQUE do banco garante isso.
 */
export async function issueCertificate(userId, courseId) {
  const progress = await queryOne(
    `SELECT cp.total_lessons AS total, cp.completed_lessons AS completed,
            c.certificate_enabled AS "certificateEnabled"
       FROM course_progress cp
       JOIN enrollments e ON e.id = cp.enrollment_id
       JOIN courses c ON c.id = e.course_id
      WHERE e.user_id = $1 AND e.course_id = $2`,
    [userId, courseId],
  );

  if (!progress) throw badRequest('Você não está matriculado neste curso.');
  if (!progress.certificateEnabled) throw badRequest('Este curso não oferece certificado.');
  if (progress.completed < progress.total || progress.total === 0) {
    throw badRequest('Conclua todas as aulas para emitir o certificado.', {
      totalLessons: progress.total,
      completedLessons: progress.completed,
    });
  }

  const existing = await queryOne(
    'SELECT * FROM certificates WHERE user_id = $1 AND course_id = $2',
    [userId, courseId],
  );
  if (existing && !existing.revoked_at) return existing;

  const finalScore = await averageQuizScore(userId, courseId);

  /*
   * `ON CONFLICT DO UPDATE` (e não `DO NOTHING`) porque o certificado revogado
   * por um reembolso é o MESMO documento: a pessoa concluiu o curso uma vez e
   * voltou a comprar, então a conclusão continua de pé. Restore preserva o
   * código público — quem já tinha o link continua a ver o mesmo certificado
   * passar de "revogado" para "válido", em vez de o link antigo apontar para um
   * certificado morto e o novo nascer com outro código.
   */
  const { rows } = await query(
    `INSERT INTO certificates (user_id, course_id, code, final_score)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, course_id) DO UPDATE
       SET final_score   = EXCLUDED.final_score,
           revoked_at    = NULL,
           revoked_reason = NULL
     RETURNING *`,
    [userId, courseId, generateCertificateCode(), finalScore],
  );
  return rows[0];
}

const CERT_SELECT = `
  SELECT c.id, c.code, c.final_score AS "finalScore",
         c.issued_at AS "issuedAt", c.revoked_at AS "revokedAt",
         c.course_id AS "courseId", c.user_id AS "userId",
         co.title AS "courseTitle", co.slug AS "courseSlug",
         co.duration_minutes AS "courseDurationMinutes",
         u.name AS "userName", u.email AS "userEmail"
    FROM certificates c
    JOIN courses co ON co.id = c.course_id
    JOIN users u    ON u.id = c.user_id
`;

export const listCertificates = (userId) =>
  queryAll(`${CERT_SELECT} WHERE c.user_id = $1 AND c.revoked_at IS NULL ORDER BY c.issued_at DESC`, [userId]);

export const getCertificate = (userId, code) =>
  queryOne(`${CERT_SELECT} WHERE c.code = $1 AND c.user_id = $2`, [code, userId]);

/** Endpoint público de verificação (sem autenticação). */
export const verifyCertificate = async (code) => {
  const cert = await queryOne(
    `SELECT c.code, c.final_score AS "finalScore", c.issued_at AS "issuedAt",
            c.revoked_at AS "revokedAt",
            co.title AS "courseTitle", u.name AS "userName"
       FROM certificates c
       JOIN courses co ON co.id = c.course_id
       JOIN users u    ON u.id = c.user_id
      WHERE c.code = $1`,
    [code],
  );
  return cert
    ? { valid: !cert.revokedAt, certificate: cert }
    : { valid: false, certificate: null };
};

const GOLD = '#b8860b';
const INK = '#1f2937';

const formatWorkload = (minutes) => {
  const total = Number(minutes) || 0;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}min`;
  return rest ? `${hours}h${rest}min` : `${hours}h`;
};

function drawBorder(doc) {
  const inset = 24;
  const w = doc.page.width - inset * 2;
  const h = doc.page.height - inset * 2;
  doc.save();
  doc.lineWidth(3).strokeColor(GOLD).rect(inset, inset, w, h).stroke();
  doc.lineWidth(1).strokeColor(GOLD).rect(inset + 8, inset + 8, w - 16, h - 16).stroke();
  doc.restore();
}

/** Desenha o PDF do certificado e devolve um stream. */
export function renderCertificatePdf(cert) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 56 });
  drawBorder(doc);

  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(14).text('LEARNUP', 0, 70, { align: 'center', width: doc.page.width });
  doc.fontSize(30).text('CERTIFICADO DE CONCLUSÃO', 0, 92, { align: 'center', width: doc.page.width });

  doc.fillColor(INK).font('Helvetica').fontSize(13).text('Certificamos que', 0, 165, { align: 'center', width: doc.page.width });

  doc.font('Helvetica-Bold').fontSize(26).text(cert.userName, 0, 190, { align: 'center', width: doc.page.width });

  doc
    .font('Helvetica')
    .fontSize(13)
    .text('concluiu com aproveitamento o curso', 0, 232, { align: 'center', width: doc.page.width });

  doc.font('Helvetica-Bold').fontSize(20).text(cert.courseTitle, 0, 256, { align: 'center', width: doc.page.width });

  const details = [
    cert.finalScore != null ? `Nota final: ${cert.finalScore}%` : null,
    cert.courseDurationMinutes ? `Carga horária: ${formatWorkload(cert.courseDurationMinutes)}` : null,
    `Emitido em: ${new Date(cert.issuedAt).toLocaleDateString('pt-BR')}`,
  ]
    .filter(Boolean)
    .join('   •   ');

  doc.font('Helvetica').fontSize(11).fillColor('#4b5563').text(details, 0, 292, { align: 'center', width: doc.page.width });

  // Bloco de assinatura
  const y = 380;
  doc.moveTo(180, y).lineTo(320, y).lineWidth(1).strokeColor('#9ca3af').stroke();
  doc.moveTo(doc.page.width - 320, y).lineTo(doc.page.width - 180, y).stroke();
  doc.fillColor(INK).fontSize(10).text('LearnUp', 180, y + 6, { width: 140, align: 'center' });
  doc.text(cert.userName, doc.page.width - 320, y + 6, { width: 140, align: 'center' });

  doc.fontSize(9).fillColor('#6b7280').text(`Código de verificação: ${cert.code}`, 0, y + 70, {
    align: 'center',
    width: doc.page.width,
  });

  doc.end();
  return doc;
}

export async function getCertificateOrThrow(userId, code) {
  const cert = await getCertificate(userId, code);
  if (!cert) throw notFound('Certificado não encontrado.');
  return cert;
}
