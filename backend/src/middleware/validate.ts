import type { z } from 'zod';
import { AppError } from '../utils/errors.js';

/** Validate untrusted input against a schema. Unknown keys are stripped. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError('VALIDATION_ERROR', 'Some fields are invalid.', {
      fields: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}
