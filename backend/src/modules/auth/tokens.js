import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { config } from '../../config/env.js';
import { sha256 } from '../../utils/helpers.js';
import { query, transaction } from '../../config/database.js';

const { auth } = config;

/**
 * Access token: curto (15 min), stateless, enviado no header Authorization.
 * Contém apenas o necessário para autorizar (id, e-mail, role).
 */
export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    auth.accessSecret,
    { expiresIn: auth.accessTtl, issuer: 'learnup' },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, auth.accessSecret, { issuer: 'learnup' });
}

/**
 * Refresh token: longo (30 dias), opaco (UUID aleatório) e-armazenado
 * apenas como hash no banco. Permite revogação e rotação.
 */
export function createRefreshToken() {
  const token = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + auth.refreshTtlDays * 24 * 60 * 60 * 1000);
  return { token, tokenHash: sha256(token), expiresAt };
}

export function hashRefreshToken(token) {
  return sha256(token);
}

export async function storeRefreshToken({ userId, tokenHash, expiresAt, userAgent, ipAddress }) {
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, expiresAt, userAgent?.slice(0, 255) ?? null, ipAddress ?? null],
  );
}

/**
 * Consome um refresh token: valida, revoga o usado (rotação) e devolve o
 * usuário. Tokens expirados ou já revogados falham aqui.
 */
export async function rotateRefreshToken(rawToken, { userAgent, ipAddress } = {}) {
  if (!rawToken) return null;
  const tokenHash = hashRefreshToken(rawToken);

  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT rt.id, rt.user_id, rt.revoked_at, rt.expires_at,
              u.name, u.email, u.role, u.avatar_url, u.points, u.blocked_at
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1
        FOR UPDATE`,
      [tokenHash],
    );
    const record = rows[0];
    if (!record) return null;

    // Bloquear a conta apaga os refresh tokens, mas um cookie já emitido
    // poderia chegar aqui antes da limpeza. O `blocked_at` é a rede de proteção.
    if (record.blocked_at) return null;

    if (record.revoked_at || new Date(record.expires_at) <= new Date()) {
      // Reuso de token rotacionado indica possível roubo. Revogamos as sessões
      // ainda válidas do usuário, evitando que o sucessor seja utilizado.
      if (record.revoked_at) {
        await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [record.user_id]);
      }
      return null;
    }

    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [record.id]);
    const { token, tokenHash: newHash, expiresAt } = createRefreshToken();
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [record.user_id, newHash, expiresAt, userAgent?.slice(0, 255) ?? null, ipAddress ?? null],
    );

    return {
      refreshToken: token,
      user: {
        id: record.user_id,
        name: record.name,
        email: record.email,
        role: record.role,
        avatarUrl: record.avatar_url,
        points: record.points,
      },
    };
  });
}

export async function revokeAllUserTokens(userId) {
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
    userId,
  ]);
}

/** Limpa tokens expirados (chamado por um cron/script de manutenção). */
export async function purgeExpiredTokens() {
  const { rowCount } = await query(`DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'`);
  return rowCount;
}

/** Cookie httpOnly com o refresh token. */
export function setRefreshCookie(res, token) {
  res.cookie(auth.cookieName, token, {
    httpOnly: true,
    secure: config.http.cookieSecure,
    sameSite: 'lax',
    path: auth.refreshCookiePath,
    maxAge: auth.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(auth.cookieName, { path: auth.refreshCookiePath });
}
