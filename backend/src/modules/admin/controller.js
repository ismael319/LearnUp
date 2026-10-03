import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, booleanFlag } from '../../utils/helpers.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { AUDIT_ACTIONS, AUDIT_LABELS } from './audit.js';

import {
  usersQuerySchema,
  auditQuerySchema,
  listUsers,
  getUserDetail,
  changeUserRole,
  setUserBlocked,
  setUserPassword,
  platformOverview,
  listAuditLogs,
} from './users.js';

import {
  ordersQuerySchema,
  listOrders,
  getOrderDetail,
  refundOrder,
  cancelOrder,
  confirmOrderManually,
  reasonSchema,
} from './orders.js';

import {
  adminCoursesQuerySchema,
  courseActionSchema,
  listCoursesForAdmin,
  getCourseForAdmin,
  transitionCourse,
  deleteCourse,
} from './courses.js';

import {
  enrollmentsQuerySchema,
  certificatesQuerySchema,
  listEnrollments,
  cancelEnrollment,
  reactivateEnrollment,
  listCertificates,
  setCertificateRevoked,
} from './enrollments.js';

import {
  categorySchema,
  categoryPatchSchema,
  badgeSchema,
  badgePatchSchema,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  uncategorizeCourses,
  listBadges,
  createBadge,
  updateBadge,
  deleteBadge,
  awardBadge,
  revokeBadgeFromUser,
  criteriaCatalog,
} from './content.js';

import {
  reviewsQuerySchema,
  postsQuerySchema,
  commentsQuerySchema,
  listReviews,
  setReviewHidden,
  deleteReview,
  listPostsForModeration,
  setPostHidden,
  deletePost,
  listComments,
  setCommentHidden,
  deleteComment,
} from './moderation.js';

import { reportQuerySchema, revenueSeries, topCourses, topInstructors, courseCompletion, activitySeries, executiveSummary, courseFunnel } from './reports.js';

import { getSettings, saveSettings, settingsMap, SETTING_DEFS, PUBLIC_SETTING_KEYS } from './settings.js';

const uuid = z.string().uuid();
const idParam = validate({ params: z.object({ id: uuid }) });
const body = (schema) => validate({ body: schema });

/**
 * Flag `hidden` num corpo `{ hidden: true }`.
 *
 * Vem como string quando vem de form, então precisa de coerção — e é
 * exatamente por isso que usa `booleanFlag()`: `z.coerce.boolean()` trataria a
 * string "false" como `true`, invertendo a ação pedida.
 */
const hiddenBody = booleanFlag();

export const moderationBodySchema = z.object({
  hidden: hiddenBody,
  reason: z.string().trim().max(500).optional(),
});

const awardBodySchema = z.object({
  userId: uuid,
  reason: z.string().trim().max(500).optional(),
});

const revokeBodySchema = z.object({
  userId: uuid,
});

/**
 * O `validate` substitui `req.params` pelo objeto parseado, então o schema tem
 * que declarar TODOS os parâmetros da rota — declarar só `id` apagaria
 * `req.params.action` silenciosamente.
 */
const transitionParamsSchema = z.object({
  id: uuid,
  action: z.enum(['approve', 'reject', 'publish', 'unpublish', 'archive', 'restore']),
});

const settingsBodySchema = z.record(z.string(), z.unknown());

// --- Visão geral -----------------------------------------------------------

const overviewController = asyncHandler(async (_req, res) => {
  res.json({ overview: await platformOverview(), summary: await executiveSummary() });
});

// --- Usuários --------------------------------------------------------------

const listUsersController = asyncHandler(async (req, res) => {
  res.json(await listUsers(req.validatedQuery));
});

const userDetailController = asyncHandler(async (req, res) => {
  res.json(await getUserDetail(req.params.id));
});

const changeRoleController = asyncHandler(async (req, res) => {
  res.json({ user: await changeUserRole(req.user, req.params.id, req.body.role) });
});

const blockController = asyncHandler(async (req, res) => {
  res.json({ user: await setUserBlocked(req.user, req.params.id, true, req.body?.reason) });
});

const unblockController = asyncHandler(async (req, res) => {
  res.json({ user: await setUserBlocked(req.user, req.params.id, false) });
});

const resetPasswordController = asyncHandler(async (req, res) => {
  res.json(await setUserPassword(req.user, req.params.id, req.body.password));
});

// --- Auditoria -------------------------------------------------------------

const auditController = asyncHandler(async (req, res) => {
  res.json({
    ...(await listAuditLogs(req.validatedQuery)),
    actions: AUDIT_ACTIONS.map((value) => ({ value, label: AUDIT_LABELS[value] ?? value })),
  });
});

// --- Pedidos ---------------------------------------------------------------

const listOrdersController = asyncHandler(async (req, res) => {
  res.json(await listOrders(req.validatedQuery));
});

const orderDetailController = asyncHandler(async (req, res) => {
  res.json(await getOrderDetail(req.params.id));
});

const refundController = asyncHandler(async (req, res) => {
  res.json(await refundOrder(req.user, req.params.id, req.body?.reason));
});

const cancelOrderController = asyncHandler(async (req, res) => {
  res.json({ order: await cancelOrder(req.user, req.params.id, req.body?.reason) });
});

const confirmOrderController = asyncHandler(async (req, res) => {
  res.json(await confirmOrderManually(req.user, req.params.id));
});

// --- Cursos ----------------------------------------------------------------

const listCoursesController = asyncHandler(async (req, res) => {
  res.json(await listCoursesForAdmin(req.validatedQuery));
});

const courseDetailController = asyncHandler(async (req, res) => {
  res.json(await getCourseForAdmin(req.params.id));
});

const transitionController = asyncHandler(async (req, res) => {
  res.json({ course: await transitionCourse(req.user, req.params.id, req.params.action, req.body?.reason) });
});

const deleteCourseController = asyncHandler(async (req, res) => {
  res.json(await deleteCourse(req.user, req.params.id, req.body?.reason));
});

// --- Matrículas e certificados ----------------------------------------------

const listEnrollmentsController = asyncHandler(async (req, res) => {
  res.json(await listEnrollments(req.validatedQuery));
});

const cancelEnrollmentController = asyncHandler(async (req, res) => {
  res.json(await cancelEnrollment(req.user, req.params.id, req.body?.reason));
});

const reactivateEnrollmentController = asyncHandler(async (req, res) => {
  res.json({ enrollment: await reactivateEnrollment(req.user, req.params.id) });
});

const listCertificatesController = asyncHandler(async (req, res) => {
  res.json(await listCertificates(req.validatedQuery));
});

const revokeCertificateController = asyncHandler(async (req, res) => {
  res.json({
    certificate: await setCertificateRevoked(req.user, req.params.id, req.body?.revoked !== false, req.body?.reason),
  });
});

// --- Conteúdo --------------------------------------------------------------

const categoriesController = asyncHandler(async (_req, res) => {
  res.json({ categories: await listCategories() });
});

const createCategoryController = asyncHandler(async (req, res) => {
  res.status(201).json({ category: await createCategory(req.user, req.body) });
});

const updateCategoryController = asyncHandler(async (req, res) => {
  res.json({ category: await updateCategory(req.user, req.params.id, req.body) });
});

const deleteCategoryController = asyncHandler(async (req, res) => {
  res.json(await deleteCategory(req.user, req.params.id));
});

const uncategorizeController = asyncHandler(async (req, res) => {
  res.json(await uncategorizeCourses(req.user, req.params.id));
});

const badgesController = asyncHandler(async (_req, res) => {
  res.json({ badges: await listBadges(), criteria: criteriaCatalog() });
});

const createBadgeController = asyncHandler(async (req, res) => {
  res.status(201).json({ badge: await createBadge(req.user, req.body) });
});

const updateBadgeController = asyncHandler(async (req, res) => {
  res.json({ badge: await updateBadge(req.user, req.params.id, req.body) });
});

const deleteBadgeController = asyncHandler(async (req, res) => {
  res.json(await deleteBadge(req.user, req.params.id));
});

const awardBadgeController = asyncHandler(async (req, res) => {
  res.status(201).json(await awardBadge(req.user, req.params.id, req.body.userId, req.body.reason));
});

const revokeBadgeController = asyncHandler(async (req, res) => {
  res.json(await revokeBadgeFromUser(req.user, req.params.id, req.body.userId));
});

// --- Moderação -------------------------------------------------------------

const listReviewsController = asyncHandler(async (req, res) => {
  res.json(await listReviews(req.validatedQuery));
});

const hideReviewController = asyncHandler(async (req, res) => {
  res.json({ review: await setReviewHidden(req.user, req.params.id, req.body.hidden, req.body.reason) });
});

const deleteReviewController = asyncHandler(async (req, res) => {
  res.json(await deleteReview(req.user, req.params.id));
});

const listPostsController = asyncHandler(async (req, res) => {
  res.json(await listPostsForModeration(req.validatedQuery));
});

const hidePostController = asyncHandler(async (req, res) => {
  res.json({ post: await setPostHidden(req.user, req.params.id, req.body.hidden, req.body.reason) });
});

const deletePostController = asyncHandler(async (req, res) => {
  res.json(await deletePost(req.user, req.params.id));
});

const listCommentsController = asyncHandler(async (req, res) => {
  res.json(await listComments(req.validatedQuery));
});

const hideCommentController = asyncHandler(async (req, res) => {
  res.json({ comment: await setCommentHidden(req.user, req.params.id, req.body.hidden, req.body.reason) });
});

const deleteCommentController = asyncHandler(async (req, res) => {
  res.json(await deleteComment(req.user, req.params.id));
});

// --- Relatórios ------------------------------------------------------------

const revenueController = asyncHandler(async (req, res) => {
  res.json(await revenueSeries(req.validatedQuery));
});

const summaryController = asyncHandler(async (_req, res) => {
  res.json({ summary: await executiveSummary() });
});

const topCoursesController = asyncHandler(async (req, res) => {
  res.json({ courses: await topCourses() });
});

const topInstructorsController = asyncHandler(async (req, res) => {
  res.json({ instructors: await topInstructors() });
});

const completionController = asyncHandler(async (req, res) => {
  res.json({ courses: await courseCompletion() });
});

const activityController = asyncHandler(async (req, res) => {
  res.json({ series: await activitySeries(req.validatedQuery) });
});

const funnelController = asyncHandler(async (req, res) => {
  res.json(await courseFunnel(req.params.id));
});

// --- Configurações ---------------------------------------------------------

const settingsController = asyncHandler(async (_req, res) => {
  res.json({ settings: await getSettings() });
});

const saveSettingsController = asyncHandler(async (req, res) => {
  res.json(await saveSettings(req.user, req.body));
});

// --- Rotas -----------------------------------------------------------------
// requireRole('admin') em todas: "admin" não é herdado, é o único dono.

const router = Router();

router.use(authenticate, requireRole('admin'));

router.get('/overview', overviewController);
router.get('/audit-logs', validate({ query: auditQuerySchema }), auditController);

router.get('/users', validate({ query: usersQuerySchema }), listUsersController);
router.get('/users/:id', idParam, userDetailController);
router.patch('/users/:id/role', idParam, body(z.object({ role: z.enum(['student', 'instructor', 'admin']) })), changeRoleController);
router.post('/users/:id/block', idParam, body(z.object({ reason: z.string().trim().max(500).optional() })), blockController);
router.post('/users/:id/unblock', idParam, unblockController);
router.post('/users/:id/reset-password', idParam, body(z.object({ password: z.string().min(8).max(72) })), resetPasswordController);

router.get('/orders', validate({ query: ordersQuerySchema }), listOrdersController);
router.get('/orders/:id', idParam, orderDetailController);
router.post('/orders/:id/refund', idParam, body(reasonSchema), refundController);
router.post('/orders/:id/cancel', idParam, body(reasonSchema), cancelOrderController);
router.post('/orders/:id/confirm', idParam, confirmOrderController);

router.get('/courses', validate({ query: adminCoursesQuerySchema }), listCoursesController);
router.get('/courses/:id', idParam, courseDetailController);
router.post(
  '/courses/:id/:action',
  validate({ params: transitionParamsSchema }),
  body(courseActionSchema),
  transitionController,
);
  router.delete('/courses/:id', idParam, body(reasonSchema), deleteCourseController);

router.get('/enrollments', validate({ query: enrollmentsQuerySchema }), listEnrollmentsController);
router.post('/enrollments/:id/cancel', idParam, body(reasonSchema), cancelEnrollmentController);
router.post('/enrollments/:id/reactivate', idParam, reactivateEnrollmentController);

router.get('/certificates', validate({ query: certificatesQuerySchema }), listCertificatesController);
router.patch('/certificates/:id', idParam, body(z.object({ revoked: z.boolean().optional(), reason: z.string().trim().max(500).optional() })), revokeCertificateController);

router.get('/categories', categoriesController);
router.post('/categories', body(categorySchema), createCategoryController);
router.patch('/categories/:id', idParam, body(categoryPatchSchema), updateCategoryController);
router.delete('/categories/:id', idParam, deleteCategoryController);
router.post('/categories/:id/uncategorize', idParam, uncategorizeController);

router.get('/badges', badgesController);
router.post('/badges', body(badgeSchema), createBadgeController);
router.patch('/badges/:id', idParam, body(badgePatchSchema), updateBadgeController);
router.delete('/badges/:id', idParam, deleteBadgeController);
router.post('/badges/:id/award', idParam, body(awardBodySchema), awardBadgeController);
router.post('/badges/:id/revoke', idParam, body(revokeBodySchema), revokeBadgeController);

router.get('/reviews', validate({ query: reviewsQuerySchema }), listReviewsController);
router.post('/reviews/:id/visibility', idParam, body(moderationBodySchema), hideReviewController);
router.delete('/reviews/:id', idParam, deleteReviewController);

router.get('/posts', validate({ query: postsQuerySchema }), listPostsController);
router.post('/posts/:id/visibility', idParam, body(moderationBodySchema), hidePostController);
router.delete('/posts/:id', idParam, deletePostController);

router.get('/comments', validate({ query: commentsQuerySchema }), listCommentsController);
router.post('/comments/:id/visibility', idParam, body(moderationBodySchema), hideCommentController);
router.delete('/comments/:id', idParam, deleteCommentController);

router.get('/reports/revenue', validate({ query: reportQuerySchema }), revenueController);
router.get('/reports/summary', summaryController);
router.get('/reports/top-courses', topCoursesController);
router.get('/reports/top-instructors', topInstructorsController);
router.get('/reports/completion', completionController);
router.get('/reports/activity', validate({ query: reportQuerySchema }), activityController);
router.get('/reports/course/:id/funnel', idParam, funnelController);

router.get('/settings', settingsController);
router.patch('/settings', body(settingsBodySchema), saveSettingsController);

/**
 * Subconjunto público, sem autenticação: nome, assinatura, validade informativa
 * de certificado e aviso de manutenção são lidos por qualquer visitante,
 * inclusive com a sessão expirada. Mantém
 * `PUBLIC_SETTING_KEYS` como a única fonte de verdade do que sai daqui — uma
 * configuração de admin (limites, flag de cursos gratuitos) não pode vazar só
 * por estar na mesma tabela.
 */
const publicRouter = Router();

publicRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    // Mapa plano (`{ "platform.name": "LearnUp" }`) em vez do array de
    // definições: o front só quer ler valores para mostrar no cabeçalho.
    res.json({ settings: await settingsMap({ publicOnly: true }) });
  }),
);

export { router, publicRouter, SETTING_DEFS, PUBLIC_SETTING_KEYS };
export default router;
