import type { PoolConnection } from 'mysql2/promise';
import { execute, query, queryOne, type Db, pool } from '../config/db.js';
import { env } from '../config/env.js';
import type { UserRow } from '../models/types.js';
import { AppError } from '../utils/errors.js';
import { fromCents, toCents } from '../utils/money.js';
import { getSetting } from './settingsService.js';

/**
 * Jurisdiction-agnostic compliance controls. Every control is configurable;
 * nothing here asserts that operating in any particular country is lawful.
 */

export interface UserLimitsRow {
  user_id: number;
  max_stake: string | null;
  max_exposure: string | null;
  daily_deposit_limit: string | null;
  weekly_deposit_limit: string | null;
  monthly_deposit_limit: string | null;
  daily_loss_limit: string | null;
  session_time_limit_min: number | null;
  self_excluded_until: Date | null;
  cooling_off_until: Date | null;
  betting_restricted: number;
  withdrawals_restricted: number;
  pending_changes: Record<string, string | null> | string | null;
  pending_effective_at: Date | null;
  set_by: 'USER' | 'ADMIN';
}

// ───────── Geo restriction ─────────
export function checkCountry(country: string | undefined | null) {
  const c = (country ?? '').toUpperCase();
  if (!c) return; // unknown → rely on KYC address checks
  if (env.GEO_BLOCKED_COUNTRIES.includes(c)) throw new AppError('GEO_RESTRICTED', 'Our services are not available in your region.');
  if (env.GEO_ALLOWED_COUNTRIES.length && !env.GEO_ALLOWED_COUNTRIES.includes(c)) throw new AppError('GEO_RESTRICTED', 'Our services are not available in your region.');
}

// ───────── Age verification ─────────
export function ageFrom(dob: Date, now = new Date()): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export function assertMinimumAge(dob: Date) {
  if (ageFrom(dob) < env.MIN_AGE) throw new AppError('VALIDATION_ERROR', `You must be at least ${env.MIN_AGE} years old to register.`);
}

// ───────── Limits ─────────
export async function getLimits(userId: number, db: Db = pool): Promise<UserLimitsRow> {
  await applyPendingLimitChanges(userId, db);
  const row = await queryOne<UserLimitsRow>('SELECT * FROM user_limits WHERE user_id = ?', [userId], db);
  if (row) return row;
  await execute('INSERT IGNORE INTO user_limits (user_id) VALUES (?)', [userId], db);
  return (await queryOne<UserLimitsRow>('SELECT * FROM user_limits WHERE user_id = ?', [userId], db))!;
}

const LIMIT_FIELDS = ['max_stake', 'max_exposure', 'daily_deposit_limit', 'weekly_deposit_limit', 'monthly_deposit_limit', 'daily_loss_limit'] as const;
type LimitField = (typeof LIMIT_FIELDS)[number];

async function applyPendingLimitChanges(userId: number, db: Db) {
  const row = await queryOne<UserLimitsRow>('SELECT pending_changes, pending_effective_at FROM user_limits WHERE user_id = ?', [userId], db);
  if (!row?.pending_effective_at || row.pending_effective_at > new Date()) return;
  const changes = (typeof row.pending_changes === 'string' ? JSON.parse(row.pending_changes) : row.pending_changes) as Record<string, string | null> | null;
  if (!changes) return;
  const fields = Object.keys(changes).filter((k): k is LimitField => (LIMIT_FIELDS as readonly string[]).includes(k));
  if (fields.length) {
    await execute(
      `UPDATE user_limits SET ${fields.map((f) => `${f} = ?`).join(', ')}, pending_changes = NULL, pending_effective_at = NULL WHERE user_id = ?`,
      [...fields.map((f) => changes[f]), userId],
      db,
    );
  }
}

/**
 * Responsible-gambling rule: reducing a limit (or setting one) applies
 * immediately; raising or removing a limit only applies after a cool-down.
 */
export async function setUserLimits(userId: number, input: Partial<Record<LimitField, number | null>>) {
  const current = await getLimits(userId);
  const immediate: Partial<Record<LimitField, string | null>> = {};
  const delayed: Partial<Record<LimitField, string | null>> = {};
  for (const f of LIMIT_FIELDS) {
    if (!(f in input)) continue;
    const next = input[f] === null || input[f] === undefined ? null : fromCents(toCents(input[f]!));
    const cur = current[f];
    const isLoosening = next === null ? cur !== null : cur !== null && toCents(next) > toCents(cur);
    if (isLoosening) delayed[f] = next;
    else immediate[f] = next;
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(immediate)) { sets.push(`${k} = ?`); params.push(v); }
  if (Object.keys(delayed).length) {
    const { limitIncreaseCooldownHours } = await getSetting('compliance');
    sets.push('pending_changes = ?', 'pending_effective_at = ?');
    params.push(JSON.stringify(delayed), new Date(Date.now() + limitIncreaseCooldownHours * 3600_000));
  }
  if (sets.length) await execute(`UPDATE user_limits SET ${sets.join(', ')}, set_by = 'USER' WHERE user_id = ?`, [...params, userId]);
  return { applied: immediate, pending: delayed };
}

export async function selfExclude(userId: number, days: number | 'PERMANENT') {
  const until = days === 'PERMANENT' ? new Date('9999-12-31T00:00:00Z') : new Date(Date.now() + days * 86_400_000);
  await getLimits(userId);
  await execute('UPDATE user_limits SET self_excluded_until = ? WHERE user_id = ?', [until, userId]);
  await execute(`UPDATE users SET status = 'SELF_EXCLUDED' WHERE id = ?`, [userId]);
  // End all sessions so exclusion takes effect immediately.
  await execute(`UPDATE user_sessions SET revoked_at = NOW(3), revoked_reason = 'SELF_EXCLUSION' WHERE user_id = ? AND revoked_at IS NULL`, [userId]);
  return until;
}

export async function coolOff(userId: number, hours: number) {
  await getLimits(userId);
  const until = new Date(Date.now() + hours * 3600_000);
  await execute('UPDATE user_limits SET cooling_off_until = ? WHERE user_id = ?', [until, userId]);
  return until;
}

// ───────── Gatekeeping ─────────
export function assertAccountActive(user: Pick<UserRow, 'status'>) {
  if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED', 'Your account is suspended. Please contact support.');
  if (user.status === 'SELF_EXCLUDED') throw new AppError('SELF_EXCLUDED', 'Your account is self-excluded.');
  if (user.status === 'CLOSED') throw new AppError('ACCOUNT_SUSPENDED', 'This account is closed.');
}

export async function assertCanBet(user: UserRow, db: Db = pool) {
  assertAccountActive(user);
  if (!user.email_verified_at) throw new AppError('EMAIL_NOT_VERIFIED', 'Please verify your email address before betting.');
  if (user.terms_version !== env.TERMS_VERSION) throw new AppError('TERMS_NOT_ACCEPTED', 'Please accept the latest terms and conditions.');
  const l = await getLimits(user.id, db);
  const now = new Date();
  if (l.self_excluded_until && l.self_excluded_until > now) throw new AppError('SELF_EXCLUDED', 'Your account is self-excluded.');
  if (l.cooling_off_until && l.cooling_off_until > now) throw new AppError('BETTING_RESTRICTED', 'Your account is in a cooling-off period.');
  if (l.betting_restricted) throw new AppError('BETTING_RESTRICTED', 'Betting is restricted on your account. Please contact support.');
  return l;
}

/** Net loss today from settled bets (cents, positive = loss). */
export async function lossToday(userId: number, db: Db = pool): Promise<number> {
  const [r] = await query<{ pnl: string | null }>(
    `SELECT SUM(profit_loss - commission) AS pnl FROM bet_items WHERE user_id = ? AND status = 'SETTLED' AND settled_at >= UTC_DATE()`,
    [userId],
    db,
  );
  return -toCents(r?.pnl);
}

export async function assertDepositWithinLimits(conn: PoolConnection, userId: number, amount: number) {
  const l = await getLimits(userId, conn);
  const windows: Array<[string | null, string]> = [
    [l.daily_deposit_limit, 'INTERVAL 1 DAY'],
    [l.weekly_deposit_limit, 'INTERVAL 7 DAY'],
    [l.monthly_deposit_limit, 'INTERVAL 30 DAY'],
  ];
  for (const [limit, interval] of windows) {
    if (limit === null) continue;
    const [r] = await query<{ total: string | null }>(
      `SELECT SUM(amount) AS total FROM deposits WHERE user_id = ? AND status IN ('PENDING','COMPLETED') AND created_at >= NOW(3) - ${interval}`,
      [userId],
      conn,
    );
    if (toCents(r?.total) + amount > toCents(limit)) throw new AppError('DEPOSIT_LIMIT_EXCEEDED', 'This deposit would exceed your deposit limit.');
  }
}
