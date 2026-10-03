import { createRequire } from 'node:module';
import pino from 'pino';
import pinoHttp from 'pino-http';

const require = createRequire(import.meta.url);
const isDev = process.env.NODE_ENV === 'development';
const level = process.env.LOG_LEVEL ?? 'info';

/**
 * `pino-pretty` é opcional (devDependency). Se não estiver instalado,
 * caímos para o logger JSON nativo em vez de quebrar o boot.
 */
function prettyTransport(extra = {}) {
  try {
    require.resolve('pino-pretty');
    return {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ...extra },
    };
  } catch {
    return undefined;
  }
}

const base = { level, base: { service: 'learnup-api' } };
const transport = isDev ? prettyTransport() : undefined;

export const logger = transport ? pino({ ...base, transport }) : pino(base);

const httpTransport = isDev ? prettyTransport({ ignore: 'req.headers,res.headers' }) : undefined;

const httpOptions = {
  level,
  ...(httpTransport ? { transport: httpTransport } : {}),
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: {
    ignore: (req) => req.url === '/health' || req.url === '/api/v1/health',
  },
};

/** Middleware de log de requisições. */
export const httpLogger = pinoHttp(httpOptions);
