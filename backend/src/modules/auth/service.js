import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, queryOne } from '../../config/database.js';
import { config } from '../../config/env.js';
import { conflict, unauthorized, notFound, badRequest, AppError } from '../../utils/errors.js';
export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome completo.').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  password: z
    .string()
    .min(8, 'A senha precisa ter ao menos 8 caracteres.')
    .max(72, 'Senha muito longa.')
    .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), {
      message: 'A senha precisa conter letra e número.',
    }),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'É preciso aceitar os termos.' }) }),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  password: z.string().min(1, 'Informe sua senha.'),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  avatarUrl: z.string().url('URL de avatar inválida.').max(500).nullable().optional(),
  bio: z.string().trim().max(600).nullable().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual.'),
  newPassword: z
    .string()
    .min(8, 'A nova senha precisa ter ao menos 8 caracteres.')
    .max(72)
    .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), {
      message: 'A nova senha precisa conter letra e número.',
    }),
});

const PUBLIC_FIELDS = `
  id, name, email, role, avatar_url AS "avatarUrl",
  bio, points, streak_days AS "streakDays",
  created_at AS "createdAt"
`;
const hashPassword = (plain) => bcrypt.hash(plain, config.auth.bcryptRounds);

export async function register({ name, email, password }) {
  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) throw conflict('Já existe uma conta com este e-mail.');

  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING ${PUBLIC_FIELDS}`,
    [name, email, await hashPassword(password)],
  );
  return rows[0];
}

export async function login({ email, password }) {
  const user = await queryOne(
    `SELECT ${PUBLIC_FIELDS}, password_hash AS "passwordHash", blocked_at AS "blockedAt",
            blocked_reason AS "blockedReason"
       FROM users WHERE email = $1`,
    [email],
  );

  // Resposta genérica para não revelar quais e-mails existem.
  const invalid = unauthorized('E-mail ou senha incorretos.');
  if (!user) {
    // Gasta tempo similar ao do hash para evitar user enumeration por timing.
    await bcrypt.compare(password, '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu');
    throw invalid;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw invalid;

  // A senha confere antes: revelar "conta bloqueada" para quem não sabe a
  // senha viraria um oráculo de existência de e-mail.
  if (user.blockedAt) {
    throw new AppError(
      user.blockedReason
        ? `Esta conta está bloqueada. Motivo: ${user.blockedReason}`
        : 'Esta conta está bloqueada. Fale com o suporte.',
      { status: 403, code: 'account_blocked' },
    );
  }

  const { passwordHash, blockedAt, blockedReason, ...safe } = user;
  return safe;
}

export async function getProfile(userId) {
  const user = await queryOne(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [userId]);
  if (!user) throw notFound('Usuário não encontrado.');
  return user;
}

export async function updateProfile(userId, patch) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    values.push(value);
    fields.push(`${key === 'avatarUrl' ? 'avatar_url' : key} = $${values.length}`);
  }
  if (fields.length === 0) return getProfile(userId);

  values.push(userId);
  const { rows } = await query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING ${PUBLIC_FIELDS}`,
    values,
  );
  if (rows.length === 0) throw notFound('Usuário não encontrado.');
  return rows[0];
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const row = await queryOne('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!row) throw notFound('Usuário não encontrado.');

  const ok = await bcrypt.compare(currentPassword, row.password_hash);
  if (!ok) throw badRequest('Senha atual incorreta.');

  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(newPassword), userId]);
}
