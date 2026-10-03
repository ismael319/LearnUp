import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/helpers.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { getQuizForStudent, submitAttempt } from './service.js';

const uuid = z.string().uuid('Identificador inválido.');
const router = Router();
router.use(authenticate);

router.get(
  '/lessons/:lessonId',
  validate({ params: z.object({ lessonId: uuid }) }),
  asyncHandler(async (req, res) => {
    res.json({ quiz: await getQuizForStudent(req.params.lessonId, req.user.id) });
  }),
);

router.post(
  '/lessons/:lessonId/attempts',
  validate({
    params: z.object({ lessonId: uuid }),
    body: z.object({
      answers: z
        .array(z.object({ questionId: uuid, optionId: uuid }))
        .min(1, 'Responda ao menos uma pergunta.')
        .max(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await submitAttempt(req.params.lessonId, req.user.id, req.body));
  }),
);

export default router;
