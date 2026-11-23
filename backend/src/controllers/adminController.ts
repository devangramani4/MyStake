import type { Request, Response } from 'express';
import { z } from 'zod';
import { idempotencyKey } from '../middleware/idempotency.js';
import { clientInfo } from '../middleware/requestContext.js';
import { parse } from '../middleware/validate.js';
import * as admin from '../services/adminService.js';
import { listBets } from '../services/betService.js';
import { syncCatalogue } from '../services/marketService.js';
import { completeDeposit, failDeposit, reviewWithdrawal } from '../services/paymentService.js';
import { getSettings, SETTING_KEYS, updateSetting } from '../services/settingsService.js';
import { audit } from '../services/auditService.js';
import { AppError } from '../utils/errors.js';
import { pageQuery } from '../utils/pagination.js';
import { passwordSchema } from './authController.js';
import { ADMIN_AUTH_PATH, ADMIN_RT, clearRefreshCookie, setRefreshCookie } from './cookies.js';

const id = (req: Request) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw new AppError('BAD_REQUEST', 'Invalid id');
  return n;
};
const reason = z.string().trim().min(3, 'A reason is required').max(500);

// ───────── Auth ─────────
export async function login(req: Request, res: Response) {
  const b = parse(z.object({ email: z.string().trim().email(), password: z.string().min(1).max(128), totpCode: z.string().optional() }), req.body);
  const r = await admin.adminLogin(b.email, b.password, b.totpCode, clientInfo(req));
  const csrfToken = setRefreshCookie(res, ADMIN_RT, ADMIN_AUTH_PATH, r.refreshToken, r.refreshExpiresAt);
  res.json({ admin: r.admin, accessToken: r.accessToken, csrfToken });
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[ADMIN_RT];
  if (!token) throw new AppError('UNAUTHORIZED', 'No session');
  try {
    const r = await admin.adminRefresh(token, clientInfo(req));
    const csrfToken = setRefreshCookie(res, ADMIN_RT, ADMIN_AUTH_PATH, r.refreshToken, r.refreshExpiresAt);
    res.json({ admin: r.admin, accessToken: r.accessToken, csrfToken });
  } catch (err) {
    clearRefreshCookie(res, ADMIN_RT, ADMIN_AUTH_PATH);
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[ADMIN_RT];
  if (token) await admin.adminLogout(token);
  clearRefreshCookie(res, ADMIN_RT, ADMIN_AUTH_PATH);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  res.json({ admin: await admin.getAdmin(req.admin!.id) });
}

// ───────── Dashboard / users ─────────
export async function dashboard(_req: Request, res: Response) {
  res.json(await admin.dashboard());
}

export async function users(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ search: z.string().trim().max(100).optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED', 'SELF_EXCLUDED']).optional(), kyc: z.enum(['NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED']).optional() }), req.query);
  res.json(await admin.listUsers(q));
}

export async function user(req: Request, res: Response) {
  res.json(await admin.getUserDetail(id(req)));
}

export async function setUserStatus(req: Request, res: Response) {
  const b = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']), reason }), req.body);
  await admin.setUserStatus(id(req), b.status, req.admin!.id, b.reason, req.ip);
  res.json({ ok: true });
}

export async function setKyc(req: Request, res: Response) {
  const b = parse(z.object({ kycStatus: z.enum(['NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED']), reason }), req.body);
  await admin.setKycStatus(id(req), b.kycStatus, req.admin!.id, b.reason);
  res.json({ ok: true });
}

const nullableMoney = z.number().positive().nullable().optional();
export async function setRestrictions(req: Request, res: Response) {
  const b = parse(z.object({
    max_stake: nullableMoney, max_exposure: nullableMoney, daily_deposit_limit: nullableMoney, weekly_deposit_limit: nullableMoney,
    monthly_deposit_limit: nullableMoney, daily_loss_limit: nullableMoney, betting_restricted: z.boolean().optional(), withdrawals_restricted: z.boolean().optional(), reason,
  }), req.body);
  const { reason: r, ...rest } = b;
  const input = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 1 : 0) : v === null ? null : (v as number).toFixed(2)]));
  await admin.setUserRestrictions(id(req), input, req.admin!.id, r);
  res.json({ ok: true });
}

export async function adjustWallet(req: Request, res: Response) {
  const key = idempotencyKey(req);
  const b = parse(z.object({ amount: z.number().refine((n) => n !== 0, 'Amount must not be zero').refine((n) => Math.abs(n) <= 10_000_000), reason }), req.body);
  await admin.adjustWallet(id(req), b.amount, b.reason, req.admin!.id, key, req.ip);
  res.json({ ok: true });
}

export async function userTransactions(req: Request, res: Response) {
  res.json(await admin.userTransactions(id(req), parse(pageQuery, req.query)));
}

export async function userBets(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ view: z.enum(['open', 'settled', 'all']).default('all') }), req.query);
  res.json(await listBets(id(req), { ...q, range: 'all' }));
}

// ───────── Bets ─────────
export async function bets(req: Request, res: Response) {
  const q = parse(pageQuery.extend({
    view: z.enum(['open', 'settled', 'all']).default('all'),
    status: z.enum(['PENDING', 'UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED', 'CANCELLED', 'LAPSED', 'FAILED', 'SETTLED', 'VOIDED']).optional(),
    side: z.enum(['BACK', 'LAY']).optional(),
    sport: z.string().max(50).optional(),
    range: z.enum(['today', 'yesterday', '7d', '30d', 'all']).default('all'),
  }), req.query);
  res.json(await listBets(null, q));
}

// ───────── Sports management ─────────
export async function sports(_req: Request, res: Response) {
  res.json({ items: await admin.adminListSports() });
}

export async function events(req: Request, res: Response) {
  res.json(await admin.adminListEvents(parse(pageQuery.extend({ sport: z.string().max(50).optional(), status: z.enum(['UPCOMING', 'IN_PLAY', 'CLOSED', 'SUSPENDED']).optional(), search: z.string().max(100).optional() }), req.query)));
}

export async function eventMarkets(req: Request, res: Response) {
  res.json({ items: await admin.adminEventMarkets(id(req)) });
}

export const setFlag = (entity: 'sports' | 'events' | 'markets' | 'competitions') => async (req: Request, res: Response) => {
  const b = parse(z.object({ field: z.enum(['is_enabled', 'is_featured', 'admin_suspended']), value: z.boolean(), reason: z.string().max(500).optional() }), req.body);
  await admin.updateCatalogueFlag(entity, id(req), b.field, b.value, req.admin!.id, b.reason);
  res.json({ ok: true });
};

export async function settleMarket(req: Request, res: Response) {
  const b = parse(z.object({ winners: z.union([z.array(z.number().int()).min(1), z.literal('VOID')]), reason }), req.body);
  res.json(await admin.manualSettle(id(req), b.winners, req.admin!.id, b.reason));
}

export async function syncNow(req: Request, res: Response) {
  await audit({ actorType: 'ADMIN', actorId: req.admin!.id, action: 'CATALOGUE_SYNC' });
  await syncCatalogue();
  res.json({ ok: true });
}

// ───────── Finance ─────────
export async function transactions(req: Request, res: Response) {
  res.json(await admin.listAllTransactions(parse(pageQuery.extend({ type: z.string().max(20).optional(), search: z.string().max(100).optional() }), req.query)));
}

export const payments = (kind: 'deposits' | 'withdrawals') => async (req: Request, res: Response) => {
  res.json(await admin.listPayments(kind, parse(pageQuery.extend({ status: z.string().max(20).optional() }), req.query)));
};

export async function reviewDeposit(req: Request, res: Response) {
  const b = parse(z.object({ decision: z.enum(['CONFIRM', 'FAIL']), reason }), req.body);
  if (b.decision === 'CONFIRM') await completeDeposit(String(req.params.uuid), { source: 'ADMIN', adminId: req.admin!.id });
  else await failDeposit(String(req.params.uuid), b.reason, req.admin!.id);
  res.json({ ok: true });
}

export async function reviewWithdrawalCtl(req: Request, res: Response) {
  const b = parse(z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().max(255).optional() }), req.body);
  await reviewWithdrawal(String(req.params.uuid), b.decision, req.admin!.id, b.note);
  res.json({ ok: true });
}

// ───────── Risk ─────────
export async function alerts(req: Request, res: Response) {
  res.json(await admin.listAlerts(parse(pageQuery.extend({ status: z.enum(['OPEN', 'REVIEWED', 'DISMISSED']).optional() }), req.query)));
}

export async function reviewAlert(req: Request, res: Response) {
  const b = parse(z.object({ status: z.enum(['REVIEWED', 'DISMISSED']), note: z.string().max(500).optional() }), req.body);
  await admin.reviewAlert(id(req), b.status, req.admin!.id, b.note);
  res.json({ ok: true });
}

export async function exposure(_req: Request, res: Response) {
  res.json({ items: await admin.marketExposure() });
}

export async function settings(_req: Request, res: Response) {
  res.json(await getSettings());
}

export async function updateSettings(req: Request, res: Response) {
  const key = String(req.params.key);
  if (!SETTING_KEYS.includes(key as (typeof SETTING_KEYS)[number])) throw new AppError('NOT_FOUND', 'Unknown setting');
  const value = parse(z.record(z.string(), z.union([z.number(), z.boolean()])), req.body);
  const before = (await getSettings())[key as (typeof SETTING_KEYS)[number]];
  await updateSetting(key as (typeof SETTING_KEYS)[number], { ...before, ...value } as never, req.admin!.id);
  await audit({ actorType: 'ADMIN', actorId: req.admin!.id, action: 'SETTINGS_UPDATED', targetType: 'setting', targetId: key, before, after: value });
  res.json(await getSettings());
}

// ───────── Admin users / audit ─────────
export async function admins(_req: Request, res: Response) {
  res.json({ items: await admin.listAdmins() });
}

const role = z.enum(['SUPER_ADMIN', 'ADMIN', 'RISK_MANAGER', 'SUPPORT']);
export async function createAdmin(req: Request, res: Response) {
  const b = parse(z.object({ email: z.string().email(), name: z.string().min(2).max(100), password: passwordSchema, role }), req.body);
  res.status(201).json({ id: await admin.createAdmin(b, req.admin!.id) });
}

export async function updateAdmin(req: Request, res: Response) {
  const b = parse(z.object({ role: role.optional(), isActive: z.boolean().optional() }), req.body);
  await admin.updateAdmin(id(req), b, req.admin!.id);
  res.json({ ok: true });
}

export async function auditLogs(req: Request, res: Response) {
  res.json(await admin.listAudit(parse(pageQuery.extend({ action: z.string().max(80).optional(), actorType: z.enum(['ADMIN', 'USER', 'SYSTEM']).optional(), targetType: z.string().max(40).optional(), targetId: z.string().max(64).optional() }), req.query)));
}

export async function apiHealth(_req: Request, res: Response) {
  res.json(await admin.apiHealth());
}
