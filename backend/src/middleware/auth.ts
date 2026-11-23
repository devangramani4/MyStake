import type { NextFunction, Request, Response } from 'express';
import { can, type Permission } from '../services/permissions.js';
import { isSessionActive, verifyAccess } from '../services/tokenService.js';
import { AppError } from '../utils/errors.js';

const bearer = (req: Request) => {
  const h = req.header('authorization');
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
};

/** Customer access token (Authorization: Bearer). */
export function requireUser(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) throw new AppError('UNAUTHORIZED', 'Authentication required');
  const claims = verifyAccess(token, 'user');
  req.user = { id: Number(claims.sub), sessionId: claims.sid };
  next();
}

export function optionalUser(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (token) {
    try {
      const c = verifyAccess(token, 'user');
      req.user = { id: Number(c.sub), sessionId: c.sid };
    } catch {
      /* anonymous */
    }
  }
  next();
}

/** For money-moving or security-sensitive endpoints, confirm the session wasn't revoked since the token was issued. */
export async function requireLiveSession(req: Request, _res: Response, next: NextFunction) {
  if (req.user && !(await isSessionActive('user', req.user.sessionId))) throw new AppError('UNAUTHORIZED', 'Session has been signed out');
  if (req.admin && !(await isSessionActive('admin', req.admin.sessionId))) throw new AppError('UNAUTHORIZED', 'Session has been signed out');
  next();
}

export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) throw new AppError('UNAUTHORIZED', 'Authentication required');
  const claims = verifyAccess(token, 'admin');
  if (claims.role === 'USER') throw new AppError('FORBIDDEN', 'Forbidden');
  req.admin = { id: Number(claims.sub), role: claims.role, sessionId: claims.sid };
  // Admin tokens are short-lived, but revocation is still checked on every request.
  if (!(await isSessionActive('admin', claims.sid))) throw new AppError('UNAUTHORIZED', 'Session has been signed out');
  next();
}

export const requirePermission = (p: Permission) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.admin || !can(req.admin.role, p)) throw new AppError('FORBIDDEN', 'You do not have permission to perform this action');
  next();
};
