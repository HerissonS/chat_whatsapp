import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from 'react';
import { api, ApiError, setCsrfToken } from '../lib/api';
import { closeSocket } from '../lib/socket';
import type { Me } from '../lib/types';

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  can: (permission: string) => boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const me = await api.get<Me>('auth/me');
        setCsrfToken(me.csrfToken);
        return me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    const onExpired = () => {
      closeSocket();
      qc.setQueryData(['me'], null);
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [qc]);

  const reload = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const login = useCallback(
    async (username: string, password: string) => {
      await api.post('auth/login', { username, password });
      await refetch();
    },
    [refetch],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('auth/logout');
    } catch {
      /* mesmo com erro (sessão já expirada), sai do sistema */
    } finally {
      closeSocket();
      // Recarrega a página do zero: limpa cache, conexões e estado, e mostra a tela de login.
      window.location.replace(window.location.pathname + window.location.search);
    }
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      me: data ?? null,
      loading: isLoading,
      can: (p) => !!data?.permissions.includes(p),
      login,
      logout,
      reload,
    }),
    [data, isLoading, login, logout, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fora do AuthProvider');
  return c;
}
