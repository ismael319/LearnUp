import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Boolean de query string ou de formulário, sem a armadilha do
 * `z.coerce.boolean()`.
 *
 * Coerção usa truthiness, e em JavaScript a string "false" é verdadeira: um
 * `?revoked=false` viraria `true` e o filtro responderia o contrário do que a
 * tela pediu. Aqui "false", "0" e "" são explicitamente falsos.
 *
 *   const flag = booleanFlag();              // opcional
 *   const flag = booleanFlag().default(false)
 */
export const booleanFlag = () =>
  z.preprocess((raw) => {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) return false;
      if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
      return undefined;
    }
    return raw;
  }, z.boolean().optional());

export const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

export const slugify = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Formata centavos como moeda (1000 -> "R$ 10,00"). */
export const formatBRL = (cents, currency = 'BRL') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format((cents ?? 0) / 100);

/** Minutos -> "3h 25min" */
export const formatDuration = (minutes) => {
  const m = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}min` : `${m}min`;
};

/** Gera um código de certificado legível: 8-X4A9-2KQ7-M3ZP */
export const generateCertificateCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `LEARNUP-${block()}-${block()}`;
};

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
