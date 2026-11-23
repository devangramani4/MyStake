import type { Request, Response } from 'express';
import { z } from 'zod';
import { idempotencyKey } from '../middleware/idempotency.js';
import { parse } from '../middleware/validate.js';
import { getUserById } from '../services/authService.js';
import * as bets from '../services/betService.js';
import { AppError } from '../utils/errors.js';

const placeSchema = z.object({
  unmatchedPolicy: z.enum(['REJECT', 'KEEP']).default('REJECT'),
  items: z
    .array(
      z.object({
        marketId: z.string().regex(/^\d\.\d{3,12}$/),
        selectionId: z.number().int().positive(),
        side: z.enum(['BACK', 'LAY']),
        price: z.number().min(1.01).max(1000),
        stake: z.number().positive().max(10_000_000),
      }),
    )
    .min(1)
    .max(10),
});

const listSchema = z.object({
  view: z.enum(['open', 'settled', 'all']).default('all'),
  range: z.enum(['today', 'yesterday', '7d', '30d', 'custom', 'all']).default('30d'),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  sport: z.string().max(50).optional(),
  side: z.enum(['BACK', 'LAY']).optional(),
  status: z.enum(['PENDING', 'UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED', 'CANCELLED', 'LAPSED', 'FAILED', 'SETTLED', 'VOIDED']).optional(),
  result: z.enum(['WIN', 'LOSS', 'VOID', 'PARTIAL']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function place(req: Request, res: Response) {
  const key = idempotencyKey(req);
  const body = parse(placeSchema, req.body);
  const user = await getUserById(req.user!.id);
  if (!user) throw new AppError('UNAUTHORIZED', 'User not found');
  const r = await bets.placeBets(user, { idempotencyKey: key, unmatchedPolicy: body.unmatchedPolicy, items: body.items }, req.ip);
  res.status(r.duplicate ? 200 : 201).json(r);
}

export async function list(req: Request, res: Response) {
  res.json(await bets.listBets(req.user!.id, parse(listSchema, req.query)));
}

export async function get(req: Request, res: Response) {
  res.json(await bets.getBetItemView(req.user!.id, String(req.params.id)));
}

export async function cancel(req: Request, res: Response) {
  res.json(await bets.cancelUnmatched(req.user!.id, String(req.params.id)));
}

export async function replace(req: Request, res: Response) {
  const { price } = parse(z.object({ price: z.number().min(1.01).max(1000) }), req.body);
  res.json(await bets.replacePrice(req.user!.id, String(req.params.id), price));
}
