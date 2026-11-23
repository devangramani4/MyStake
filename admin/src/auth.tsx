import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, hasSessionCookie, logoutRequest, refresh, setOnLogout, setToken } from './api';

export type Permission =
  | 'dashboard:view' | 'users:view' | 'users:manage' | 'bets:view' | 'bets:manage' | 'sports:manage' | 'finance:view'
  | 'finance:manage' | 'wallet:adjust' | 'risk:manage' | 'settings:manage' | 'admins:manage' | 'audit:view';

export interface Admin { id: number; email: string; name: string; role: string; permissions: Permission[] }

interface Ctx { admin: Admin | null; ready: boolean; login: (email: string, password: string, totpCode?: string) => Promise<void>; logout: () => Promise<void>; can: (p: Permission) => boolean }
const AuthCtx = createContext<Ctx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setOnLogout(() => setAdmin(null));
    (async () => {
      if (hasSessionCookie() && (await refresh())) {
        const r = await api.get('/admin/me').catch(() => null);
        if (r) setAdmin(r.data.admin);
      }
      setReady(true);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string, totpCode?: string) => {
    const r = await api.post('/admin/auth/login', { email, password, totpCode });
    setToken(r.data.accessToken);
    setAdmin(r.data.admin);
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest().catch(() => undefined);
    setToken(null);
    setAdmin(null);
  }, []);

  const can = useCallback((p: Permission) => !!admin?.permissions.includes(p), [admin]);
  return <AuthCtx.Provider value={{ admin, ready, login, logout, can }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
