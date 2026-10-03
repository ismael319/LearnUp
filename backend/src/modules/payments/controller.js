import express, { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/helpers.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import {
  createOrderSchema,
  createOrder,
  listOrders,
  getOrder,
  getOrderRaw,
  markOrderPaid,
  handleProviderEvent,
  methods,
  assertMockOrder,
} from './service.js';
import { paymentProvider } from './providers/index.js';

const uuid = z.string().uuid();
const router = Router();

/** Métodos ativos no provedor configurado. */
router.get('/methods', (_req, res) => {
  res.json({ provider: paymentProvider().name, methods: methods() });
});

/**
 * Webhook do gateway. Precisa do corpo CRU para validar a assinatura.
 *
 * Fica em um router separado (`webhookRouter`) que o app monta ANTES do
 * express.json(). Montar no mesmo router não funcionaria: o body já teria
 * sido parseado em JSON e a verificação de assinatura seria inválida.
 */
const webhookRouter = express.Router();

webhookRouter.post(
  '/:provider',
  asyncHandler(async (req, res) => {
    const active = paymentProvider();
    if (req.params.provider !== active.name) {
      throw new AppError(`Webhook desconhecido: ${req.params.provider}`, { status: 404 });
    }

    const event = await active.parseWebhook(req, {
      webhookSecret:
        active.name === 'stripe'
          ? config.payments.stripe.webhookSecret
          : config.payments.mercadoPago.webhookSecret,
    });

    const result = await handleProviderEvent({
      eventType: event.eventType,
      provider: active.name,
      providerRef: event.providerRef,
      raw: event.raw,
    });

    logger.info({ provider: active.name, type: event.eventType }, 'Webhook processado');
    res.json({ received: true, ...result });
  }),
);

router.use(authenticate);

router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    res.json({ orders: await listOrders(req.user.id) });
  }),
);

router.post(
  '/orders',
  validate({ body: createOrderSchema }),
  asyncHandler(async (req, res) => {
    const result = await createOrder(req.user, req.body);
    res.status(result.reused ? 200 : 201).json(result);
  }),
);

router.get(
  '/orders/:id',
  validate({ params: z.object({ id: uuid }) }),
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.user.id, req.params.id);
    if (!order) throw new AppError('Pedido não encontrado.', { status: 404 });
    res.json({ order });
  }),
);

/**
 * Confirmação manual — SOMENTE no provedor mock.
 * Substitui o webhook no ambiente de desenvolvimento.
 */
router.post(
  '/mock/:orderId/confirm',
  validate({ params: z.object({ orderId: uuid }) }),
  asyncHandler(async (req, res) => {
    const order = await getOrderRaw(req.params.orderId);
    if (!order) throw new AppError('Pedido não encontrado.', { status: 404 });
    assertMockOrder(req.user.id, order);

    const result = await markOrderPaid({
      orderId: order.id,
      provider: 'mock',
      providerRef: order.provider_ref,
      rawPayload: { simulated: true, by: req.user.email },
    });
    res.json(result);
  }),
);

export { webhookRouter };
export default router;
