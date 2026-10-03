import { z } from 'zod';
import { query, queryAll, queryOne, transaction } from '../../config/database.js';
import { notFound, badRequest, conflict, forbidden } from '../../utils/errors.js';
import { config } from '../../config/env.js';
import { paymentProvider, availableMethods } from './providers/index.js';
import { enrollFromOrder } from '../../services/enrollments.js';
import { issueCertificate } from '../../services/certificates.js';
import { syncBadges } from '../../services/gamification.js';
import { logger } from '../../utils/logger.js';

const ORDER_SELECT = `
  SELECT o.id, o.course_id AS "courseId", o.amount_cents AS "amountCents",
         o.discount_cents AS "discountCents", o.currency, o.method, o.status,
         o.provider, o.provider_ref AS "providerRef", o.checkout_url AS "checkoutUrl",
         o.pix_qr_code AS "pixQrCode", o.pix_copy_code AS "pixCopyCode",
         o.paid_at AS "paidAt", o.created_at AS "createdAt",
         c.title AS "courseTitle", c.slug AS "courseSlug", c.cover_url AS "coverUrl"
    FROM orders o JOIN courses c ON c.id = o.course_id
`;

export const createOrderSchema = z.object({
  courseId: z.string().uuid(),
  method: z.enum(['pix', 'card', 'paypal']).default('pix'),
});

/**
 * Cria o pedido e já chama o gateway. Reaproveita um pedido pendente
 * do mesmo usuário/curso/método em vez de duplicar cobranças.
 */
export async function createOrder(user, { courseId, method }) {
  const course = await queryOne(
    `SELECT id, title, price_cents, original_price_cents, status, certificate_enabled
       FROM courses WHERE id = $1`,
    [courseId],
  );
  if (!course) throw notFound('Curso não encontrado.');
  if (course.status !== 'published') throw notFound('Curso indisponível para compra.');

  /*
   * Só uma matrícula ATIVA bloqueia a compra. Uma reembolsada ou cancelada não:
   * o aluno pagou uma vez, recebeu o dinheiro de volta e pode comprar outra vez
   * — é para isso que o `enrollFromOrder` reativa o acesso no pagamento. O que
   * não pode é acontecer de um aluno já matriculado gerar um segundo pedido.
   */
  const already = await queryOne('SELECT id, status FROM enrollments WHERE user_id = $1 AND course_id = $2', [
    user.id,
    courseId,
  ]);
  if (already?.status === 'active') throw conflict('Você já está matriculado neste curso.');
  if (already?.status === 'canceled') {
    throw conflict('Sua matrícula neste curso está cancelada. Fale com o suporte para reativá-la.', {
      courseId,
      enrollmentStatus: already.status,
    });
  }
  if (course.price_cents === 0) {
    throw badRequest('Este curso é gratuito: use POST /enrollments para se matricular.');
  }

  const amount = course.price_cents;
  // Descontos devem ser calculados de cupons/regras validadas no servidor.
  // Enquanto não existe esse domínio, o cliente não pode alterar o total.
  const discountCents = 0;
  if (!availableMethods().some((available) => available.id === method)) {
    throw badRequest('Método de pagamento indisponível para o provedor ativo.');
  }

  const reusable = await queryOne(
    `SELECT * FROM orders
      WHERE user_id = $1 AND course_id = $2 AND method = $3
        AND status = 'pending' AND created_at > now() - interval '30 minutes'
      ORDER BY created_at DESC LIMIT 1`,
    [user.id, courseId, method],
  );
  if (reusable) return { order: await getOrder(user.id, reusable.id), reused: true };

  const provider = paymentProvider();

  const { rows } = await query(
    `INSERT INTO orders (user_id, course_id, amount_cents, discount_cents, currency, method, status, provider)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7) RETURNING id`,
    [user.id, courseId, amount, discountCents, config.payments.currency, method, provider.name],
  );
  const orderId = rows[0].id;

  let payment;
  try {
    payment = await provider.createPayment({
      order: { id: orderId, amount_cents: amount, discount_cents: discountCents },
      user,
      course,
      method,
    });
  } catch (err) {
    // Um pedido sem cobrança no gateway não pode ser reaproveitado no retry.
    await query("UPDATE orders SET status = 'failed' WHERE id = $1 AND status = 'pending'", [orderId]);
    throw err;
  }

  const { rows: updated } = await query(
    `UPDATE orders
        SET provider = $2, provider_ref = $3, checkout_url = $4,
             pix_qr_code = $5, pix_copy_code = $6,
             status = (CASE WHEN $7::text = 'paid' THEN 'pending' ELSE $7 END)::order_status
      WHERE id = $1
       RETURNING id, amount_cents AS "amountCents", discount_cents AS "discountCents", method, status,
                 provider, provider_ref AS "providerRef", checkout_url AS "checkoutUrl",
                 pix_qr_code AS "pixQrCode", pix_copy_code AS "pixCopyCode", paid_at AS "paidAt"`,
    [
      orderId,
      provider.name,
      payment.providerRef,
      payment.checkoutUrl ?? null,
      payment.pix?.qrCode ?? null,
      payment.pix?.copyCode ?? null,
      payment.status,
    ],
  );

  await query(
    'INSERT INTO payment_events (order_id, provider, event_type, payload) VALUES ($1, $2, $3, $4::jsonb)',
    [orderId, provider.name, 'created', JSON.stringify(payment.raw ?? {})],
  );

  let order = updated[0];
  if (payment.status === 'paid') {
    const confirmed = await markOrderPaid({
      orderId,
      provider: provider.name,
      providerRef: payment.providerRef,
      rawPayload: payment.raw,
    });
    order = await getOrder(user.id, confirmed.order.id);
  }

  return { order, course, reused: false };
}

export const getOrder = (userId, orderId) => queryOne(`${ORDER_SELECT} WHERE o.id = $1 AND o.user_id = $2`, [orderId, userId]);

export const listOrders = (userId) =>
  queryAll(`${ORDER_SELECT} WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 50`, [userId]);

/** Pedido de qualquer usuário (uso interno / confirmação do mock). */
export const getOrderRaw = (orderIdOrProviderRef) =>
  queryOne('SELECT * FROM orders WHERE id::text = $1 OR provider_ref = $1', [String(orderIdOrProviderRef)]);

/**
 * Ponto único de confirmação de pagamento.
 * Idempotente: chamar duas vezes não duplica matrícula nem pontos.
 */
export async function markOrderPaid({ orderId, provider, providerRef, rawPayload }) {
  const result = await transaction(async (client) => {
    const { rows: orders } = await client.query(
      'SELECT * FROM orders WHERE id::text = $1 OR provider_ref = $1 FOR UPDATE',
      [String(orderId ?? providerRef)],
    );
    const order = orders[0];
    if (!order) throw notFound('Pedido não encontrado.');
    if (order.status === 'paid') return { order, alreadyPaid: true, userId: order.user_id };

    const { rows } = await client.query(
      `UPDATE orders
          SET status = 'paid', paid_at = now(),
              provider = coalesce($2, provider), provider_ref = coalesce($3, provider_ref)
        WHERE id = $1 AND status <> 'paid'
        RETURNING *`,
      [order.id, provider, providerRef],
    );
    if (rows.length === 0) throw conflict('Pedido já processado.');

    await client.query(
      'INSERT INTO payment_events (order_id, provider, event_type, payload) VALUES ($1, $2, $3, $4::jsonb)',
      [order.id, provider ?? 'mock', 'paid', JSON.stringify(rawPayload ?? {})],
    );

    const { enrollment, reactivated } = await enrollFromOrder(
      { userId: order.user_id, courseId: order.course_id, orderId: order.id },
      { client },
    );
    return {
      order: rows[0],
      alreadyPaid: false,
      userId: order.user_id,
      courseId: order.course_id,
      reactivated,
      enrollmentId: enrollment?.id ?? null,
    };
  });

  if (result.alreadyPaid) {
    logger.info({ orderId: result.order.id }, 'Pagamento já confirmado (evento duplicado ignorado)');
    return result;
  }

  /*
   * Recompra depois de um reembolso: o acesso voltou, e o certificado que o
   * reembolso revogou também tem de valer de novo. `issueCertificate` é
   * idempotente e só restaura se o curso estiver 100% concluído, então rodar
   * aqui é seguro mesmo para quem comprou pela primeira vez.
   *
   * Fica fora da transação financeira de propósito: se a emissão falhar, o
   * pagamento continua válido e o aluno pode pedir o certificado pela tela.
   */
  if (result.reactivated) {
    try {
      const certificate = await issueCertificate(result.userId, result.courseId);
      logger.info(
        { orderId: result.order.id, courseId: result.courseId, code: certificate?.code },
        'Recompra após reembolso: acesso e certificado restaurados',
      );
    } catch (err) {
      logger.warn(
        { err: err.message, orderId: result.order.id, courseId: result.courseId },
        'Recompra reativou o acesso, mas o certificado não pôde ser restaurado',
      );
    }
  }

  // Badges não fazem parte da transação financeira e só rodam após o commit.
  await syncBadges(result.userId);
  logger.info(
    { orderId: result.order.id, courseId: result.courseId, reactivated: result.reactivated },
    'Pagamento confirmado e matrícula ativa',
  );
  return result;
}

export async function markOrderFailed({ orderId, provider, providerRef, rawPayload }) {
  const order = await getOrderRaw(orderId ?? providerRef);
  if (!order) throw notFound('Pedido não encontrado.');

  const { rows } = await query(
    `UPDATE orders SET status = 'failed' WHERE id = $1 AND status = 'pending' RETURNING *`,
    [order.id],
  );

  await query(
    'INSERT INTO payment_events (order_id, provider, event_type, payload) VALUES ($1, $2, $3, $4::jsonb)',
    [order.id, provider ?? 'mock', 'failed', JSON.stringify(rawPayload ?? {})],
  );
  return rows[0] ?? order;
}

/** Normaliza o evento do gateway e aplica no pedido. */
export async function handleProviderEvent({ eventType, provider, providerRef, raw }) {
  if (eventType === 'paid') {
    const result = await markOrderPaid({ orderId: undefined, provider, providerRef, rawPayload: raw });
    return { ok: true, status: 'paid', orderId: result.order.id };
  }
  if (eventType === 'failed') {
    const order = await markOrderFailed({ orderId: undefined, provider, providerRef, rawPayload: raw });
    return { ok: true, status: 'failed', orderId: order.id };
  }
  return { ok: true, status: eventType };
}

export const methods = availableMethods;

export function assertMockOrder(userId, order) {
  if (paymentProvider().name !== 'mock') throw forbidden('Ambiente de teste desativado.');
  if (order.user_id !== userId) throw forbidden('Este pedido não é seu.');
}
