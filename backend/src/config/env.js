import 'dotenv/config';
import { z } from 'zod';

const bool = (def) =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api/v1'),

  DATABASE_URL: z.string().min(1),
  PGSSL: bool('false'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_POOL_IDLE_MS: z.coerce.number().int().positive().default(30000),

  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: bool('false'),
  TRUST_PROXY: bool('false'),
  /** Desligado em `test` para a suíte não ser barrada pelo próprio rate limit. */
  RATE_LIMIT: z.enum(['true', 'false', 'auto']).default('auto'),

  PAYMENT_PROVIDER: z.enum(['mock', 'stripe', 'mercadopago']).default('mock'),
  PAYMENT_CURRENCY: z.string().length(3).default('BRL'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_SUCCESS_URL: z.string().optional(),
  STRIPE_CANCEL_URL: z.string().optional(),
  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Configuração inválida (.env):\n${issues}`);
}

const env = parsed.data;

if (env.NODE_ENV === 'production') {
  if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET e JWT_REFRESH_SECRET devem ser diferentes.');
  }
  if (env.JWT_SECRET.startsWith('dev-') || env.JWT_REFRESH_SECRET.startsWith('dev-')) {
    throw new Error('Troque os segredos JWT antes de rodar em produção.');
  }
  if (!env.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE deve ser true em produção.');
  }
}

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  apiPrefix: env.API_PREFIX,

  db: {
    url: env.DATABASE_URL,
    ssl: env.PGSSL ? { rejectUnauthorized: false } : false,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: env.DB_POOL_IDLE_MS,
  },

  auth: {
    accessSecret: env.JWT_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtlDays: env.JWT_REFRESH_TTL_DAYS,
    bcryptRounds: env.BCRYPT_ROUNDS,
    cookieName: 'learnup_rt',
    refreshCookiePath: '/',
  },

  http: {
    corsOrigin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    cookieSecure: env.COOKIE_SECURE,
    trustProxy: env.TRUST_PROXY,
    rateLimit: env.RATE_LIMIT === 'auto' ? env.NODE_ENV !== 'test' : env.RATE_LIMIT === 'true',
  },

  payments: {
    provider: env.PAYMENT_PROVIDER,
    currency: env.PAYMENT_CURRENCY,
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      successUrl: env.STRIPE_SUCCESS_URL,
      cancelUrl: env.STRIPE_CANCEL_URL,
    },
    mercadoPago: {
      accessToken: env.MERCADOPAGO_ACCESS_TOKEN,
      webhookSecret: env.MERCADOPAGO_WEBHOOK_SECRET,
    },
  },
};
