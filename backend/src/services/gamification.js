import { query, queryAll, queryOne, transaction } from '../config/database.js';
import { notFound, badRequest } from '../utils/errors.js';

/** Regras de pontuação. Alterar aqui muda o comportamento do sistema inteiro. */
export const POINTS = {
  'lesson.completed': 10,
  'course.completed': 50,
  'quiz.passed': 25, // sobrescrito por quiz.points_reward quando existir
  'forum.post.created': 5,
  'forum.comment.created': 2,
};

export const LEVEL_STEP = 500; // pontos necessários por nível

export const levelFromPoints = (points) => Math.floor((points ?? 0) / LEVEL_STEP) + 1;

export function levelProgress(points) {
  const current = levelFromPoints(points);
  return {
    current,
    next: current + 1,
    remaining: current * LEVEL_STEP - (points ?? 0),
    step: LEVEL_STEP,
  };
}

/**
 * Credita pontos de forma idempotente.
 *
 * O índice único parcial (user_id, reason, ref_type, ref_id) impede que a
 * mesma conclusão seja pontuada duas vezes — por exemplo, se o cliente
 * chamar "concluir aula" repetidamente ou um webhook de pagamento chegar
 * duplicado.
 *
 * @param {{ query: Function }} [client] cliente de transação, se houver
 * @returns {Promise<number>} pontos creditados (0 se já tinha sido creditado)
 */
export async function awardPoints(client, { userId, points, reason, refType, refId }) {
  if (!points) return 0;
  const db = client ?? { query };

  const { rowCount } = await db.query(
    `INSERT INTO point_ledger (user_id, points, reason, ref_type, ref_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, reason, ref_type, ref_id) WHERE ref_id IS NOT NULL DO NOTHING`,
    [userId, points, reason, refType ?? null, refId ?? null],
  );

  if (rowCount === 0) return 0;
  await db.query('UPDATE users SET points = points + $1 WHERE id = $2', [points, userId]);
  return points;
}

/** Atalho para quando não há transação aberta. */
export const credit = (args) => awardPoints(null, args);

const STATS_SQL = `
  SELECT
    u.points,
    u.streak_days AS "streakDays",
    (SELECT count(*) FROM enrollments e
       WHERE e.user_id = u.id AND e.completed_at IS NOT NULL)::int AS "completedCourses",
    (SELECT count(*) FROM quiz_attempts qa
       WHERE qa.user_id = u.id AND qa.passed)::int               AS "quizzesPassed",
    (SELECT count(*) FROM enrollments e
       WHERE e.user_id = u.id)::int                              AS "enrolled"
  FROM users u
  WHERE u.id = $1
`;

/**
 * Critérios suportados, com a condição que cada um testa.
 *
 * O painel de administração monta o seletor a partir deste mapa, então não há
 * como criar uma badge com critério que o `evaluate` não entende: um texto
 * solto cairia no `default` e a badge nunca seria concedida a ninguém.
 */
export const BADGE_CRITERIA = {
  'enrollments >= 1': (s) => s.enrolled >= 1,
  'courses_completed >= 1': (s) => s.completedCourses >= 1,
  'courses_completed >= 3': (s) => s.completedCourses >= 3,
  'courses_completed >= 10': (s) => s.completedCourses >= 10,
  'quizzes_passed >= 1': (s) => s.quizzesPassed >= 1,
  'quizzes_passed >= 10': (s) => s.quizzesPassed >= 10,
  'points >= 1000': (s) => s.points >= 1000,
  'streak_days >= 7': (s) => s.streakDays >= 7,
};

/** Rótulos para a tela de administração. */
export const BADGE_CRITERIA_LABELS = {
  'enrollments >= 1': 'Matricular-se em 1 curso',
  'courses_completed >= 1': 'Concluir 1 curso',
  'courses_completed >= 3': 'Concluir 3 cursos',
  'courses_completed >= 10': 'Concluir 10 cursos',
  'quizzes_passed >= 1': 'Aprovar 1 quiz',
  'quizzes_passed >= 10': 'Aprovar 10 quizzes',
  'points >= 1000': 'Acumular 1000 pontos',
  'streak_days >= 7': 'Manter 7 dias de sequência',
};

/** Critério desconhecido nunca concede badge — é assim que o default funciona. */
function evaluate(criteria, s) {
  const check = BADGE_CRITERIA[criteria];
  return check ? check(s) : false;
}

/**
 * Concede as badges que o usuário passou a merecer.
 * @returns {Promise<Array>} badges recém-concedidas
 */
export async function syncBadges(userId) {
  const stats = await queryOne(STATS_SQL, [userId]);
  if (!stats) throw notFound('Usuário não encontrado.');

  const earned = [];
  for (const badge of await queryAll('SELECT * FROM badges ORDER BY points, name')) {
    if (!evaluate(badge.criteria, stats)) continue;

    const { rowCount } = await query(
      `INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2)
       ON CONFLICT (user_id, badge_id) DO NOTHING`,
      [userId, badge.id],
    );
    if (rowCount === 0) continue;

    earned.push(badge);
    if (badge.points > 0) {
      await credit({
        userId,
        points: badge.points,
        reason: `badge.${badge.key}`,
        refType: 'badge',
        refId: badge.id,
      });
    }
  }
  return earned;
}

export const listBadges = () => queryAll('SELECT * FROM badges ORDER BY points, name');

export const userBadges = (userId) =>
  queryAll(
    `SELECT b.id, b.key, b.name, b.description, b.icon, b.points,
            ub.awarded_at AS "awardedAt"
       FROM user_badges ub
       JOIN badges b ON b.id = ub.badge_id
      WHERE ub.user_id = $1
      ORDER BY ub.awarded_at DESC`,
    [userId],
  );

export async function userStats(userId) {
  const row = await queryOne(
    `SELECT
       u.points,
       u.streak_days AS "streakDays",
       (SELECT count(*) FROM enrollments e WHERE e.user_id = $1)::int AS "enrolledCourses",
       (SELECT count(*) FROM enrollments e
         WHERE e.user_id = $1 AND e.completed_at IS NOT NULL)::int AS "completedCourses",
       (SELECT count(*) FROM certificates c
         WHERE c.user_id = $1 AND c.revoked_at IS NULL)::int AS "certificatesCount",
       (SELECT count(*) FROM quiz_attempts qa
         WHERE qa.user_id = $1 AND qa.passed)::int AS "quizzesPassed",
       (SELECT count(*) FROM posts p WHERE p.user_id = $1)::int AS "postsCount",
       (SELECT coalesce(sum(c.duration_minutes), 0) FROM enrollments e
          JOIN courses c ON c.id = e.course_id
         WHERE e.user_id = $1 AND e.completed_at IS NOT NULL)::int AS "minutesLearned"
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (!row) throw notFound('Usuário não encontrado.');
  return { ...row, ...levelProgress(row.points) };
}

export const leaderboard = (limit = 20) =>
  queryAll(
    `SELECT u.id, u.name, u.avatar_url AS "avatarUrl", u.points,
            u.streak_days AS "streakDays",
            (SELECT count(*) FROM certificates c
              WHERE c.user_id = u.id AND c.revoked_at IS NULL)::int AS "certificatesCount"
       FROM users u
      WHERE u.points > 0
      ORDER BY u.points DESC, u.created_at ASC
      LIMIT $1`,
    [limit],
  );

/** Recalcula o saldo a partir do ledger (auditoria / repair). */
export async function recomputePoints(userId) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      'SELECT coalesce(sum(points), 0)::int AS total FROM point_ledger WHERE user_id = $1',
      [userId],
    );
    const total = rows[0].total;
    await client.query('UPDATE users SET points = $1 WHERE id = $2', [total, userId]);
    return total;
  });
}

/** Descrição pública das regras, exibida na área do aluno. */
export const rules = () => ({ levelStep: LEVEL_STEP, points: POINTS });

export function assertReason(reason) {
  if (!Object.hasOwn(POINTS, reason) && !reason.startsWith('badge.')) {
    throw badRequest(`Motivo de pontuação desconhecido: ${reason}`);
  }
}
