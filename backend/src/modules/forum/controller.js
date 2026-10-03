import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/helpers.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, optionalAuth } from '../../middleware/auth.js';
import { listPostsSchema, listPosts, createPost, getPost, createComment, deletePost } from './service.js';

const uuid = z.string().uuid('Identificador inválido.');
const router = Router();

// Leitura do fórum é pública; escrita exige login.
router.get(
  '/posts',
  optionalAuth,
  validate({ query: listPostsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await listPosts(req.validatedQuery));
  }),
);

router.get(
  '/posts/:id',
  optionalAuth,
  validate({ params: z.object({ id: uuid }) }),
  asyncHandler(async (req, res) => {
    res.json({ post: await getPost(req.params.id) });
  }),
);

router.post(
  '/posts',
  authenticate,
  validate({
    body: z.object({
      title: z.string().trim().min(3, 'Título muito curto.').max(180),
      content: z.string().trim().min(2, 'Escreva o conteúdo do post.').max(20000),
      courseId: uuid.nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ post: await createPost(req.user.id, req.body) });
  }),
);

router.delete(
  '/posts/:id',
  authenticate,
  validate({ params: z.object({ id: uuid }) }),
  asyncHandler(async (req, res) => {
    await deletePost(req.params.id, req.user);
    res.status(204).end();
  }),
);

router.post(
  '/posts/:id/comments',
  authenticate,
  validate({
    params: z.object({ id: uuid }),
    body: z.object({
      content: z.string().trim().min(1, 'Comentário vazio.').max(5000),
      parentId: uuid.nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const comment = await createComment(req.user.id, req.params.id, req.body);
    res.status(201).json({ comment });
  }),
);

export default router;
