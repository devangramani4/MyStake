import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Converts every error into a safe JSON envelope. Internal details are logged, never returned. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ reqId: req.id, code: err.code, msg: err.message }, 'request failed');
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId: req.id } });
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body', requestId: req.id } });
  }
  if (e?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'BAD_REQUEST', message: 'Request body too large', requestId: req.id } });
  }
  logger.error({ reqId: req.id, err }, 'unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId: req.id } });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: req.id } });
}
