import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError(`Rota não encontrada: ${req.method} ${req.originalUrl}`, { status: 404, code: 'route_not_found' }));
}

// eslint-disable-next-line no-unused-vars -- Express exige os 4 parâmetros
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    err = new AppError('Dados inválidos.', {
      status: 422,
      code: 'validation_error',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  // Violação de constraint do Postgres -> 409 com detalhe legível.
  if (err?.code === '23505') {
    err = new AppError('Registro duplicado.', { status: 409, code: 'duplicate', details: err.constraint });
  }
  if (err?.code === '23503') {
    err = new AppError('Referência inválida para um registro inexistente.', {
      status: 409,
      code: 'foreign_key',
      details: err.constraint,
    });
  }

  const status = err?.status ?? 500;
  const isServerError = status >= 500;

  if (isServerError) {
    logger.error({ err, path: req.originalUrl, method: req.method }, 'Erro não tratado');
  } else {
    logger.warn({ code: err?.code, path: req.originalUrl, msg: err?.message }, 'Requisição rejeitada');
  }

  res.status(status).json({
    error: {
      code: err?.code ?? 'internal_error',
      message: isServerError ? 'Erro interno do servidor.' : err.message,
      ...(err?.details ? { details: err.details } : {}),
      ...(config.isProd ? {} : isServerError ? { stack: err?.stack } : {}),
    },
  });
}
