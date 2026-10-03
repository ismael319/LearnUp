import { verifyAccessToken } from '../modules/auth/tokens.js';
import { queryOne } from '../config/database.js';
import { unauthorized, forbidden, AppError } from '../utils/errors.js';

function readBearer(req) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function userFromPayload(payload) {
  return { id: payload.sub, email: payload.email, role: payload.role, name: payload.name };
}

/**
 * Exige um access token JWT válido (Authorization: Bearer <token>).
 * Anexa `req.user = { id, email, role, name }`.
 */
export function authenticate(req, _res, next) {
  const token = readBearer(req);
  if (!token) return next(unauthorized('Informe o header Authorization: Bearer <token>.'));

  try {
    req.user = userFromPayload(verifyAccessToken(token));
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Sessão expirada. Faça login novamente.' : 'Token inválido.';
    return next(unauthorized(message));
  }

  /*
   * O papel e o nome viajam dentro do token, então o bloqueio não aparece nele:
   * depender só do token significaria que a conta continuaria valendo até o
   * access token expirar (15 minutos). A checagem é um índice primário em
   * `users`, e o bloqueio é raro o bastante para não compensar um cache.
   */
  return checkBlocked(req, next);
}

/**
 * Recusa o acesso de conta bloqueada.
 *
 * O `authenticate` acima já populou `req.user`, mas `optionalAuth` também usa
 * este passo: quem navega no catálogo com a sessão de uma conta recém-bloqueada
 * deve cair para "deslogado" em vez de continuar aparecendo como autenticado.
 */
async function checkBlocked(req, next) {
  try {
    const row = await queryOne('SELECT blocked_at, blocked_reason FROM users WHERE id = $1', [req.user.id]);
    if (row?.blocked_at) {
      return next(
        new AppError(
          row.blocked_reason
            ? `Esta conta está bloqueada. Motivo: ${row.blocked_reason}`
            : 'Esta conta está bloqueada. Fale com o suporte.',
          { status: 403, code: 'account_blocked' },
        ),
      );
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Popula req.user quando houver token, mas não bloqueia. */
export function optionalAuth(req, _res, next) {
  const token = readBearer(req);
  if (token) {
    try {
      req.user = userFromPayload(verifyAccessToken(token));
    } catch {
      /* ignora token inválido em rotas opcionais */
      return next();
    }
    return checkBlocked(req, (err) => next(err));
  }
  return next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) =>
    req.user && roles.includes(req.user.role)
      ? next()
      : next(forbidden(`Somente ${roles.join(' ou ')} pode acessar este recurso.`));
