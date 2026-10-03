import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/helpers.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { query } from '../../config/database.js';
import { userStats, userBadges, listBadges, leaderboard, rules } from '../../services/gamification.js';
import { getCourseProgress } from '../../services/enrollments.js';

const router = Router();

router.get('/leaderboard', asyncHandler(async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(100).default(20).parse(req.query.limit);
  res.json({ leaderboard: await leaderboard(limit) });
}));

router.get('/badges', asyncHandler(async (_req, res) => {
  res.json({ badges: await listBadges(), rules: rules() });
}));

router.use(authenticate);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({
      stats: await userStats(req.user.id),
      badges: await userBadges(req.user.id),
    });
  }),
);

router.get(
  '/me/leaderboard-position',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT count(*)::int + 1 AS position
         FROM users
        WHERE points > (SELECT points FROM users WHERE id = $1)`,
      [req.user.id],
    );
    res.json({ position: rows[0].position });
  }),
);

router.get(
  '/me/courses/:courseId',
  validate({ params: z.object({ courseId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    res.json({ progress: await getCourseProgress(req.user.id, req.params.courseId) });
  }),
);

export default router;
