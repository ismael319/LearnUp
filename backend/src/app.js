import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { config } from './config/env.js';
import { httpLogger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

import authRoutes from './modules/auth/controller.js';
import adminRoutes, { publicRouter as platformPublicRoutes } from './modules/admin/controller.js';
import courseRoutes from './modules/courses/controller.js';
import enrollmentRoutes from './modules/enrollments/controller.js';
import certificateRoutes from './modules/certificates/controller.js';
import quizRoutes from './modules/quizzes/controller.js';
import forumRoutes from './modules/forum/controller.js';
import gamificationRoutes from './modules/gamification/controller.js';
import paymentRoutes, { webhookRouter as paymentWebhookRoutes } from './modules/payments/controller.js';
import healthRoutes from './modules/health.js';

export function createApp() {
  const app = express();

  if (config.http.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.http.corsOrigin,
      credentials: true, // necessário para o cookie de refresh
    }),
  );
  app.use(compression());
  app.use(httpLogger);

  /**
   * Webhooks de pagamento precisam do corpo CRU para validar a assinatura,
   * então a rota é montada ANTES do express.json(). Se fosse depois, o
   * body já estaria parseado e a verificação de assinatura falharia.
   */
  app.use(
    `${config.apiPrefix}/payments/webhook`,
    express.raw({ type: '*/*', limit: '2mb' }),
    paymentWebhookRoutes,
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Limite global mais permissivo; rotas sensíveis usam limites próprios.
  if (config.http.rateLimit) {
    app.use(
      config.apiPrefix,
      rateLimit({
        windowMs: 60_000,
        limit: 300,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        skip: (req) => req.path.startsWith('/health'),
      }),
    );

    // Rate limit específico para login/registro (proteção contra brute force).
    const authLimiter = rateLimit({
      windowMs: 15 * 60_000,
      limit: 20,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'rate_limited', message: 'Muitas tentativas. Tente novamente em alguns minutos.' } },
    });
    app.use([`${config.apiPrefix}/auth/login`, `${config.apiPrefix}/auth/register`], authLimiter);
  }

  app.use(healthRoutes);
  // Configurações públicas: nome da plataforma e aviso de manutenção, lidos por
  // qualquer visitante antes mesmo de logar.
  app.use(`${config.apiPrefix}/platform`, platformPublicRoutes);
  app.use(`${config.apiPrefix}/auth`, authRoutes);
  app.use(`${config.apiPrefix}/admin`, adminRoutes);
  app.use(`${config.apiPrefix}/courses`, courseRoutes);
  app.use(`${config.apiPrefix}/enrollments`, enrollmentRoutes);
  app.use(`${config.apiPrefix}/certificates`, certificateRoutes);
  app.use(`${config.apiPrefix}/quizzes`, quizRoutes);
  app.use(`${config.apiPrefix}/forum`, forumRoutes);
  app.use(`${config.apiPrefix}/gamification`, gamificationRoutes);
  app.use(`${config.apiPrefix}/payments`, paymentRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
