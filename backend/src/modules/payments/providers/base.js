/**
 * Contrato que todo provedor de pagamento deve implementar.
 *
 *   createPayment(order, user) -> { providerRef, status, checkoutUrl?, pix?, raw }
 *   verifyWebhook(req)         -> { eventType, providerRef, raw }
 *
 * O resto da aplicação só conhece esta interface, então trocar
 * Stripe por Mercado Pago (ou pelo mock local) não exige mudanças
 * nas rotas de pedidos/matrículas.
 */

/** @typedef {'pending'|'paid'|'failed'|'refunded'} PaymentStatus */

/**
 * @typedef {Object} CreatePaymentInput
 * @property {object} order   linha de `orders`
 * @property {object} user    { id, name, email }
 * @property {object} course  { id, title }
 */

export class PaymentProvider {
  /** @param {string} name */
  constructor(name) {
    this.name = name;
  }

  /**
   * Cria a cobrança junto ao gateway.
   * @param {CreatePaymentInput} _input
   * @returns {Promise<{ providerRef: string, status: PaymentStatus, checkoutUrl?: string, pix?: { qrCode: string, copyCode: string }, expiresAt?: string, raw?: object }>}
   */
  async createPayment(_input) {
    throw new Error('createPayment não implementado');
  }

  /**
   * Valida a assinatura do webhook e normaliza o evento.
   * @returns {Promise<{ eventType: 'paid'|'failed'|'refunded'|'pending', providerRef: string, raw: object }>}
   */
  async parseWebhook(_req) {
    throw new Error('parseWebhook não implementado');
  }

  /** Consulta o status direto no gateway (usado em polling/reconciliação). */
  async getPaymentStatus(_providerRef) {
    return null;
  }
}
