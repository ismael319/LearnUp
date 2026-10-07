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
          c.title AS "courseTitle", c.slug AS "courseSlug", c.cover_url AS "coverUrl",
          COALESCE(items.items, '[]'::json) AS items
    FROM orders o
    JOIN courses c ON c.id = o.course_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
        'courseId', oi.course_id, 'title', oi.title, 'coverUrl', oi.cover_url,
        'unitCents', oi.unit_cents, 'slug', ic.slug
      ) ORDER BY oi.created_at) AS items
      FROM order_items oi JOIN courses ic ON ic.id = oi.course_id
      WHERE oi.order_id = o.id
    ) items ON true
`;

export const createOrderSchema = z.object({
  courseIds: z.array(z.string().uuid()).min(1).max(20).optional(),
  // Aceito apenas durante a transição de links antigos de checkout.
  courseId: z.string().uuid().optional(),
  method: z.enum(['pix', 'card', 'paypal']).default('pix'),
}).superRefine((body, ctx) => {
  if (!body.courseIds?.length && !body.courseId) {
    ctx.addIssue({ code: 'custom', message: 'Informe pelo menos um curso.', path: ['courseIds'] });
  }
});

/**
 * Cria o pedido e já chama o gateway. Reaproveita um pedido pendente
 * do mesmo usuário/curso/método em vez de duplicar cobranças.
 */
export async function createOrder(user, { courseIds, courseId, method }) {
  const ids = [...new Set(courseIds?.length ? courseIds : [courseId])];
  const courses = await queryAll(
    `SELECT id, title, cover_url, price_cents, original_price_cents, status, certificate_enabled
       FROM courses WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  if (courses.length !== ids.length) throw notFound('Um dos cursos não foi encontrado.');
  if (courses.some((course) => course.status !== 'published')) throw notFound('Um dos cursos está indisponível para compra.');

  /*
   * Só uma matrícula ATIVA bloqueia a compra. Uma reembolsada ou cancelada não:
   * o aluno pagou uma vez, recebeu o dinheiro de volta e pode comprar outra vez
   * — é para isso que o `enrollFromOrder` reativa o acesso no pagamento. O que
   * não pode é acontecer de um aluno já matriculado gerar um segundo pedido.
   */
  const enrollments = await queryAll('SELECT course_id, status FROM enrollments WHERE user_id = $1 AND course_id = ANY($2::uuid[])', [user.id, ids]);
  const active = enrollments.find((enrollment) => enrollment.status === 'active');
  if (active) throw conflict('Você já está matriculado em um dos cursos selecionados.', { courseId: active.course_id });
  const canceled = enrollments.find((enrollment) => enrollment.status === 'canceled');
  if (canceled) throw conflict('Uma matrícula selecionada está cancelada. Fale com o suporte para reativá-la.', { courseId: canceled.course_id });
  if (courses.some((course) => course.price_cents === 0)) throw badRequest('Cursos gratuitos devem ser matriculados diretamente.');

  const amount = courses.reduce((total, course) => total + course.price_cents, 0);
  // Descontos devem ser calculados de cupons/regras validadas no servidor.
  // Enquanto não existe esse domínio, o cliente não pode alterar o total.
  const discountCents = 0;
  if (!availableMethods().some((available) => available.id === method)) {
    throw badRequest('Método de pagamento indisponível para o provedor ativo.');
  }

  const provider = paymentProvider();

  const { rows } = await query(
    `INSERT INTO orders (user_id, course_id, amount_cents, discount_cents, currency, method, status, provider)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7) RETURNING id`,
    [user.id, courses[0].id, amount, discountCents, config.payments.currency, method, provider.name],
  );
  const orderId = rows[0].id;

  for (const course of courses) {
    await query(
      `INSERT INTO order_items (order_id, course_id, title, cover_url, unit_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, course.id, course.title, course.cover_url, course.price_cents],
    );
  }

  let payment;
  try {
    payment = await provider.createPayment({
      order: { id: orderId, amount_cents: amount, discount_cents: discountCents },
      user,
      course: courses[0],
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

  // `course` preserva o contrato de consumidores antigos durante a transição.
  return { order, course: courses[0], courses, reused: false };
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

    const { rows: items } = await client.query('SELECT course_id FROM order_items WHERE order_id = $1 ORDER BY created_at', [order.id]);
    const outcomes = [];
    for (const item of items) {
      outcomes.push(await enrollFromOrder({ userId: order.user_id, courseId: item.course_id, orderId: order.id }, { client }));
    }
    return {
      order: rows[0],
      alreadyPaid: false,
      userId: order.user_id,
      courseIds: items.map((item) => item.course_id),
      reactivated: outcomes.some((outcome) => outcome.reactivated),
      enrollmentIds: outcomes.map((outcome) => outcome.enrollment?.id).filter(Boolean),
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
    for (const courseId of result.courseIds) {
      try { await issueCertificate(result.userId, courseId); } catch (err) {
        logger.warn({ err: err.message, orderId: result.order.id, courseId }, 'Recompra reativou o acesso, mas o certificado não pôde ser restaurado');
      }
    }
  }

  // Badges não fazem parte da transação financeira e só rodam após o commit.
  await syncBadges(result.userId);
  logger.info(
    { orderId: result.order.id, courseIds: result.courseIds, reactivated: result.reactivated },
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
