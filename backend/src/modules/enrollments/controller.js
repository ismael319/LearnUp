import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, booleanFlag } from '../../utils/helpers.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { pagination } from '../../middleware/pagination.js';
import { notFound } from '../../utils/errors.js';
import {
  listEnrollments,
  enrollFree,
  getEnrollment,
  getCourseProgress,
  getCourseOutline,
  saveLessonProgress,
  assertEnrolled,
} from '../../services/enrollments.js';
import { queryOne } from '../../config/database.js';

const uuid = z.string().uuid('Identificador inválido.');

/** Helper: um esquema por conjunto de params nomeados (evita divergir do path). */
const params = (...names) => z.object(Object.fromEntries(names.map((n) => [n, uuid])));

/*
 * O corpo carrega o que o player OBSERVOU, e o servidor é quem conclui.
 *
 * `positionSeconds` e `durationSeconds` vão juntos para o servidor ter como
 * checar se a posição informada é coerente com a duração que o navegador diz
 * estar vendo (o `duration_seconds` da aula pode estar desatualizado). O
 * crédito de tempo é sempre limitado pelo que o vídeo avançou e pelo tempo
 * decorrido — ver `creditForHeartbeat` em `services/enrollments.js`.
 */
const progressSchema = z.object({
  positionSeconds: z.coerce.number().int().min(0).max(60 * 60 * 12),
  durationSeconds: z.coerce.number().int().min(0).max(60 * 60 * 12).optional(),
  completed: booleanFlag(),
});

const router = Router();

// Prévia pública: o serviço já remove vídeo e texto de toda aula que não foi
// marcada como preview. Mantemos uma rota separada do player autenticado para
// não transformar a regra de matrícula em uma condição opcional.
router.get(
  '/preview/:courseId',
  validate({ params: params('courseId') }),
  asyncHandler(async (req, res) => {
    const outline = await getCourseOutline(null, req.params.courseId);
    if (!outline.modules.some((module) => module.lessons.some((lesson) => lesson.isPreview))) {
      throw notFound('Este curso não possui uma aula de prévia.');
    }
    res.json(outline);
  }),
);

router.use(authenticate);

// Matrículas -----------------------------------------------------------
router.get(
  '/',
  validate({ query: pagination.extend({ status: z.enum(['all', 'in_progress', 'completed']).default('all') }) }),
  asyncHandler(async (req, res) => {
    const { status } = req.validatedQuery;
    res.json({ enrollments: await listEnrollments(req.user.id, { status }) });
  }),
);

router.post(
  '/',
  validate({ body: z.object({ courseId: uuid }) }),
  asyncHandler(async (req, res) => {
    const enrollment = await enrollFree(req.user.id, req.body.courseId);
    res.status(201).json({ enrollment });
  }),
);

// Player / progresso ---------------------------------------------------
/** Tudo que o player precisa em uma requisição: curso + módulos + aulas + progresso. */
router.get(
  '/:courseId/outline',
  validate({ params: params('courseId') }),
  asyncHandler(async (req, res) => {
    // Esta rota abastece o player; conteúdo completo exige matrícula.
    await assertEnrolled(req.user.id, req.params.courseId);
    res.json(await getCourseOutline(req.user.id, req.params.courseId));
  }),
);

router.get(
  '/:courseId',
  validate({ params: params('courseId') }),
  asyncHandler(async (req, res) => {
    res.json({ enrollment: await getEnrollment(req.user.id, req.params.courseId) });
  }),
);

router.get(
  '/:courseId/progress',
  validate({ params: params('courseId') }),
  asyncHandler(async (req, res) => {
    res.json({ progress: await getCourseProgress(req.user.id, req.params.courseId) });
  }),
);

router.put(
  '/:courseId/lessons/:lessonId',
  validate({ params: params('courseId', 'lessonId'), body: progressSchema }),
  asyncHandler(async (req, res) => {
    const lesson = await queryOne(
      `SELECT l.id FROM lessons l JOIN modules m ON m.id = l.module_id
        WHERE l.id = $1 AND m.course_id = $2`,
      [req.params.lessonId, req.params.courseId],
    );
    if (!lesson) throw notFound('Aula não encontrada neste curso.');

    const result = await saveLessonProgress(req.user.id, req.params.lessonId, {
      positionSeconds: req.body.positionSeconds,
      durationSeconds: req.body.durationSeconds,
      completed: req.body.completed,
    });
    res.json(result);
  }),
);

export default router;
