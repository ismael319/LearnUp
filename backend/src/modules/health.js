import { Router } from 'express';
import { asyncHandler } from '../utils/helpers.js';
import { checkDatabase } from '../config/database.js';
import { paymentProvider } from './payments/providers/index.js';

const router = Router();

/** Liveness + readiness. Não exige autenticação. */
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const started = Date.now();
    let database = 'down';
    try {
      await checkDatabase();
      database = 'up';
    } catch {
      /* segue e reporta "down" */
    }

    const healthy = database === 'up';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      database,
      paymentProvider: paymentProvider().name,
      uptime: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  }),
);

export default router;
