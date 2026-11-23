import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { randomToken, safeEqual } from '../utils/crypto.js';

/**
 * CSRF protection for the only cookie-authenticated endpoints (refresh/logout).
 * Double-submit token: a readable `csrf` cookie must be echoed in X-CSRF-Token,
 * plus an Origin allow-list check. API calls authenticated by the
 * Authorization header are not CSRF-able and don't need this.
 */
export const USER_CSRF_COOKIE = 'csrf';
export const ADMIN_CSRF_COOKIE = 'acsrf';

/** The CSRF cookie is intentionally readable by page scripts (path '/'); it is useless without the httpOnly refresh cookie. */
export function issueCsrf(res: Response, name: string) {
  const token = randomToken(24);
  res.cookie(name, token, { httpOnly: false, secure: env.COOKIE_SECURE, sameSite: 'strict', path: '/', domain: env.COOKIE_DOMAIN });
  return token;
}

const allowedOrigins = new Set(env.CORS_ORIGINS.split(',').map((s) => s.trim()));

export const verifyCsrf = (cookieName: string) => (req: Request, _res: Response, next: NextFunction) => {
  const origin = req.header('origin');
  if (origin && !allowedOrigins.has(origin)) throw new AppError('CSRF_FAILED', 'Request origin not allowed');
  const cookie = req.cookies?.[cookieName];
  const header = req.header('x-csrf-token');
  if (!cookie || !header || !safeEqual(cookie, header)) throw new AppError('CSRF_FAILED', 'Invalid CSRF token');
  next();
};
