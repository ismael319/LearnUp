import { z } from 'zod';
import { query, queryAll, queryOne, transaction } from '../../config/database.js';
import { badRequest, notFound, conflict } from '../../utils/errors.js';
import { slugify } from '../../utils/helpers.js';
import { recordAudit } from './audit.js';
import { BADGE_CRITERIA, BADGE_CRITERIA_LABELS, awardPoints } from '../../services/gamification.js';

// --- Categorias ------------------------------------------------------------

export const categorySchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da categoria.').max(80),
  icon: z.string().trim().max(40).nullable().optional(),
  slug: z.string().trim().max(80).optional(),
});

export const categoryPatchSchema = categorySchema.partial();

/**
 * Categorias com a contagem de cursos.
 *
 * A FK `courses.category_id` é `ON DELETE SET NULL`, então apagar uma categoria
 * não quebra curso nenhum — mas deixa todos eles sem categoria, o que é uma
 * perda silenciosa de organização. Por isso `deleteCategory` recusa quando há
 * cursos e a interface oferece antes a desvinculação em bloco.
 */
export async function listCategories() {
  return queryAll(
    `SELECT c.id, c.name, c.slug, c.icon, c.created_at AS "createdAt",
            (SELECT count(*) FROM courses co WHERE co.category_id = c.id)::int AS "courseCount"
       FROM categories c ORDER BY c.name`,
  );
}

export async function createCategory(actor, payload) {
  const slug = payload.slug || slugify(payload.name);
  const { rows: clash } = await query('SELECT id FROM categories WHERE slug = $1', [slug]);
  if (clash[0]) throw conflict('Já existe uma categoria com este endereço.');

  return transaction(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO categories (name, slug, icon) VALUES ($1, $2, $3) RETURNING id, name, slug, icon',
      [payload.name, slug, payload.icon ?? null],
    );
    await recordAudit(client, actor, 'category.create', { type: 'category', id: rows[0].id }, {
      summary: `Categoria "${rows[0].name}" criada`,
      after: rows[0],
    });
    return rows[0];
  });
}

export async function updateCategory(actor, categoryId, payload) {
  const current = await queryOne('SELECT id, name, slug, icon FROM categories WHERE id = $1', [categoryId]);
  if (!current) throw notFound('Categoria não encontrada.');

  const nextSlug = payload.slug ?? (payload.name ? slugify(payload.name) : current.slug);
  if (nextSlug !== current.slug) {
    const { rows: clash } = await query('SELECT id FROM categories WHERE slug = $1', [nextSlug]);
    if (clash[0]) throw conflict('Já existe uma categoria com este endereço.');
  }

  return transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE categories SET name = $2, slug = $3, icon = $4
        WHERE id = $1 RETURNING id, name, slug, icon`,
      [categoryId, payload.name ?? current.name, nextSlug, payload.icon === undefined ? current.icon : payload.icon],
    );
    await recordAudit(client, actor, 'category.update', { type: 'category', id: categoryId }, {
      summary: `Categoria "${current.name}" editada`,
      before: current,
      after: rows[0],
    });
    return rows[0];
  });
}

export async function deleteCategory(actor, categoryId) {
  const current = await queryOne(
    `SELECT cat.id, cat.name, cat.slug,
            (SELECT count(*) FROM courses c WHERE c.category_id = cat.id)::int AS "courseCount"
       FROM categories cat WHERE cat.id = $1`,
    [categoryId],
  );
  if (!current) throw notFound('Categoria não encontrada.');

  if (current.courseCount > 0) {
    throw conflict(
      `${current.courseCount} curso(s) usam esta categoria. Desvincule-os antes (ou a categoria será removida e eles ficarão sem categoria).`,
    );
  }

  return transaction(async (client) => {
    await client.query('DELETE FROM categories WHERE id = $1', [categoryId]);
    await recordAudit(client, actor, 'category.delete', { type: 'category', id: categoryId }, {
      summary: `Categoria "${current.name}" removida`,
      before: current,
    });
    return { deleted: { id: categoryId, name: current.name } };
  });
}

/** Tira a categoria de todos os cursos que a usam, sem apagar a categoria. */
export async function uncategorizeCourses(actor, categoryId) {
  const current = await queryOne('SELECT id, name FROM categories WHERE id = $1', [categoryId]);
  if (!current) throw notFound('Categoria não encontrada.');

  return transaction(async (client) => {
    const { rowCount } = await client.query(
      'UPDATE courses SET category_id = NULL WHERE category_id = $1',
      [categoryId],
    );
    await recordAudit(client, actor, 'category.uncategorize', { type: 'category', id: categoryId }, {
      summary: `${rowCount} curso(s) foram desvinculados da categoria "${current.name}"`,
      after: { uncategorized: rowCount },
    });
    return { uncategorized: rowCount };
  });
}

// --- Badges ----------------------------------------------------------------

export const badgeSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'Use apenas letras minúsculas, números e underscore.'),
  name: z.string().trim().min(2, 'Informe o nome da conquista.').max(80),
  description: z.string().trim().max(240).optional(),
  icon: z.string().trim().max(40).optional(),
  points: z.coerce.number().int().min(0).max(100000).default(0),
  criteria: z.enum(Object.keys(BADGE_CRITERIA), {
    errorMap: () => ({ message: `Critério inválido. Use um dos: ${Object.keys(BADGE_CRITERIA).join(', ')}` }),
  }),
});

export const badgePatchSchema = badgeSchema.partial();

export async function listBadges() {
  const badges = await queryAll(
    `SELECT b.id, b.key, b.name, b.description, b.icon, b.points, b.criteria,
            (SELECT count(*) FROM user_badges ub WHERE ub.badge_id = b.id)::int AS "awardedCount"
       FROM badges b ORDER BY b.points, b.name`,
  );
  return badges.map((b) => ({ ...b, criteriaLabel: BADGE_CRITERIA_LABELS[b.criteria] ?? b.criteria }));
}

export const criteriaCatalog = () =>
  Object.keys(BADGE_CRITERIA).map((value) => ({ value, label: BADGE_CRITERIA_LABELS[value] ?? value }));

export async function createBadge(actor, payload) {
  const { rows: clash } = await query('SELECT id FROM badges WHERE key = $1', [payload.key]);
  if (clash[0]) throw conflict('Já existe uma conquista com esta chave.');

  return transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO badges (key, name, description, icon, points, criteria)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, key, name, description, icon, points, criteria`,
        [payload.key, payload.name, payload.description ?? '', payload.icon ?? '🏅', payload.points, payload.criteria],
    );
    await recordAudit(client, actor, 'badge.create', { type: 'badge', id: rows[0].id }, {
      summary: `Conquista "${rows[0].name}" criada (${rows[0].criteria})`,
      after: rows[0],
    });
    return rows[0];
  });
}

export async function updateBadge(actor, badgeId, payload) {
  const current = await queryOne('SELECT * FROM badges WHERE id = $1', [badgeId]);
  if (!current) throw notFound('Conquista não encontrada.');

  if (payload.key && payload.key !== current.key) {
    const { rows: clash } = await query('SELECT id FROM badges WHERE key = $1', [payload.key]);
    if (clash[0]) throw conflict('Já existe uma conquista com esta chave.');
  }

  // Trocar o critério de uma badge já concedida não devolve a conquista nem
  // remove a que está na mão do aluno; a fila só roda em `syncBadges`.
  const criteriaChanged = payload.criteria && payload.criteria !== current.criteria;

  const result = await transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE badges SET key = $2, name = $3, description = $4, icon = $5, points = $6, criteria = $7
        WHERE id = $1
        RETURNING id, key, name, description, icon, points, criteria`,
      [
        badgeId,
        payload.key ?? current.key,
        payload.name ?? current.name,
        payload.description === undefined ? current.description : (payload.description ?? ''),
        payload.icon === undefined ? current.icon : (payload.icon ?? '🏅'),
        payload.points ?? current.points,
        payload.criteria ?? current.criteria,
      ],
    );
    await recordAudit(client, actor, 'badge.update', { type: 'badge', id: badgeId }, {
      summary: `Conquista "${current.name}" editada`,
      before: {
        key: current.key,
        name: current.name,
        points: current.points,
        criteria: current.criteria,
      },
      after: rows[0],
    });
    return rows[0];
  });

  if (criteriaChanged) {
    const { syncBadges } = await import('../../services/gamification.js');
    // O critério novo pode valer para quem já tem o histórico: rodamos a fila
    // para todos que já receberam esta badge, senão a edição não teria efeito
    // prático nenhum.
    const { rows: holders } = await queryAll('SELECT user_id FROM user_badges WHERE badge_id = $1', [badgeId]);
    for (const holder of holders) await syncBadges(holder.user_id);
  }

  return result;
}

/**
 * Remove a badge. Quem já tinha continua com a linha em `user_badges` apontando
 * para o badge removido? Não: a FK é CASCADE, então as concessões caem junto.
 * Por isso a tela avisa quantas pessoas vão perder a conquista.
 */
export async function deleteBadge(actor, badgeId) {
  const current = await queryOne(
    `SELECT b.id, b.key, b.name,
            (SELECT count(*) FROM user_badges ub WHERE ub.badge_id = b.id)::int AS "awardedCount"
       FROM badges b WHERE b.id = $1`,
    [badgeId],
  );
  if (!current) throw notFound('Conquista não encontrada.');

  return transaction(async (client) => {
    await client.query('DELETE FROM badges WHERE id = $1', [badgeId]);
    await recordAudit(client, actor, 'badge.delete', { type: 'badge', id: badgeId }, {
      summary: `Conquista "${current.name}" removida de ${current.awardedCount} pessoa(s)`,
      before: current,
    });
    return { deleted: { id: badgeId, name: current.name }, affected: current.awardedCount };
  });
}

/** Concede a badge a um aluno à mão, com motivo. */
export async function awardBadge(actor, badgeId, userId, reason) {
  const badge = await queryOne('SELECT id, key, name, points FROM badges WHERE id = $1', [badgeId]);
  if (!badge) throw notFound('Conquista não encontrada.');

  const user = await queryOne('SELECT id, name, email FROM users WHERE id = $1', [userId]);
  if (!user) throw notFound('Usuário não encontrado.');

  const clean = reason?.trim() || 'Concedida pela administração.';
  const before = await queryOne('SELECT id, awarded_at FROM user_badges WHERE badge_id = $1 AND user_id = $2', [
    badgeId,
    userId,
  ]);
  if (before) throw conflict(`${user.name} já tem esta conquista.`);

    return transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2)
         RETURNING id, awarded_at AS "awardedAt"`,
        [userId, badgeId],
      );

      // Os pontos são parte da concessão: sem creditar aqui, a badge apareceria
      // na ficha valendo 25 pontos e o aluno não teria nenhum. `syncBadges` faz
      // o mesmo no caminho automático.
      //
      // O `refId` é a linha da concessão, não a badge: o razão é único por
      // (usuário, reason, ref), então ancorar na badge faria uma segunda
      // concessão da mesma conquista — depois de uma retirada — ser engolida pelo
      // conflito e não pontuar.
      await awardPoints(client, {
        userId,
        points: badge.points,
        reason: `badge.${badge.key}`,
        refType: 'badge',
        refId: rows[0].id,
      });

      await recordAudit(client, actor, 'badge.award', { type: 'badge', id: badgeId }, {
        summary: `Conquista "${badge.name}" concedida a ${user.name} (${user.email}). Motivo: ${clean}`,
        after: {
          user: { id: user.id, name: user.name },
          awardId: rows[0].id,
          awardedAt: rows[0].awardedAt,
          points: badge.points,
        },
      });
      return { award: rows[0], user, badge };
    });
}

/** Retira a badge da mão de alguém. */
export async function revokeBadgeFromUser(actor, badgeId, userId) {
  const row = await queryOne(
    `SELECT ub.id, u.name AS "userName", b.name AS "badgeName", b.key AS "badgeKey", b.points
       FROM user_badges ub JOIN users u ON u.id = ub.user_id JOIN badges b ON b.id = ub.badge_id
      WHERE ub.badge_id = $1 AND ub.user_id = $2`,
    [badgeId, userId],
  );
  if (!row) throw notFound('Este usuário não tem esta conquista.');

  return transaction(async (client) => {
    await client.query('DELETE FROM user_badges WHERE id = $1', [row.id]);

    // Estorno simétrico à concessão: retirar a badge devolve os pontos que ela
    // tinha creditado. O razão é distinto do crédito de propósito — o índice
    // único do razão é por (usuário, reason, ref), e o mesmo par não pode
    // conviver com duas entradas. Ancorar na linha da concessão mantém o
    // estorno pareado com o crédito, e uma segunda retirada não debita de novo.
    await awardPoints(client, {
      userId,
      points: -row.points,
      reason: `badge.revoked.${row.badgeKey}`,
      refType: 'badge',
      refId: row.id,
    });

    await recordAudit(client, actor, 'badge.revoke', { type: 'badge', id: badgeId }, {
      summary: `Conquista "${row.badgeName}" retirada de ${row.userName}`,
      before: { userId, badgeId, points: row.points },
    });
    return { revoked: { id: row.id } };
  });
}

/** Conquistas de um usuário, para a ficha dele. */
export async function listUserAwards(userId) {
  return queryAll(
    `SELECT ub.id, ub.awarded_at AS "awardedAt", b.id AS "badgeId", b.key, b.name, b.icon, b.points
       FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
      WHERE ub.user_id = $1 ORDER BY ub.awarded_at DESC`,
    [userId],
  );
}
