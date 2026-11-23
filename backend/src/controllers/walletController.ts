import type { Request, Response } from 'express';
import { z } from 'zod';
import { idempotencyKey } from '../middleware/idempotency.js';
import { parse } from '../middleware/validate.js';
import { getUserById } from '../services/authService.js';
import * as payments from '../services/paymentService.js';
import * as wallet from '../services/walletService.js';
import { pageQuery, rangeQuery, resolveRange } from '../utils/pagination.js';

const amount = z.number().positive().max(10_000_000).multipleOf(0.01);

export async function summary(req: Request, res: Response) {
  res.json(await wallet.walletSummary(req.user!.id));
}

export async function transactions(req: Request, res: Response) {
  const q = parse(pageQuery.extend(rangeQuery.shape).extend({ type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'BET', 'WIN', 'LOSS', 'REFUND', 'COMMISSION', 'ADJUSTMENT']).optional() }), req.query);
  const { from, to } = resolveRange(q);
  res.json(await wallet.listTransactions(req.user!.id, { ...q, from, to }));
}

export async function deposit(req: Request, res: Response) {
  const key = idempotencyKey(req);
  const body = parse(z.object({ amount }), req.body);
  const r = await payments.createDeposit((await getUserById(req.user!.id))!, body.amount, key);
  res.status(r.duplicate ? 200 : 201).json(r);
}

export async function deposits(req: Request, res: Response) {
  res.json(await payments.listDeposits(req.user!.id, parse(pageQuery, req.query)));
}

export async function withdraw(req: Request, res: Response) {
  const key = idempotencyKey(req);
  const body = parse(z.object({ amount, method: z.enum(['BANK_TRANSFER', 'UPI', 'E_WALLET']), destination: z.string().trim().max(64).optional() }), req.body);
  // Store only a masked destination; full payout details belong with the PSP.
  const masked = body.destination ? `••••${body.destination.replace(/\s/g, '').slice(-4)}` : undefined;
  const r = await payments.requestWithdrawal((await getUserById(req.user!.id))!, body.amount, body.method, masked, key);
  res.status(r.duplicate ? 200 : 201).json(r);
}

export async function withdrawals(req: Request, res: Response) {
  res.json(await payments.listWithdrawals(req.user!.id, parse(pageQuery, req.query)));
}

export async function cancelWithdrawal(req: Request, res: Response) {
  await payments.cancelWithdrawal(req.user!.id, String(req.params.id));
  res.json({ ok: true });
}
