import { z } from 'zod';
import { query, queryAll, queryOne, transaction } from '../../config/database.js';
import { badRequest, notFound, conflict, paymentRequired } from '../../utils/errors.js';
import { pagination, paginatedMeta } from '../../middleware/pagination.js';
import { markOrderPaid } from '../payments/service.js';
import { recordAudit } from './audit.js';
import { where, unaccentedMatch } from './filters.js';

export const ordersQuerySchema = pagination.extend({
  status: z.enum(['pending', 'paid', 'failed', 'refunded', 'canceled']).optional(),
  method: z.enum(['pix', 'card', 'paypal', 'free']).optional(),
  courseId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.').optional(),
  search: z.string().trim().max(120).optional(),
});

const ORDER_ROW = `
  o.id, o.status, o.method, o.amount_cents AS "amountCents", o.discount_cents AS "discountCents",
  o.currency, o.provider, o.provider_ref AS "providerRef",
  o.created_at AS "createdAt", o.paid_at AS "paidAt", o.updated_at AS "updatedAt",
  u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
  c.id AS "courseId", c.title AS "courseTitle", c.slug AS "courseSlug",
  (e.id IS NOT NULL) AS "hasEnrollment",
  e.id AS "enrollmentId", e.status AS "enrollmentStatus"
`;

/**
 * Todos os pedidos da plataforma, com o aluno e o curso embutidos.
 * A rota do aluno (`GET /payments/orders`) filtra por `req.user.id` e não dá
 * conta disto: o admin precisa do pedido de qualquer pessoa, com o nome dela ao
 * lado para não ter que abrir duas abas.
 */
export async function listOrders(filters) {
  const f = where();
  if (filters.status) f.add('o.status = ?', filters.status);
  if (filters.method) f.add('o.method = ?', filters.method);
  if (filters.courseId) {
    f.add('EXISTS (SELECT 1 FROM order_items oi_filter WHERE oi_filter.order_id = o.id AND oi_filter.course_id = ?)', filters.courseId);
  }
  if (filters.userId) f.add('o.user_id = ?', filters.userId);
  if (filters.from) f.add('o.created_at >= ?::date', filters.from);
  if (filters.to) f.add('o.created_at < (?::date + interval \'1 day\')', filters.to);
  if (filters.search) f.add(`(${unaccentedMatch(['u.name', 'u.email', 'c.title'], '?')})`, filters.search);

  const from = `
    FROM orders o
    JOIN users u ON u.id = o.user_id
    JOIN courses c ON c.id = o.course_id
    LEFT JOIN enrollments e ON e.order_id = o.id
  `;

  const { rows: countRows } = await query(
    `SELECT count(DISTINCT o.id)::int AS total ${from} ${f.sql}`,
    f.params,
  );
  const total = countRows[0].total;

  const { sql, params } = f.limitOffset(filters.limit, (filters.page - 1) * filters.limit);
  const orders = await queryAll(
    `SELECT ${ORDER_ROW} ${from} ${f.sql} ORDER BY o.created_at DESC ${sql}`,
    params,
  );

  const [summary, byStatus, byMethod] = await Promise.all([
    query(
      `SELECT coalesce(sum(o.amount_cents) FILTER (WHERE o.status = 'paid'), 0)::int AS "paidCents",
              coalesce(sum(o.amount_cents) FILTER (WHERE o.status = 'refunded'), 0)::int AS "refundedCents",
              count(*) FILTER (WHERE o.status = 'pending')::int AS "pending",
              count(*)::int AS total
         ${from} ${f.sql}`,
      f.params,
    ),
    queryAll(`SELECT o.status::text, count(*)::int AS total ${from} ${f.sql} GROUP BY o.status`, f.params),
    queryAll(
      `SELECT o.method::text, count(*)::int AS total, coalesce(sum(o.amount_cents), 0)::int AS "amountCents"
         ${from} ${f.sql} GROUP BY o.method`,
      f.params,
    ),
  ]);

  return {
    orders,
    meta: paginatedMeta({ page: filters.page, limit: filters.limit, total }),
    summary: { ...summary.rows[0], byStatus, byMethod },
  };
}

export async function getOrderDetail(orderId) {
  const order = await queryOne(
    `SELECT ${ORDER_ROW}
       FROM orders o
       JOIN users u ON u.id = o.user_id
       JOIN courses c ON c.id = o.course_id
       LEFT JOIN enrollments e ON e.order_id = o.id
      WHERE o.id = $1`,
    [orderId],
  );
  if (!order) throw notFound('Pedido não encontrado.');

  // `payment_events` não tem coluna `provider_ref`: a referência do gateway
  // vem dentro do `payload`, e cada provedor a nomeia de um jeito. A referência
  // no topo do pedido (`orders.provider_ref`) é a canônica; aqui é apenas um
  // detalhe do evento, então pegamos o que houver no payload.
  const events = await queryAll(
    `SELECT id, event_type AS "eventType", provider,
            COALESCE(payload->>'providerRef', payload->>'reference', payload->>'id') AS "providerRef",
            created_at AS "createdAt"
       FROM payment_events WHERE order_id = $1 ORDER BY created_at DESC`,
    [orderId],
  );

  const { rows: progress } = await query(
    `SELECT count(l.id)::int AS total,
            count(lp.id) FILTER (WHERE lp.completed)::int AS completed
       FROM modules m
       JOIN lessons l ON l.module_id = m.id
       LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.enrollment_id = $2
      WHERE m.course_id = $1`,
    [order.courseId, order.userId],
  );

  return {
    order,
    events,
    studentProgress: { total: progress[0].total, completed: progress[0].completed },
  };
}

/** Estados a partir dos quais o reembolso/cancelamento faz sentido. */
const REFUNDABLE = ['paid'];
const CANCELABLE = ['pending'];

/**
 * Reembolso.
 *
 * Efeito em uma transação: pedido vira `refunded`, a matrícula ligada a ele vira
 * `refunded` (sem apagar a linha, para preservar `lesson_progress`) e o
 * certificado do aluno é revogado. Pontos não são descontados de propósito:
 * ponto é gamificação, não saldo, e descontar quebraria o placar por um erro
 * administrativo em vez de premiar a correção.
 *
 * `refund` no provedor mock é só estado interno. Com Stripe/Mercado Pago real,
 * o gateway tem que ser chamado antes de gravar isto.
 */
export async function refundOrder(actor, orderId, reason) {
  const order = await queryOne(
    `SELECT o.*, c.title AS "courseTitle", u.name AS "userName", u.email AS "userEmail",
            e.id AS "enrollmentId", e.status AS "enrollmentStatus"
       FROM orders o
       JOIN users u ON u.id = o.user_id
       JOIN courses c ON c.id = o.course_id
       LEFT JOIN enrollments e ON e.order_id = o.id
      WHERE o.id = $1`,
    [orderId],
  );
  if (!order) throw notFound('Pedido não encontrado.');
  if (!REFUNDABLE.includes(order.status)) {
    throw conflict(`Um pedido com status "${order.status}" não pode ser reembolsado.`);
  }

  const clean = reason?.trim() || 'Reembolso feito pela administração.';

  return transaction(async (client) => {
    const { rows: updated } = await client.query(
      "UPDATE orders SET status = 'refunded', updated_at = now() WHERE id = $1 RETURNING id, status, amount_cents AS \"amountCents\"",
      [order.id],
    );

    const { rows: enrollments } = await client.query(
      `UPDATE enrollments
          SET status = 'refunded', canceled_at = now(), canceled_by = $2, cancel_reason = $3
        WHERE user_id = $1 AND status = 'active'
          AND course_id IN (SELECT course_id FROM order_items WHERE order_id = $4)
        RETURNING id, status, canceled_at AS "canceledAt"`,
      [order.user_id, actor.id, clean, order.id],
    );

    const { rows: certs } = await client.query(
      `UPDATE certificates
          SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = $3
        WHERE user_id = $1 AND course_id IN (SELECT course_id FROM order_items WHERE order_id = $2)
          AND revoked_at IS NULL RETURNING id, code`,
        [order.user_id, order.id, `Reembolso do pedido ${order.id.slice(0, 8)}. ${clean}`],
    );

    await recordAudit(client, actor, 'order.refund', { type: 'order', id: order.id }, {
      summary: `Pedido de ${order.userName} (${order.courseTitle}) reembolsado — R$ ${(order.amount_cents / 100).toFixed(2)}. Motivo: ${clean}`,
      before: { status: order.status, enrollmentStatus: order.enrollmentStatus },
      after: {
        status: 'refunded',
        refundedEnrollments: enrollments.length,
        revokedCertificates: certs.length,
        reason: clean,
      },
    });

    return { order: updated[0], enrollments, revokedCertificates: certs.length };
  });
}

/**
 * Cancela um pedido que nunca foi pago. Não mexe em matrícula porque
 * pagamento pendente não gera matrícula.
 */
export async function cancelOrder(actor, orderId, reason) {
  const order = await queryOne(
    `SELECT o.id, o.status, o.amount_cents, o.user_id, c.title AS "courseTitle", u.name AS "userName"
       FROM orders o JOIN users u ON u.id = o.user_id JOIN courses c ON c.id = o.course_id
      WHERE o.id = $1`,
    [orderId],
  );
  if (!order) throw notFound('Pedido não encontrado.');
  if (!CANCELABLE.includes(order.status)) {
    throw conflict(
      order.status === 'paid'
        ? 'Este pedido já foi pago: use reembolso, não cancelamento.'
        : `Um pedido com status "${order.status}" não pode ser cancelado.`,
    );
  }

  const clean = reason?.trim() || 'Cancelado pela administração.';

  return transaction(async (client) => {
    const { rows } = await client.query(
      "UPDATE orders SET status = 'canceled', updated_at = now() WHERE id = $1 RETURNING id, status",
      [order.id],
    );
    await recordAudit(client, actor, 'order.cancel', { type: 'order', id: order.id }, {
      summary: `Pedido pendente de ${order.userName} cancelado. Motivo: ${clean}`,
      before: { status: order.status },
      after: { status: 'canceled', reason: clean },
    });
    return rows[0];
  });
}

/**
 * Confirma manualmente um pedido pendente.
 *
 * Existe para o caso em que o webhook do gateway não chega (firewall, ambiente
 * de teste, provedor configurado errado). Só faz sentido no provedor mock: em
 * produção, marcar como pago sem o gateway confirmar entrega dinheiro que não
 * entrou.
 */
export async function confirmOrderManually(actor, orderId) {
  const { config } = await import('../../config/env.js');
  if (config.payments.provider !== 'mock') {
    throw paymentRequired(
      'A confirmação manual só existe com PAYMENT_PROVIDER=mock. Em produção, o pagamento é confirmado pelo webhook do gateway.',
    );
  }

  const order = await queryOne(
    `SELECT o.id, o.status, o.user_id, o.course_id, c.title AS "courseTitle", u.name AS "userName"
       FROM orders o JOIN users u ON u.id = o.user_id JOIN courses c ON c.id = o.course_id
      WHERE o.id = $1`,
    [orderId],
  );
  if (!order) throw notFound('Pedido não encontrado.');
  if (order.status !== 'pending') {
    throw conflict(`Só é possível confirmar um pedido pendente (este está "${order.status}").`);
  }

  // `markOrderPaid` já roda na própria transação e trata a matrícula e o
  // idempotência; envolvê-lo aqui abriria uma segunda conexão sem ganho.
    // `provider_ref` tem índice único por (provider, provider_ref): a referência
    // precisa identificar o *pedido*, não o admin que confirmou. Com
    // `manual-${actor.id}` a segunda confirmação manual do mesmo admin caía em
    // violação de unicidade e ninguém mais conseguia confirmar nada.
    const result = await markOrderPaid({
      orderId: order.id,
      provider: 'mock',
      providerRef: `manual-${order.id}`,
      rawPayload: { manual: true, by: actor.email },
    });

  await transaction(async (client) => {
    await recordAudit(client, actor, 'order.confirm', { type: 'order', id: order.id }, {
      summary: `Pedido de ${order.userName} (${order.courseTitle}) confirmado manualmente`,
      before: { status: 'pending' },
      after: { status: 'paid' },
    });
  });

  return result;
}

export const reasonSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
