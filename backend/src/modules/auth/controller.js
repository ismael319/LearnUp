import { Router } from 'express';
import { asyncHandler } from '../../utils/helpers.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { config } from '../../config/env.js';
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  register,
  login,
  getProfile,
  updateProfile,
  changePassword,
} from './service.js';
import {
  signAccessToken,
  createRefreshToken,
  storeRefreshToken,
  rotateRefreshToken,
  revokeAllUserTokens,
  setRefreshCookie,
  clearRefreshCookie,
} from './tokens.js';

const ctx = (req) => ({ userAgent: req.get('user-agent'), ipAddress: req.ip });

/** Cria access + refresh token, persiste o refresh (hash) e seta o cookie. */
async function issueSession(res, user, requestCtx) {
  const accessToken = signAccessToken(user);
  const { token, tokenHash, expiresAt } = createRefreshToken();
  await storeRefreshToken({ userId: user.id, tokenHash, expiresAt, ...requestCtx });
  setRefreshCookie(res, token);
  return {
    user,
    accessToken,
    refreshToken: token, // no body para clientes sem suporte a cookie
    expiresIn: config.auth.accessTtl,
  };
}

export const registerController = asyncHandler(async (req, res) => {
  const user = await register(req.body);
  res.status(201).json(await issueSession(res, user, ctx(req)));
});

export const loginController = asyncHandler(async (req, res) => {
  const user = await login(req.body);
  res.json(await issueSession(res, user, ctx(req)));
});

export const refreshController = asyncHandler(async (req, res) => {
  const raw = req.cookies?.[config.auth.cookieName] ?? req.body?.refreshToken;
  const result = await rotateRefreshToken(raw, ctx(req));

  if (!result) {
    clearRefreshCookie(res);
    return res.status(401).json({
      error: { code: 'invalid_refresh_token', message: 'Sessão expirada. Faça login novamente.' },
    });
  }

  setRefreshCookie(res, result.refreshToken);
  res.json({
    user: result.user,
    accessToken: signAccessToken(result.user),
    refreshToken: result.refreshToken,
  });
});

export const logoutController = asyncHandler(async (req, res) => {
  await revokeAllUserTokens(req.user.id);
  clearRefreshCookie(res);
  res.json({ ok: true });
});

export const meController = asyncHandler(async (req, res) => {
  res.json({ user: await getProfile(req.user.id) });
});

export const updateMeController = asyncHandler(async (req, res) => {
  res.json({ user: await updateProfile(req.user.id, req.body) });
});

export const changePasswordController = asyncHandler(async (req, res) => {
  await changePassword(req.user.id, req.body);
  // Trocar a senha invalida todas as sessões por segurança.
  await revokeAllUserTokens(req.user.id);
  clearRefreshCookie(res);
  res.json({ ok: true, message: 'Senha alterada. Faça login novamente.' });
});

const router = Router();

router.post('/register', validate({ body: registerSchema }), registerController);
router.post('/login', validate({ body: loginSchema }), loginController);
router.post('/refresh', refreshController);
router.post('/logout', authenticate, logoutController);
router.get('/me', authenticate, meController);
router.patch('/me', authenticate, validate({ body: updateProfileSchema }), updateMeController);
router.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  changePasswordController,
);

export default router;
