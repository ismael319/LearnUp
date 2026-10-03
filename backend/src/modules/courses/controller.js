import { Router } from 'express';
import { asyncHandler, booleanFlag } from '../../utils/helpers.js';
import { validate } from '../../middleware/validate.js';
import { optionalAuth, authenticate, requireRole } from '../../middleware/auth.js';
import { paginatedMeta } from '../../middleware/pagination.js';
import { z } from 'zod';
import {
  catalogQuerySchema,
  listCourses,
  listCategories,
  getCourseDetail,
  listReviews,
  createReview,
  relatedCourses,
  listInstructors,
  upsertCourse,
  replaceCurriculum,
  listManagedCourses,
  getCourseForEditing,
  updateCourse,
} from './service.js';
import { assertEnrolled } from '../../services/enrollments.js';
import { slugify } from '../../utils/helpers.js';

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

/**
 * Capa aceita caminho relativo (`/img/nr18.jpg`) ou URL absoluta.
 * O seed usa caminhos locais, e `z.string().url()` recusaria o curso no
 * salvamento por um campo que o próprio banco tem.
 */
const coverUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || v.startsWith('/') || /^https?:\/\//i.test(v), {
    message: 'Use um caminho iniciado por / ou uma URL http(s).',
  });

const courseSchema = z.object({
  title: z.string().trim().min(3).max(160),
  slug: z.string().trim().max(180).optional(),
  subtitle: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(8000).nullable().optional(),
  coverUrl: coverUrlSchema.nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  // `in_review` é o que o instrutor usa para pedir publicação. `published` e
  // `archived` são recusados mais adiante, no serviço, quando quem chama não é
  // admin — o schema aceitar aqui é só para o admin conseguir usá-los.
  status: z.enum(['draft', 'in_review', 'published', 'archived']).default('draft'),
  priceCents: z.coerce.number().int().min(0).default(0),
  originalPriceCents: z.coerce.number().int().min(0).nullable().optional(),
  durationMinutes: z.coerce.number().int().min(0).default(0),
  // Só o admin pode definir o dono; o instrutor sempre fica com ele mesmo.
  instructorId: z.string().uuid().nullable().optional(),
});

// No PATCH tudo é opcional: o que não vier no corpo é preservado.
const coursePatchSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  slug: z.string().trim().max(180).optional(),
  subtitle: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(8000).nullable().optional(),
  coverUrl: coverUrlSchema.nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  status: z.enum(['draft', 'in_review', 'published', 'archived']).optional(),
  priceCents: z.coerce.number().int().min(0).optional(),
  originalPriceCents: z.coerce.number().int().min(0).nullable().optional(),
  durationMinutes: z.coerce.number().int().min(0).optional(),
});

// O `id` é o que permite reaproveitar um módulo/aula já existente em vez de
// recriá-lo — sem ele, todo salvamento apagaria o progresso dos alunos.
// Itens novos na interface simplesmente não trazem `id`.
const curriculumSchema = z.object({
  modules: z.array(
    z.object({
      id: z.string().uuid().optional(),
      title: z.string().trim().min(1).max(160),
      description: z.string().trim().max(500).nullable().optional(),
      lessons: z
        .array(
          z.object({
            id: z.string().uuid().optional(),
            title: z.string().trim().min(1).max(160),
            description: z.string().trim().max(1000).nullable().optional(),
            type: z.enum(['video', 'text', 'quiz']).default('video'),
            durationSeconds: z.coerce.number().int().min(0).default(0),
            videoUrl: z.string().max(500).nullable().optional(),
            content: z.string().max(50000).nullable().optional(),
            isPreview: booleanFlag().default(false),
          }),
        )
        .default([]),
    }),
  ),
});

// --- Controllers ---------------------------------------------------------

export const listCoursesController = asyncHandler(async (req, res) => {
  const result = await listCourses(req.validatedQuery, req.user?.id);
  res.json(result);
});

export const categoriesController = asyncHandler(async (_req, res) => {
  res.json({ categories: await listCategories() });
});

export const instructorsController = asyncHandler(async (_req, res) => {
  res.json({ instructors: await listInstructors() });
});

export const courseDetailController = asyncHandler(async (req, res) => {
  res.json({ course: await getCourseDetail(req.params.id, req.user?.id) });
});

export const reviewsController = asyncHandler(async (req, res) => {
  res.json({ reviews: await listReviews(req.params.id) });
});

export const createReviewController = asyncHandler(async (req, res) => {
  await assertEnrolled(req.user.id, req.params.id);
  const review = await createReview(req.user.id, req.params.id, req.body);
  res.status(201).json({ review });
});

export const relatedController = asyncHandler(async (req, res) => {
  res.json({ courses: await relatedCourses(req.params.id) });
});

export const createCourseController = asyncHandler(async (req, res) => {
  const payload = { ...req.body, slug: req.body.slug || slugify(req.body.title) };
  const course = await upsertCourse(req.user, payload);
  res.status(201).json({ course });
});

export const managedCoursesController = asyncHandler(async (req, res) => {
  res.json({ courses: await listManagedCourses(req.user) });
});

export const courseEditorController = asyncHandler(async (req, res) => {
  res.json({ course: await getCourseForEditing(req.user, req.params.id) });
});

export const updateCourseController = asyncHandler(async (req, res) => {
  const course = await updateCourse(req.user, req.params.id, req.body);
  res.json({ course });
});

// --- Rotas ---------------------------------------------------------------

const router = Router();

router.get('/', optionalAuth, validate({ query: catalogQuerySchema }), listCoursesController);
router.get('/categories', categoriesController);
router.get('/instructors', instructorsController);
// Antes de `/:id`: sem esta ordem, "mine" seria interpretado como id de curso.
router.get('/mine', authenticate, requireRole('instructor', 'admin'), managedCoursesController);
router.post('/', authenticate, requireRole('instructor', 'admin'), validate({ body: courseSchema }), createCourseController);
router.get('/:id', optionalAuth, courseDetailController);
router.get('/:id/manage', authenticate, requireRole('instructor', 'admin'), courseEditorController);
router.get('/:id/reviews', reviewsController);
router.post('/:id/reviews', authenticate, validate({ body: reviewSchema }), createReviewController);
router.patch(
  '/:id',
  authenticate,
  requireRole('instructor', 'admin'),
  validate({ body: coursePatchSchema }),
  updateCourseController,
);
router.put(
  '/:id/curriculum',
  authenticate,
  requireRole('instructor', 'admin'),
  validate({ body: curriculumSchema }),
  asyncHandler(async (req, res) => {
    res.json(await replaceCurriculum(req.params.id, req.body.modules, req.user));
  }),
);
router.get('/:id/related', relatedController);

export default router;
