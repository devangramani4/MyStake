import rateLimit, { type Options } from 'express-rate-limit';
import { isTest } from '../config/env.js';
import { AppError } from '../utils/errors.js';

/**
 * In-memory rate limits per instance. For horizontal scaling configure a shared
 * store (e.g. rate-limit-redis) — see README → Scaling.
 */
const make = (windowMs: number, limit: number, keyByUser = false) =>
  rateLimit({
    windowMs,
    limit: isTest ? 10_000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyByUser ? ((req) => (req.user ? `u:${req.user.id}` : `ip:${req.ip}`)) as Options['keyGenerator'] : undefined,
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED', 'Too many requests. Please slow down.')),
  });

export const globalLimiter = make(60_000, 600);
export const authLimiter = make(15 * 60_000, 30);
export const passwordResetLimiter = make(60 * 60_000, 5);
export const betLimiter = make(60_000, 60, true);
export const walletLimiter = make(60_000, 20, true);
export const adminLimiter = make(60_000, 300);
