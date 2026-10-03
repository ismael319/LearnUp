import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaymentProvider } from './base.js';
import { AppError } from '../../../utils/errors.js';

const API = 'https://api.mercadopago.com';

/**
 * Mercado Pago: único caminho simples para Pix no Brasil.
 * Cria um "payment" com `payment_method_id` e devolve o
 * `point_of_interaction.transaction_data.qr_code` para o app mostrar
 * o QR / código copia-e-cola.
 */
export class MercadoPagoProvider extends PaymentProvider {
  constructor({ accessToken, currency = 'BRL' }) {
    super('mercadopago');
    if (!accessToken) throw new AppError('MERCADOPAGO_ACCESS_TOKEN não configurado.', { status: 500 });
    this.accessToken = accessToken;
    this.currency = currency;
  }

  async #request(path, { method = 'POST', body } = {}) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new AppError(data?.message ?? 'Falha na comunicação com o Mercado Pago.', {
        status: 502,
        code: 'gateway_error',
        details: data,
      });
    }
    return data;
  }

  static methodFor(kind) {
    // mapping app -> gateway
    if (kind === 'pix') return { id: 'pix', type: 'bank_transfer' };
    if (kind === 'paypal') return { id: 'paypal', type: 'approved' };
    return { id: 'credit_card', type: 'credit_card' };
  }

  async createPayment({ order, user, course, method = 'card' }) {
    const mp = MercadoPagoProvider.methodFor(method);
    const total = order.amount_cents - order.discount_cents;

    const data = await this.#request('/v1/payments', {
      body: {
        transaction_amount: total / 100,
        currency_id: this.currency,
        description: course.title.slice(0, 120),
        payment_method_id: mp.id,
        payer: { email: user.email, first_name: user.name?.split(' ')[0] },
        external_reference: order.id,
        metadata: { order_id: order.id, user_id: user.id, course_id: course.id },
        ...(mp.id === 'credit_card'
          ? {
              token: process.env.MERCADOPAGO_CARD_TOKEN ?? undefined,
              installments: 1,
              statement_descriptor: 'LEARNUP',
            }
          : {}),
        ...(mp.id === 'pix' ? { statement_descriptor: 'LEARNUP' } : {}),
      },
    });

    const tx = data.point_of_interaction?.transaction_data ?? {};

    return {
      providerRef: String(data.id),
      status: data.status === 'approved' ? 'paid' : 'pending',
      checkoutUrl: data.sandbox_init_point ?? null,
      pix: tx.qr_code
        ? { qrCode: tx.qr_code_base64 ?? tx.qr_code, copyCode: tx.qr_code }
        : undefined,
      raw: data,
    };
  }

  /**
   * O Mercado Pago assina o webhook com HMAC-SHA256 no header
     * `x-signature`, no formato `ts=...,v1=...`, usando o segredo da
     * aplicação. O identificador chega em `data.id`; a API do gateway é a
     * fonte de verdade para status e referência externa.
   */
  async parseWebhook(req, { webhookSecret }) {
    if (!webhookSecret) {
      throw new AppError('MERCADOPAGO_WEBHOOK_SECRET não configurado; webhook não validado.', { status: 500 });
    }

    const header = req.get('x-signature') ?? '';
    const parts = Object.fromEntries(
      header.split(',').map((kv) => {
        const [k, ...rest] = kv.split('=');
        return [k.trim(), rest.join('=')];
      }),
    );
    if (!parts.ts || !parts.v1) throw new AppError('Header x-signature inválido.', { status: 400 });

    if (!Buffer.isBuffer(req.body)) throw new AppError('Corpo bruto ausente.', { status: 400 });
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      throw new AppError('Corpo do webhook inválido.', { status: 400 });
    }

    const dataId = req.query?.['data.id'] ?? req.query?.data?.id ?? payload?.data?.id;
    if (!dataId) throw new AppError('Webhook sem identificador de pagamento.', { status: 400 });
    const requestId = req.get('x-request-id') ?? '';
    const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
    const expected = createHmac('sha256', webhookSecret).update(manifest).digest('hex');

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(parts.v1, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppError('Assinatura do webhook inválida.', { status: 400 });
    }

    return this.getPaymentStatus(String(dataId));
  }

  async getPaymentStatus(providerRef) {
    const data = await this.#request(`/v1/payments/${providerRef}`, { method: 'GET' });
    const eventType =
      data.status === 'approved'
        ? 'paid'
        : data.status === 'rejected' || data.status === 'cancelled'
          ? 'failed'
          : data.status === 'refunded'
            ? 'refunded'
            : 'pending';
    return { eventType, providerRef: String(data.id), raw: data };
  }
}
