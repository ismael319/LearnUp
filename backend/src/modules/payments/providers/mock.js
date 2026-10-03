import { PaymentProvider } from './base.js';
import { randomBytes } from 'node:crypto';

/** CRC16-CCITT (poly 0x1021, init 0xFFFF) exigido pelo padrão do Pix. */
export function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (id, value) => {
  const v = String(value);
  return `${id}${String(v.length).padStart(2, '0')}${v}`;
};

/**
 * Monta um payload Pix (BR Code) EMV v2. Payload gerado localmente,
 * com chave "ev txid" e merchant fictício — serve para testar o fluxo
 * de ponta a ponta sem gateway externo.
 */
export function buildPixPayload({ amountCents = 0, txid = '***', city = 'SAO PAULO', name = 'LEARNUP' }) {
  const key = `ev.txid.${txid}`;
  const amount = (amountCents / 100).toFixed(2);

  let payload =
    tlv('00', '01') +
    tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', key)) +
    tlv('52', '0000') +
    tlv('53', '986') +
    (amountCents > 0 ? tlv('54', amount) : tlv('54', '0.00')) +
    tlv('58', 'BR') +
    tlv('59', name.slice(0, 25)) +
    tlv('60', city.slice(0, 15)) +
    tlv('62', tlv('05', txid === '***' ? '***' : txid.slice(0, 25)));

  payload += '6304';
  return payload + crc16(payload);
}

/**
 * Provedor de teste: não fala com nenhum gateway e não processa dinheiro
 * real. Use `POST /payments/mock/:orderId/confirm` para simular a
 * confirmação e ver a matrícula/emitir o certificado.
 */
export class MockProvider extends PaymentProvider {
  constructor() {
    super('mock');
  }

  async createPayment({ order, method }) {
    const providerRef = `mock_${randomBytes(10).toString('hex')}`;

    if (method === 'pix') {
      const payload = buildPixPayload({ amountCents: order.amount_cents - order.discount_cents });
      return {
        providerRef,
        status: 'pending',
        checkoutUrl: null,
        pix: { qrCode: payload, copyCode: payload },
        raw: { simulated: true },
      };
    }

    if (method === 'paypal') {
      return {
        providerRef,
        status: 'pending',
        checkoutUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${providerRef}`,
        raw: { simulated: true },
      };
    }

    return {
      providerRef,
      status: 'pending',
      // No mock, o "checkout" é a própria rota de confirmação.
      checkoutUrl: `/api/v1/payments/mock/${order.id}/confirm`,
      raw: { simulated: true },
    };
  }

  async parseWebhook(_req) {
    throw new Error('O provedor mock não recebe webhooks; use POST /payments/mock/:orderId/confirm');
  }

  async getPaymentStatus() {
    return null;
  }
}
