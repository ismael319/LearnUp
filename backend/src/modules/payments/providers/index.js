import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { MockProvider } from './mock.js';
import { StripeProvider } from './stripe.js';
import { MercadoPagoProvider } from './mercadopago.js';
import { AppError } from '../../../utils/errors.js';

const REGISTRY = {
  mock: () => new MockProvider(),
  stripe: () => new StripeProvider({ ...config.payments.stripe, currency: config.payments.currency }),
  mercadopago: () =>
    new MercadoPagoProvider({ ...config.payments.mercadoPago, currency: config.payments.currency }),
};

let instance = null;

/** Provedor ativo (lazy singleton). */
export function paymentProvider() {
  if (instance) return instance;
  const factory = REGISTRY[config.payments.provider];
  if (!factory) throw new AppError(`Provedor de pagamento desconhecido: ${config.payments.provider}`, { status: 500 });
  instance = factory();
  logger.info({ provider: instance.name }, 'Provedor de pagamento ativo');
  return instance;
}

/** Métodos de pagamento suportados pelo provedor ativo. */
export function availableMethods() {
  if (config.payments.provider === 'stripe') {
    return [{ id: 'card', label: 'Cartão de crédito', hint: 'Pagamento seguro pelo Stripe.', icon: 'card' }];
  }
  if (config.payments.provider === 'mercadopago') {
    return [{ id: 'pix', label: 'Pix', hint: 'Aprovação em segundos, 24h por dia.', icon: 'pix' }];
  }
  return [
    { id: 'pix', label: 'Pix', hint: 'Aprovação em segundos, 24h por dia.', icon: 'pix' },
    { id: 'card', label: 'Cartão de crédito', hint: 'Cartão de teste no ambiente demo.', icon: 'card' },
    { id: 'paypal', label: 'PayPal (simulado)', hint: 'Disponível apenas no modo de teste.', icon: 'paypal' },
  ];
}

export { MockProvider, StripeProvider, MercadoPagoProvider };
