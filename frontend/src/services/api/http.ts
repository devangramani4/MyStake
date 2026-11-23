import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { config } from '../../config';

/**
 * Axios instance for our own backend only. The access token is held in
 * memory (never localStorage); the refresh token is an httpOnly cookie the
 * browser sends only to /api/auth. On 401 we refresh once (single-flight)
 * and replay the original request.
 */
export const http = axios.create({ baseURL: config.apiUrl, withCredentials: true, timeout: 20_000 });

let accessToken: string | null = null;
let csrfToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onSessionChange: (s: { accessToken: string | null; user?: unknown }) => void = () => {};

export const setAccessToken = (t: string | null) => { accessToken = t; };
export const getAccessToken = () => accessToken;
export const setCsrfToken = (t: string | null) => { csrfToken = t; };
export const onSession = (fn: typeof onSessionChange) => { onSessionChange = fn; };

http.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.set('Authorization', `Bearer ${accessToken}`);
  return cfg;
});

/** Exchange the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<string | null> {
  if (!refreshing) {
    refreshing = axios
      .post(`${config.apiUrl}/auth/refresh`, null, { withCredentials: true, headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {} })
      .then((r) => {
        accessToken = r.data.accessToken;
        csrfToken = r.data.csrfToken;
        onSessionChange({ accessToken, user: r.data.user });
        return accessToken;
      })
      .catch(() => {
        accessToken = null;
        onSessionChange({ accessToken: null });
        return null;
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

http.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
  const code = (error.response?.data as { error?: { code?: string } } | undefined)?.error?.code;
  if (original && !original._retried && error.response?.status === 401 && (code === 'TOKEN_EXPIRED' || code === 'UNAUTHORIZED') && !original.url?.includes('/auth/')) {
    original._retried = true;
    const token = await refreshSession();
    if (token) {
      original.headers.set('Authorization', `Bearer ${token}`);
      return http(original);
    }
  }
  throw error;
});

/** Restore a session on page load from the refresh cookie (csrf cookie is readable by design). */
export function bootstrapCsrfFromCookie(): boolean {
  const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  if (m) csrfToken = decodeURIComponent(m[1]);
  return !!m;
}
