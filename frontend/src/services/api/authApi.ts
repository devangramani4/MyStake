import type { User } from '../../types';
import { http, setAccessToken, setCsrfToken } from './http';

export interface SessionResponse { user: User; accessToken: string; csrfToken: string }

const adopt = (r: SessionResponse) => {
  setAccessToken(r.accessToken);
  setCsrfToken(r.csrfToken);
  return r;
};

export const authApi = {
  login: (identifier: string, password: string, totpCode?: string) => http.post<SessionResponse>('/auth/login', { identifier, password, totpCode }).then((r) => adopt(r.data)),
  register: (body: Record<string, unknown>) => http.post<SessionResponse>('/auth/register', body).then((r) => adopt(r.data)),
  logout: (csrf: string | null) => http.post('/auth/logout', null, { headers: csrf ? { 'X-CSRF-Token': csrf } : {} }),
  forgotPassword: (email: string) => http.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => http.post('/auth/reset-password', { token, password }),
  verifyEmail: (token: string) => http.post('/auth/verify-email', { token }),
  resendVerification: () => http.post('/auth/resend-verification'),
  me: () => http.get<{ user: User }>('/me').then((r) => r.data.user),
};
