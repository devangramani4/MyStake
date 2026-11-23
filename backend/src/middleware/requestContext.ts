import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
    country?: string;
    user?: { id: number; sessionId: number };
    admin?: { id: number; role: import('../models/types.js').AdminRole; sessionId: number };
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  req.country = req.header(env.GEO_COUNTRY_HEADER)?.toUpperCase();
  next();
}

export const clientInfo = (req: Request) => ({ ip: req.ip, userAgent: req.header('user-agent'), country: req.country });
