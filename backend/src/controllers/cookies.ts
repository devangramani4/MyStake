import type { Response } from 'express';
import { env } from '../config/env.js';
import { ADMIN_CSRF_COOKIE, issueCsrf, USER_CSRF_COOKIE } from '../middleware/csrf.js';

export const USER_RT = 'rt';
export const ADMIN_RT = 'art';
export const USER_AUTH_PATH = '/api/auth';
export const ADMIN_AUTH_PATH = '/api/admin/auth';

/** Refresh tokens live only in httpOnly, SameSite=Strict cookies scoped to the auth path. */
export function setRefreshCookie(res: Response, name: string, path: string, token: string, expires: Date) {
  res.cookie(name, token, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path, expires, domain: env.COOKIE_DOMAIN });
  return issueCsrf(res, name === ADMIN_RT ? ADMIN_CSRF_COOKIE : USER_CSRF_COOKIE);
}

export function clearRefreshCookie(res: Response, name: string, path: string) {
  res.clearCookie(name, { path, domain: env.COOKIE_DOMAIN });
  res.clearCookie(name === ADMIN_RT ? ADMIN_CSRF_COOKIE : USER_CSRF_COOKIE, { path: '/', domain: env.COOKIE_DOMAIN });
}
