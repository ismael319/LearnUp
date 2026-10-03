import { useCallback, useEffect, useRef, useState } from 'react';
import { NetworkError } from '../api/client.js';

/**
 * Fetch de dados com estados de loading/erro e proteção contra
 * `setState` após unmount. Substitui o uso de uma lib de cache para
 * manter o projeto sem dependências extras.
 *
 * @param {(signal: AbortSignal) => Promise<any>} fetcher
 * @param {Array} deps  valores que re-disparam a requisição
 */
export function useApi(fetcher, deps = [], { skip = false, onSuccess } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!skip);
  const [reloadKey, setReloadKey] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (skip) {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    // `Promise.resolve` tolera um fetcher que devolve valor síncrono (ex.:
    // `() => ready ? api.list() : null`). Sem isto, `.then` em `null` derrubava
    // a tela inteira.
    Promise.resolve(fetcher(controller.signal))
      .then((result) => {
        if (!alive.current || controller.signal.aborted) return;
        setData(result);
        onSuccess?.(result);
      })
      .catch((err) => {
        if (!alive.current || controller.signal.aborted || err?.name === 'AbortError') return;
        setError(err);
      })
      .finally(() => {
        if (alive.current && !controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, skip, reloadKey]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  /** Substitui um item da lista sem refazer a requisição inteira. */
  const patch = useCallback((updater) => {
    setData((current) => (current ? updater(current) : current));
  }, []);

  return { data, error, loading, refetch, patch, setData };
}

/** Estado de envio para formulários (login, cadastro, post, comentário). */
export function useSubmit(action) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const submit = useCallback(
    async (...args) => {
      setLoading(true);
      setError(null);
      try {
        return await action(...args);
      } catch (err) {
        if (alive.current) setError(err);
        throw err;
      } finally {
        if (alive.current) setLoading(false);
      }
    },
    [action],
  );

  return { submit, loading, error, setError };
}

/** Debounce para campos de busca (evita uma request por tecla). */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}

export const isNetworkError = (err) => err instanceof NetworkError;

/** Mensagem legível para qualquer erro vindo da API. */
export const errorMessage = (err) => {
  if (!err) return null;
  if (err.details?.length) return err.message;
  return err.message ?? 'Algo deu errado. Tente novamente.';
};
