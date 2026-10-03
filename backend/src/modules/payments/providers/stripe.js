import { PaymentProvider } from './base.js';
import { AppError } from '../../../utils/errors.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.stripe.com/v1';

/**
 * Stripe Checkout (cartão). Ativado com PAYMENT_PROVIDER=stripe e
 * STRIPE_SECRET_KEY preenchida. A dependência `stripe` é carregada sob
 * demanda para não ser obrigatória em instalações sem o gateway.
 */
export class StripeProvider extends PaymentProvider {
  constructor({ secretKey, successUrl, cancelUrl, currency = 'BRL' }) {
    super('stripe');
    if (!secretKey) throw new AppError('STRIPE_SECRET_KEY não configurada.', { status: 500 });
    this.secretKey = secretKey;
    this.successUrl = successUrl;
    this.cancelUrl = cancelUrl;
    this.currency = currency;
  }

  async #request(path, body) {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new AppError(data?.error?.message ?? 'Falha na comunicação com o Stripe.', {
        status: 502,
        code: 'gateway_error',
        details: data?.error,
      });
    }
    return data;
  }

  async createPayment({ order, user, course }) {
    const body = new URLSearchParams({
      mode: 'payment',
      success_url: `${this.successUrl}?session_id={CHECKOUT_SESSION_ID}&order=${order.id}`,
      cancel_url: `${this.cancelUrl}?order=${order.id}&canceled=1`,
      customer_email: user.email,
      client_reference_id: order.id,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': this.currency.toLowerCase(),
       // A Stripe recebe a menor unidade monetária (centavos para BRL).
       'line_items[0][price_data][unit_amount]': String(order.amount_cents - order.discount_cents),
      'line_items[0][price_data][product_data][name]': course.title,
      'metadata[order_id]': order.id,
    });

    const session = await this.#request('/checkout/sessions', body);
    return { providerRef: session.id, status: 'pending', checkoutUrl: session.url, raw: session };
  }

  /**
   * O Stripe assina o corpo bruto (raw body). O middleware de webhook
   * preserva o buffer, então validamos a assinatura aqui.
   */
  async parseWebhook(req, { webhookSecret }) {
    const signature = req.get('stripe-signature');
    if (!signature) throw new AppError('Assinatura ausente.', { status: 400 });
    if (!webhookSecret) throw new AppError('STRIPE_WEBHOOK_SECRET não configurado.', { status: 500 });

    const parts = Object.fromEntries(
      signature.split(',').map((item) => {
        const [key, value] = item.trim().split('=');
        return [key, value];
      }),
    );
    const timestamp = Number(parts.t);
    const received = parts.v1;
    if (!Number.isSafeInteger(timestamp) || !received) {
      throw new AppError('Assinatura Stripe inválida.', { status: 400 });
    }
    if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
      throw new AppError('Webhook Stripe expirado.', { status: 400 });
    }

    let event;
    try {
      if (!Buffer.isBuffer(req.body)) throw new Error('Corpo bruto ausente');
      const expected = createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${req.body.toString('utf8')}`)
        .digest('hex');
      const expectedBuffer = Buffer.from(expected, 'utf8');
      const receivedBuffer = Buffer.from(received, 'utf8');
      if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
        throw new Error('Assinatura não confere');
      }
      event = JSON.parse(req.body.toString('utf8'));
    } catch (err) {
      throw new AppError(`Assinatura inválida: ${err.message}`, { status: 400 });
    }

    const map = {
      'checkout.session.completed': 'paid',
      'checkout.session.async_payment_succeeded': 'paid',
      'checkout.session.async_payment_failed': 'failed',
      'checkout.session.expired': 'failed',
      'charge.refunded': 'refunded',
    };

    return {
      eventType: map[event.type] ?? 'pending',
      providerRef: event.data.object.client_reference_id ?? event.data.object.id,
      raw: event,
    };
  }
}
