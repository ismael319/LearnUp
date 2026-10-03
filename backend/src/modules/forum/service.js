import { z } from 'zod';
import { query, queryAll, queryOne } from '../../config/database.js';
import { notFound, forbidden, badRequest } from '../../utils/errors.js';
import { paginatedMeta } from '../../middleware/pagination.js';
import { POINTS, credit } from '../../services/gamification.js';
import { assertEnrolled } from '../../services/enrollments.js';

const POST_SELECT = `
  SELECT p.id, p.title, p.content, p.course_id AS "courseId",
         p.is_pinned AS "isPinned", p.is_locked AS "isLocked",
         p.views_count AS "viewsCount",
         p.created_at AS "createdAt", p.updated_at AS "updatedAt",
         u.id AS "userId", u.name AS "userName", u.avatar_url AS "userAvatarUrl",
         (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.hidden_at IS NULL)::int AS "commentsCount"
    FROM posts p JOIN users u ON u.id = p.user_id
`;

/**
 * Moderação: conteúdo ocultado pela administração continua no banco (para
 * auditoria e para o post voltar a aparecer se for desocultado), mas some do
 * fórum. Aplicar `hidden_at IS NULL` aqui e não só no painel é o que impede a
 * tela pública de servir o que o admin acabou de tirar.
 */
const POST_VISIBLE = 'p.hidden_at IS NULL';
const COMMENT_VISIBLE = 'c.hidden_at IS NULL';

export const listPostsSchema = z.object({
  courseId: z.string().uuid().optional(),
  authorId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(['recent', 'top', 'unanswered']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * Listagem do fórum. `courseId` só aparece no filtro; leitura de posts
 * vinculados a curso é liberada a qualquer aluno matriculado.
 */
export async function listPosts(filters) {
  const values = [];
  const where = [POST_VISIBLE];
  const add = (sql, value) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };

  if (filters.courseId) add('p.course_id = ?', filters.courseId);
  if (filters.authorId) add('p.user_id = ?', filters.authorId);
  if (filters.search) {
    values.push(filters.search);
    const p = `$${values.length}`;
    // `unaccent_immutable` nos dois lados: digitar "seguranca" acha "segurança".
    where.push(
      `(unaccent_immutable(p.title) ILIKE '%' || unaccent_immutable(${p}) || '%'
        OR unaccent_immutable(p.content) ILIKE '%' || unaccent_immutable(${p}) || '%')`,
    );
  }
  if (filters.sort === 'unanswered') {
    // Um post cujo único comentário foi ocultado volta a contar como "sem
    // resposta" — é o que a pessoa que filtra por isso espera ver.
    where.push(`NOT EXISTS (SELECT 1 FROM comments c WHERE c.post_id = p.id AND ${COMMENT_VISIBLE})`);
  }

  const clause = `WHERE ${where.join(' AND ')}`;
  const order = {
    recent: 'p.is_pinned DESC, p.created_at DESC',
    top: `p.is_pinned DESC, (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND ${COMMENT_VISIBLE}) DESC, p.created_at DESC`,
    unanswered: 'p.is_pinned DESC, p.created_at DESC',
  }[filters.sort];

  const { rows: countRows } = await query(`SELECT count(*)::int AS total FROM posts p ${clause}`, values);
  const total = countRows[0].total;

  const rows = await queryAll(
    `${POST_SELECT} ${clause} ORDER BY ${order}
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, filters.limit, (filters.page - 1) * filters.limit],
  );

  return { posts: rows, meta: paginatedMeta({ page: filters.page, limit: filters.limit, total }) };
}

export async function createPost(userId, { title, content, courseId }) {
  if (courseId) await assertEnrolled(userId, courseId);

  const { rows } = await query(
    `INSERT INTO posts (user_id, course_id, title, content) VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, courseId ?? null, title, content],
  );

  await credit({
    userId,
    points: POINTS['forum.post.created'],
    reason: 'forum.post.created',
    refType: 'post',
    refId: rows[0].id,
  });
  return getPost(rows[0].id);
}

/** Detalhe do post + árvore de comentários (2 níveis). Incrementa views. */
export async function getPost(postId, { incrementViews = true } = {}) {
  // Post oculto responde 404, não "403": o público não deve nem saber que ele existe.
  const post = await queryOne(`${POST_SELECT} WHERE ${POST_VISIBLE} AND p.id = $1`, [postId]);
  if (!post) throw notFound('Post não encontrado.');
  if (incrementViews) await query('UPDATE posts SET views_count = views_count + 1 WHERE id = $1', [postId]);

  const flat = await queryAll(
    `SELECT c.id, c.post_id AS "postId", c.parent_id AS "parentId", c.content,
            c.created_at AS "createdAt",
            u.id AS "userId", u.name AS "userName", u.avatar_url AS "avatarUrl", u.role AS "userRole"
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id = $1 AND ${COMMENT_VISIBLE}
      ORDER BY c.created_at ASC`,
    [postId],
  );

  // Uma resposta cujo pai foi ocultado não pode virar órfã na raiz da árvore:
  // subir um nível mantém a conversa legível depois que a moderação age.
  const visibleIds = new Set(flat.map((c) => c.id));
  const comments = flat
    .filter((c) => !c.parentId || !visibleIds.has(c.parentId))
    .map((c) => ({ ...c, replies: flat.filter((r) => r.parentId === c.id) }));

  return { ...post, viewsCount: post.viewsCount + (incrementViews ? 1 : 0), comments };
}

export async function createComment(userId, postId, { content, parentId }) {
  // `hidden_at IS NULL` evita que alguém responda um tópico que a moderação
  // acabou de tirar do ar.
  const post = await queryOne('SELECT id, is_locked, user_id FROM posts WHERE id = $1 AND hidden_at IS NULL', [
    postId,
  ]);
  if (!post) throw notFound('Post não encontrado.');
  if (post.is_locked) throw forbidden('Este tópico está trancado.');
  if (parentId) {
    const parent = await queryOne('SELECT post_id, parent_id FROM comments WHERE id = $1', [parentId]);
    if (!parent) throw notFound('Comentário pai não encontrado.');
    if (parent.post_id !== postId) throw badRequest('O comentário pai pertence a outro post.');
    // Limita a 2 níveis de aninhamento (comment_depth no banco).
    if (parent.parent_id) {
      throw badRequest('Não é possível responder uma resposta. Responda o comentário raiz.');
    }
  }

  const { rows } = await query(
    `INSERT INTO comments (post_id, user_id, parent_id, content) VALUES ($1, $2, $3, $4) RETURNING id`,
    [postId, userId, parentId ?? null, content],
  );

  await credit({
    userId,
    points: POINTS['forum.comment.created'],
    reason: 'forum.comment.created',
    refType: 'comment',
    refId: rows[0].id,
  });

  const created = await queryOne(
    `SELECT c.id, c.post_id AS "postId", c.parent_id AS "parentId", c.content,
            c.created_at AS "createdAt",
            u.id AS "userId", u.name AS "userName", u.avatar_url AS "avatarUrl"
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
    [rows[0].id],
  );
  return created;
}

export const deletePost = async (postId, user) => {
  const post = await queryOne('SELECT user_id FROM posts WHERE id = $1', [postId]);
  if (!post) throw notFound('Post não encontrado.');
  if (post.user_id !== user.id && !['admin', 'instructor'].includes(user.role)) {
    throw forbidden('Você só pode apagar seus próprios posts.');
  }
  await query('DELETE FROM posts WHERE id = $1', [postId]);
};
