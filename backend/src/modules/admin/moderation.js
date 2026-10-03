import { z } from 'zod';
import { query, queryAll, queryOne, transaction } from '../../config/database.js';
import { notFound, conflict } from '../../utils/errors.js';
import { booleanFlag } from '../../utils/helpers.js';
import { pagination, paginatedMeta } from '../../middleware/pagination.js';
import { recordAudit } from './audit.js';
import { where, unaccentedMatch } from './filters.js';

/*
 * Moderação com duas operações distintas, de propósito:
 *
 *   ocultar  — `hidden_at`. Some do público, continua no banco, é reversível
 *              e deixa rastro. É o padrão para conteúdo IMPERFEITO.
 *   excluir  — DELETE. Some para sempre e leva os comentários junto (cascade).
 *              Só para o que não pode ficar em lugar nenhum, como dados
 *              pessoais ou spam em volume.
 *
 * Confundir as duas é o erro clássico: apagar um comentário por raiva tira o
 * histórico da discussão e não dá como desfazer.
 */

// --- Avaliações ------------------------------------------------------------

export const reviewsQuerySchema = pagination.extend({
  visibility: z.enum(['visible', 'hidden', 'all']).default('visible'),
  courseId: z.string().uuid().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  search: z.string().trim().max(120).optional(),
  orderBy: z.enum(['recent', 'rating_low', 'rating_high']).default('recent'),
});

const REVIEW_SORTS = {
  recent: 'r.created_at DESC',
  rating_low: 'r.rating ASC, r.created_at DESC',
  rating_high: 'r.rating DESC, r.created_at DESC',
};

export async function listReviews(filters) {
  const f = where();
  if (filters.visibility === 'visible') f.add('r.hidden_at IS NULL');
  if (filters.visibility === 'hidden') f.add('r.hidden_at IS NOT NULL');
  if (filters.courseId) f.add('r.course_id = ?', filters.courseId);
  if (filters.rating) f.add('r.rating = ?', filters.rating);
  if (filters.search) {
    f.add(`(${unaccentedMatch(['r.comment', 'u.name', 'u.email', 'c.title'], '?')})`, filters.search);
  }

  const from = `
    FROM reviews r
    JOIN users u ON u.id = r.user_id
    JOIN courses c ON c.id = r.course_id
  `;

  const { rows: countRows } = await query(`SELECT count(*)::int AS total ${from} ${f.sql}`, f.params);
  const total = countRows[0].total;

  const { sql, params } = f.limitOffset(filters.limit, (filters.page - 1) * filters.limit);
  const reviews = await queryAll(
    `SELECT r.id, r.rating, r.comment, r.created_at AS "createdAt",
            r.hidden_at AS "hiddenAt", r.hidden_by AS "hiddenBy",
            hb.name AS "hiddenByName", r.hidden_reason AS "hiddenReason",
            u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
            c.id AS "courseId", c.title AS "courseTitle", c.slug AS "courseSlug"
       ${from} LEFT JOIN users hb ON hb.id = r.hidden_by ${f.sql}
      ORDER BY ${REVIEW_SORTS[filters.orderBy]} ${sql}`,
    params,
  );

  // Duas consultas com o MESMO nome de propriedade no destructuring: a segunda
  // sobrescreveria a primeira e `summary` viraria `undefined`.
  const [summaryResult, byRating] = await Promise.all([
    query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE r.hidden_at IS NOT NULL)::int AS hidden,
              round(avg(r.rating) FILTER (WHERE r.hidden_at IS NULL)::numeric, 2) AS "ratingAvg"
         ${from} ${f.sql}`,
      f.params,
    ),
    queryAll(
      `SELECT r.rating::int, count(*)::int AS total ${from} ${f.sql} GROUP BY r.rating ORDER BY r.rating DESC`,
      f.params,
    ),
  ]);

  return {
    reviews,
    meta: paginatedMeta({ page: filters.page, limit: filters.limit, total }),
    summary: summaryResult.rows[0],
    byRating,
  };
}

export async function setReviewHidden(actor, reviewId, hidden, reason) {
  const review = await queryOne(
    `SELECT r.id, r.rating, r.comment, r.hidden_at, r.user_id, r.course_id,
            u.name AS "userName", c.title AS "courseTitle"
       FROM reviews r JOIN users u ON u.id = r.user_id JOIN courses c ON c.id = r.course_id
      WHERE r.id = $1`,
    [reviewId],
  );
  if (!review) throw notFound('Avaliação não encontrada.');
  if (hidden && review.hidden_at) throw conflict('Esta avaliação já está oculta.');
  if (!hidden && !review.hidden_at) throw conflict('Esta avaliação já está visível.');

  const clean = hidden ? reason?.trim() || 'Ocultada pela administração.' : null;
  const preview = review.comment?.slice(0, 60) ?? '';

  return transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE reviews SET hidden_at = $2, hidden_by = $3, hidden_reason = $4
        WHERE id = $1
        RETURNING id, rating, hidden_at AS "hiddenAt", hidden_reason AS "hiddenReason"`,
      [reviewId, hidden ? new Date() : null, hidden ? actor.id : null, clean],
    );
    // A nota do curso precisa acompanhar a moderação, senão a ficha do curso
    // continua exibindo a média de uma avaliação que não aparece mais na página.
    await client.query(
      `UPDATE courses c
          SET rating_avg = coalesce((SELECT round(avg(rating)::numeric, 2) FROM reviews
                                     WHERE course_id = c.id AND hidden_at IS NULL), 0),
              rating_count = (SELECT count(*) FROM reviews
                               WHERE course_id = c.id AND hidden_at IS NULL)
        WHERE c.id = $1`,
      [review.courseId],
    );
    await recordAudit(
      client,
      actor,
      hidden ? 'review.hide' : 'review.show',
      { type: 'review', id: reviewId },
      {
        summary: hidden
          ? `Avaliação ${review.rating}★ de ${review.userName} em "${review.courseTitle}" ocultada: "${preview}…"${clean ? `. Motivo: ${clean}` : ''}`
          : `Avaliação de ${review.userName} em "${review.courseTitle}" voltou a ficar visível`,
        before: { hiddenAt: review.hidden_at },
        after: { hiddenAt: rows[0].hiddenAt, reason: clean },
      },
    );
    return rows[0];
  });
}

export async function deleteReview(actor, reviewId) {
  const review = await queryOne(
    `SELECT r.id, r.rating, r.comment, r.course_id, u.name AS "userName", c.title AS "courseTitle"
       FROM reviews r JOIN users u ON u.id = r.user_id JOIN courses c ON c.id = r.course_id
      WHERE r.id = $1`,
    [reviewId],
  );
  if (!review) throw notFound('Avaliação não encontrada.');

  return transaction(async (client) => {
    await client.query('DELETE FROM reviews WHERE id = $1', [reviewId]);
    // Mesma razão de `setReviewHidden`: sem isto, a nota do curso fica presa ao
    // número de avaliações anterior à exclusão.
    await client.query(
      `UPDATE courses c
          SET rating_avg = coalesce((SELECT round(avg(rating)::numeric, 2) FROM reviews
                                     WHERE course_id = c.id AND hidden_at IS NULL), 0),
              rating_count = (SELECT count(*) FROM reviews
                               WHERE course_id = c.id AND hidden_at IS NULL)
        WHERE c.id = $1`,
      [review.courseId],
    );
    await recordAudit(client, actor, 'review.delete', { type: 'review', id: reviewId }, {
      summary: `Avaliação ${review.rating}★ de ${review.userName} em "${review.courseTitle}" excluída: "${(review.comment ?? '').slice(0, 60)}…"`,
      before: { id: review.id, rating: review.rating },
    });
    return { deleted: { id: reviewId } };
  });
}

// --- Posts e comentários ----------------------------------------------------

export const postsQuerySchema = pagination.extend({
  visibility: z.enum(['visible', 'hidden', 'all']).default('visible'),
  courseId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  locked: booleanFlag(),
  search: z.string().trim().max(120).optional(),
});

export async function listPostsForModeration(filters) {
  const f = where();
  if (filters.visibility === 'visible') f.add('p.hidden_at IS NULL');
  if (filters.visibility === 'hidden') f.add('p.hidden_at IS NOT NULL');
  if (filters.courseId) f.add('p.course_id = ?', filters.courseId);
  if (filters.userId) f.add('p.user_id = ?', filters.userId);
  if (filters.locked !== undefined) f.add(filters.locked ? 'p.is_locked' : 'NOT p.is_locked');
  if (filters.search) {
    f.add(`(${unaccentedMatch(['p.title', 'p.content', 'u.name', 'u.email'], '?')})`, filters.search);
  }

  const from = 'FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN courses c ON c.id = p.course_id';

  const { rows: countRows } = await query(`SELECT count(*)::int AS total ${from} ${f.sql}`, f.params);
  const total = countRows[0].total;

  const { sql, params } = f.limitOffset(filters.limit, (filters.page - 1) * filters.limit);
  const posts = await queryAll(
    `SELECT p.id, p.title, p.content,
            left(p.content, 160) AS "excerpt",
            p.is_locked AS "isLocked", p.is_pinned AS "isPinned",
            p.views_count AS "viewsCount", p.created_at AS "createdAt", p.updated_at AS "updatedAt",
            p.hidden_at AS "hiddenAt", p.hidden_reason AS "hiddenReason",
            u.id AS "userId", u.name AS "userName", u.email AS "userEmail", u.role AS "userRole",
            c.id AS "courseId", c.title AS "courseTitle",
            (SELECT count(*) FROM comments cm WHERE cm.post_id = p.id)::int AS "commentCount",
            (SELECT count(*) FROM comments cm WHERE cm.post_id = p.id AND cm.hidden_at IS NOT NULL)::int AS "hiddenCommentCount"
       ${from} ${f.sql} ORDER BY p.created_at DESC ${sql}`,
    params,
  );

  return { posts, meta: paginatedMeta({ page: filters.page, limit: filters.limit, total }) };
}

export async function setPostHidden(actor, postId, hidden, reason) {
  const post = await queryOne(
    `SELECT p.id, p.title, p.hidden_at, p.user_id, u.name AS "userName"
       FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
    [postId],
  );
  if (!post) throw notFound('Post não encontrado.');
  if (hidden && post.hidden_at) throw conflict('Este post já está oculto.');
  if (!hidden && !post.hidden_at) throw conflict('Este post já está visível.');

  const clean = hidden ? reason?.trim() || 'Ocultado pela administração.' : null;

  return transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE posts SET hidden_at = $2, hidden_by = $3, hidden_reason = $4
        WHERE id = $1 RETURNING id, title, hidden_at AS "hiddenAt", hidden_reason AS "hiddenReason"`,
      [postId, hidden ? new Date() : null, hidden ? actor.id : null, clean],
    );
    await recordAudit(client, actor, hidden ? 'post.hide' : 'post.show', { type: 'post', id: postId }, {
      summary: hidden
        ? `Post "${post.title}" de ${post.userName} ocultado${clean ? `. Motivo: ${clean}` : ''}`
        : `Post "${post.title}" de ${post.userName} voltou a ficar visível`,
      before: { hiddenAt: post.hidden_at },
      after: { hiddenAt: rows[0].hiddenAt, reason: clean },
    });
    return rows[0];
  });
}

/**
 * Exclui um post. Os comentários caem junto (`ON DELETE CASCADE`), então o
 * chamador precisa disso na tela de confirmação: apagar o tópico apaga a
 * discussão inteira, não só a mensagem.
 */
export async function deletePost(actor, postId) {
  const post = await queryOne(
    `SELECT p.id, p.title, p.user_id, u.name AS "userName",
            (SELECT count(*) FROM comments c WHERE c.post_id = p.id)::int AS "commentCount"
       FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
    [postId],
  );
  if (!post) throw notFound('Post não encontrado.');

  return transaction(async (client) => {
    await client.query('DELETE FROM posts WHERE id = $1', [postId]);
    await recordAudit(client, actor, 'post.delete', { type: 'post', id: postId }, {
      summary: `Post "${post.title}" de ${post.userName} excluído com ${post.commentCount} comentário(s)`,
      before: { id: post.id, title: post.title, commentCount: post.commentCount },
    });
    return { deleted: { id: postId }, removedComments: post.commentCount };
  });
}

export const commentsQuerySchema = pagination.extend({
  visibility: z.enum(['visible', 'hidden', 'all']).default('all'),
  postId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
});

export async function listComments(filters) {
  const f = where();
  if (filters.visibility === 'visible') f.add('cm.hidden_at IS NULL');
  if (filters.visibility === 'hidden') f.add('cm.hidden_at IS NOT NULL');
  if (filters.postId) f.add('cm.post_id = ?', filters.postId);
  if (filters.userId) f.add('cm.user_id = ?', filters.userId);
  if (filters.search) f.add(`(${unaccentedMatch(['cm.content', 'u.name', 'p.title'], '?')})`, filters.search);

  const from = `
    FROM comments cm
    JOIN users u ON u.id = cm.user_id
    JOIN posts p ON p.id = cm.post_id
  `;

  const { rows: countRows } = await query(`SELECT count(*)::int AS total ${from} ${f.sql}`, f.params);
  const total = countRows[0].total;

  const { sql, params } = f.limitOffset(filters.limit, (filters.page - 1) * filters.limit);
  const comments = await queryAll(
    `SELECT cm.id, cm.content, cm.created_at AS "createdAt",
            cm.hidden_at AS "hiddenAt", cm.hidden_reason AS "hiddenReason",
            u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
            p.id AS "postId", p.title AS "postTitle"
       ${from} ${f.sql} ORDER BY cm.created_at DESC ${sql}`,
    params,
  );

  return { comments, meta: paginatedMeta({ page: filters.page, limit: filters.limit, total }) };
}

export async function setCommentHidden(actor, commentId, hidden, reason) {
  const comment = await queryOne(
    `SELECT cm.id, cm.content, cm.hidden_at, cm.post_id, u.name AS "userName", p.title AS "postTitle"
       FROM comments cm JOIN users u ON u.id = cm.user_id JOIN posts p ON p.id = cm.post_id
      WHERE cm.id = $1`,
    [commentId],
  );
  if (!comment) throw notFound('Comentário não encontrado.');
  if (hidden && comment.hidden_at) throw conflict('Este comentário já está oculto.');
  if (!hidden && !comment.hidden_at) throw conflict('Este comentário já está visível.');

  const clean = hidden ? reason?.trim() || 'Ocultado pela administração.' : null;

  return transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE comments SET hidden_at = $2, hidden_by = $3, hidden_reason = $4
        WHERE id = $1 RETURNING id, hidden_at AS "hiddenAt", hidden_reason AS "hiddenReason"`,
      [commentId, hidden ? new Date() : null, hidden ? actor.id : null, clean],
    );
    await recordAudit(client, actor, hidden ? 'comment.hide' : 'comment.show', { type: 'comment', id: commentId }, {
      summary: hidden
        ? `Comentário de ${comment.userName} em "${comment.postTitle}" ocultado: "${(comment.content ?? '').slice(0, 50)}…"${clean ? `. Motivo: ${clean}` : ''}`
        : `Comentário de ${comment.userName} em "${comment.postTitle}" voltou a ficar visível`,
      before: { hiddenAt: comment.hidden_at },
      after: { hiddenAt: rows[0].hiddenAt, reason: clean },
    });
    return rows[0];
  });
}

export async function deleteComment(actor, commentId) {
  const comment = await queryOne(
    `SELECT cm.id, cm.content, u.name AS "userName", p.title AS "postTitle"
       FROM comments cm JOIN users u ON u.id = cm.user_id JOIN posts p ON p.id = cm.post_id
      WHERE cm.id = $1`,
    [commentId],
  );
  if (!comment) throw notFound('Comentário não encontrado.');

  return transaction(async (client) => {
    await client.query('DELETE FROM comments WHERE id = $1', [commentId]);
    await recordAudit(client, actor, 'comment.delete', { type: 'comment', id: commentId }, {
      summary: `Comentário de ${comment.userName} em "${comment.postTitle}" excluído`,
      before: { id: comment.id },
    });
    return { deleted: { id: commentId } };
  });
}
