import type { Request } from 'express';
import { AppError } from '../utils/errors.js';

/**
 * Money-moving endpoints require an Idempotency-Key header (client-generated
 * UUID per user intent). Services persist it with a UNIQUE constraint, so
 * retries and double-clicks return the original result instead of repeating.
 */
export function idempotencyKey(req: Request): string {
  const key = req.header('idempotency-key');
  if (!key || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw new AppError('VALIDATION_ERROR', 'A valid Idempotency-Key header is required.');
  return key;
}
