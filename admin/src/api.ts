import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

/** Admin API client. Separate audience, cookie (art) and CSRF cookie (acsrf) from the customer app. */
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '/api', withCredentials: true, timeout: 20_000 });

let token: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onLogout: () => void = () => {};
export const setToken = (t: string | null) => { token = t; };
export const setOnLogout = (fn: () => void) => { onLogout = fn; };

const csrf = () => {
  const m = document.cookie.match(/(?:^|;\s*)acsrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};
export const hasSessionCookie = () => !!csrf();

api.interceptors.request.use((cfg) => {
  if (token) cfg.headers.set('Authorization', `Bearer ${token}`);
  return cfg;
});

export function refresh(): Promise<string | null> {
  refreshing ??= api
    .post('/admin/auth/refresh', null, { headers: { 'X-CSRF-Token': csrf() ?? '' } })
    .then((r) => {
      token = r.data.accessToken;
      return token;
    })
    .catch(() => {
      token = null;
      onLogout();
      return null;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const cfg = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
  if (cfg && !cfg._retried && error.response?.status === 401 && !cfg.url?.includes('/auth/')) {
    cfg._retried = true;
    const t = await refresh();
    if (t) {
      cfg.headers.set('Authorization', `Bearer ${t}`);
      return api(cfg);
    }
  }
  throw error;
});

export const logoutRequest = () => api.post('/admin/auth/logout', null, { headers: { 'X-CSRF-Token': csrf() ?? '' } });

export function errMsg(e: unknown): string {
  const body = (e as AxiosError<{ error?: { message?: string; details?: { fields?: Array<{ path: string; message: string }> } } }>).response?.data?.error;
  if (body?.details?.fields?.length) return body.details.fields.map((f) => `${f.path}: ${f.message}`).join(', ');
  return body?.message ?? 'Request failed';
}

export const idem = () => crypto.randomUUID();

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }
