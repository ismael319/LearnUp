import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, tokens, onSessionExpired, ApiError } from '../api/client.js';

const AuthContext = createContext(null);

const USER_KEY = 'learnup.user';

const readCachedUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY)) ?? null;
  } catch {
    return null;
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readCachedUser);
  const [booting, setBooting] = useState(true);

  const persist = useCallback((next) => {
    setUser(next);
    if (next) localStorage.setItem(USER_KEY, JSON.stringify(next));
    else localStorage.removeItem(USER_KEY);
  }, []);

  /**
   * Revalida a sessão no boot: o access token pode ter expirado desde a
   * última visita, mas o refresh token ainda vale.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!tokens.access && !readCachedUser()) {
        if (!cancelled) setBooting(false);
        return;
      }
      try {
        const { user: me } = await authApi.me();
        if (!cancelled) persist(me);
      } catch {
        if (!cancelled) {
          tokens.clear();
          persist(null);
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [persist]);

  // O cliente HTTP avisa aqui quando não consegue mais renovar o token.
  useEffect(() => onSessionExpired(() => persist(null)), [persist]);

  const login = useCallback(
    async (credentials) => {
      const { data, status } = await authApi.loginRaw(credentials);
      if (status >= 400) throw new ApiError(status, data);

      tokens.save(data);
      persist(data.user);
      return data.user;
    },
    [persist],
  );

  const register = useCallback(
    async (payload) => {
      const { data, status } = await authApi.registerRaw(payload);
      if (status >= 400) throw new ApiError(status, data);

      tokens.save(data);
      persist(data.user);
      return data.user;
    },
    [persist],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Mesmo que a revogação falhe, limpamos o estado local.
    } finally {
      tokens.clear();
      persist(null);
    }
  }, [persist]);

  const updateProfile = useCallback(
    async (patch) => {
      const { user: updated } = await authApi.updateProfile(patch);
      persist(updated);
      return updated;
    },
    [persist],
  );

  const value = useMemo(
    () => ({
      user,
      booting,
      isAuthenticated: Boolean(user),
      // O admin também gerencia cursos, por isso entra em canManageCourses.
      canManageCourses: user?.role === 'instructor' || user?.role === 'admin',
      isAdmin: user?.role === 'admin',
      login,
      register,
      logout,
      updateProfile,
      setUser: persist,
    }),
    [user, booting, login, register, logout, updateProfile, persist],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
