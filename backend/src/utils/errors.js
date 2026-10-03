/** Erro de aplicação com status HTTP e código estável para o cliente. */
export class AppError extends Error {
  constructor(message, { status = 400, code = 'bad_request', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expected = true;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (msg, details) => new AppError(msg, { status: 400, code: 'bad_request', details });
export const unauthorized = (msg = 'Autenticação necessária.') =>
  new AppError(msg, { status: 401, code: 'unauthorized' });
export const forbidden = (msg = 'Você não tem permissão para esta ação.', details) =>
  new AppError(msg, { status: 403, code: 'forbidden', details });
export const notFound = (msg = 'Recurso não encontrado.') =>
  new AppError(msg, { status: 404, code: 'not_found' });
export const conflict = (msg, details) => new AppError(msg, { status: 409, code: 'conflict', details });
export const unprocessable = (msg, details) =>
  new AppError(msg, { status: 422, code: 'unprocessable_entity', details });
export const paymentRequired = (msg, details) =>
  new AppError(msg, { status: 402, code: 'payment_required', details });
