import type { Request, Response } from 'express';
import { z } from 'zod';
import { execute } from '../config/db.js';
import { parse } from '../middleware/validate.js';
import * as auth from '../services/authService.js';
import * as compliance from '../services/complianceService.js';
import * as notifications from '../services/notificationService.js';
import { AppError } from '../utils/errors.js';
import { pageQuery } from '../utils/pagination.js';
import { passwordSchema } from './authController.js';

export async function me(req: Request, res: Response) {
  const u = await auth.getUserById(req.user!.id);
  if (!u) throw new AppError('UNAUTHORIZED', 'User not found');
  res.json({ user: auth.toPublicUser(u) });
}

export async function updateProfile(req: Request, res: Response) {
  const body = parse(z.object({ firstName: z.string().trim().max(100).optional(), lastName: z.string().trim().max(100).optional() }), req.body);
  await execute('UPDATE users SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name) WHERE id = ?', [body.firstName ?? null, body.lastName ?? null, req.user!.id]);
  return me(req, res);
}

export async function acceptTerms(req: Request, res: Response) {
  await auth.acceptTerms(req.user!.id);
  return me(req, res);
}

export async function changePassword(req: Request, res: Response) {
  const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }), req.body);
  await auth.changePassword(req.user!.id, req.user!.sessionId, body.currentPassword, body.newPassword);
  res.json({ ok: true });
}

export async function sessions(req: Request, res: Response) {
  res.json({ items: await auth.listSessions(req.user!.id, req.user!.sessionId) });
}

export async function revokeSession(req: Request, res: Response) {
  await auth.revokeSession(req.user!.id, String(req.params.id));
  res.status(204).end();
}

export async function begin2fa(req: Request, res: Response) {
  res.json(await auth.begin2fa(req.user!.id));
}

export async function enable2fa(req: Request, res: Response) {
  const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  await auth.enable2fa(req.user!.id, code);
  res.json({ ok: true });
}

export async function disable2fa(req: Request, res: Response) {
  const body = parse(z.object({ password: z.string().min(1), code: z.string().regex(/^\d{6}$/) }), req.body);
  await auth.disable2fa(req.user!.id, body.password, body.code);
  res.json({ ok: true });
}

// ───────── Responsible gambling ─────────
const money = z.number().positive().max(100_000_000).nullable().optional();

export async function getLimits(req: Request, res: Response) {
  const l = await compliance.getLimits(req.user!.id);
  res.json({
    maxStake: l.max_stake, maxExposure: l.max_exposure, dailyDepositLimit: l.daily_deposit_limit, weeklyDepositLimit: l.weekly_deposit_limit,
    monthlyDepositLimit: l.monthly_deposit_limit, dailyLossLimit: l.daily_loss_limit, selfExcludedUntil: l.self_excluded_until, coolingOffUntil: l.cooling_off_until,
    pendingChanges: typeof l.pending_changes === 'string' ? JSON.parse(l.pending_changes) : l.pending_changes, pendingEffectiveAt: l.pending_effective_at,
  });
}

export async function setLimits(req: Request, res: Response) {
  const b = parse(z.object({ maxStake: money, maxExposure: money, dailyDepositLimit: money, weeklyDepositLimit: money, monthlyDepositLimit: money, dailyLossLimit: money }), req.body);
  const map = { maxStake: 'max_stake', maxExposure: 'max_exposure', dailyDepositLimit: 'daily_deposit_limit', weeklyDepositLimit: 'weekly_deposit_limit', monthlyDepositLimit: 'monthly_deposit_limit', dailyLossLimit: 'daily_loss_limit' } as const;
  const input: Record<string, number | null> = {};
  for (const [k, col] of Object.entries(map)) if (k in b) input[col] = b[k as keyof typeof b] ?? null;
  const r = await compliance.setUserLimits(req.user!.id, input);
  res.json(r);
}

export async function selfExclude(req: Request, res: Response) {
  const b = parse(z.object({ period: z.enum(['180', '365', '1825', 'PERMANENT']), password: z.string().min(1) }), req.body);
  const u = (await auth.getUserById(req.user!.id))!;
  if (!(await auth.verifyPassword(u.password_hash, b.password))) throw new AppError('INVALID_CREDENTIALS', 'Password is incorrect.');
  const until = await compliance.selfExclude(req.user!.id, b.period === 'PERMANENT' ? 'PERMANENT' : Number(b.period));
  res.json({ selfExcludedUntil: until });
}

export async function coolOff(req: Request, res: Response) {
  const b = parse(z.object({ hours: z.union([z.literal(24), z.literal(72), z.literal(168), z.literal(720)]) }), req.body);
  res.json({ coolingOffUntil: await compliance.coolOff(req.user!.id, b.hours) });
}

// ───────── Notifications ─────────
export async function listNotifications(req: Request, res: Response) {
  res.json(await notifications.listNotifications(req.user!.id, parse(pageQuery, req.query)));
}

export async function readNotifications(req: Request, res: Response) {
  const b = parse(z.object({ ids: z.union([z.array(z.number().int()).max(100), z.literal('all')]) }), req.body);
  await notifications.markRead(req.user!.id, b.ids);
  res.status(204).end();
}
