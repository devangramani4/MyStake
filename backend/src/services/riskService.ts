import { execute, query, type Db, pool } from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { fromCents, toCents, type Cents } from '../utils/money.js';
import { lossToday, type UserLimitsRow } from './complianceService.js';
import { getSetting } from './settingsService.js';

/** Pre-trade risk checks. Effective limit = the stricter of user and platform limits. */
export async function assertWithinRisk(params: {
  userId: number;
  limits: UserLimitsRow;
  stakes: Array<{ stake: Cents; price: number }>;
  newLiability: Cents;
  currentExposure: Cents;
  db?: Db;
}) {
  const d = await getSetting('risk.defaults');
  const maxStake = Math.min(toCents(d.maxStake), params.limits.max_stake ? toCents(params.limits.max_stake) : Infinity);
  const maxExposure = Math.min(toCents(d.maxExposure), params.limits.max_exposure ? toCents(params.limits.max_exposure) : Infinity);
  for (const s of params.stakes) {
    if (s.stake < toCents(d.minStake)) throw new AppError('INVALID_STAKE', `Minimum stake is ${fromCents(toCents(d.minStake))}`, { minStake: d.minStake });
    if (s.stake > maxStake) throw new AppError('LIMIT_EXCEEDED', `Maximum stake is ${fromCents(maxStake)}`, { maxStake: fromCents(maxStake) });
    if (s.price > d.maxOdds) throw new AppError('INVALID_PRICE', `Maximum odds are ${d.maxOdds}`);
  }
  if (params.currentExposure + params.newLiability > maxExposure) {
    throw new AppError('EXPOSURE_LIMIT_EXCEEDED', `This bet would exceed your maximum exposure of ${fromCents(maxExposure)}`);
  }
  if (params.limits.daily_loss_limit !== null) {
    const loss = await lossToday(params.userId, params.db ?? pool);
    if (loss + params.newLiability > toCents(params.limits.daily_loss_limit)) {
      throw new AppError('LIMIT_EXCEEDED', 'This bet could exceed your daily loss limit.');
    }
  }
}

export async function raiseAlert(userId: number, rule: string, severity: 'LOW' | 'MEDIUM' | 'HIGH', details: Record<string, unknown>, db: Db = pool) {
  // De-duplicate: one open alert per rule per user per hour.
  const recent = await query('SELECT id FROM risk_alerts WHERE user_id = ? AND rule = ? AND status = ? AND created_at > NOW(3) - INTERVAL 1 HOUR', [userId, rule, 'OPEN'], db);
  if (recent.length) return;
  await execute('INSERT INTO risk_alerts (user_id, rule, severity, details) VALUES (?,?,?,?)', [userId, rule, severity, JSON.stringify(details)], db);
  logger.warn({ risk: { userId, rule, severity } }, 'risk alert raised');
}

/** Post-trade suspicious-activity rules. Runs async; never blocks bet placement. */
export async function evaluateBetActivity(userId: number, stake: Cents) {
  try {
    const cfg = await getSetting('risk.alerts');
    const [avg] = await query<{ avg_stake: string | null; n: number }>(
      `SELECT AVG(stake) AS avg_stake, COUNT(*) AS n FROM bet_items WHERE user_id = ? AND placed_at > NOW(3) - INTERVAL 30 DAY`,
      [userId],
    );
    if (Number(avg.n) >= 5 && stake > toCents(avg.avg_stake) * cfg.largeStakeMultiplier) {
      await raiseAlert(userId, 'LARGE_STAKE', 'MEDIUM', { stake: fromCents(stake), avgStake: avg.avg_stake });
    }
    const [rapid] = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM bet_items WHERE user_id = ? AND placed_at > NOW(3) - INTERVAL 1 MINUTE`, [userId]);
    if (Number(rapid.n) > cfg.rapidBetsPerMinute) await raiseAlert(userId, 'RAPID_BETTING', 'MEDIUM', { betsLastMinute: Number(rapid.n) });
    const [failed] = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM bet_items WHERE user_id = ? AND status = 'FAILED' AND placed_at > NOW(3) - INTERVAL 1 HOUR`, [userId]);
    if (Number(failed.n) > cfg.failedBetsPerHour) await raiseAlert(userId, 'MANY_FAILED_BETS', 'LOW', { failedLastHour: Number(failed.n) });
  } catch (err) {
    logger.error({ err }, 'risk evaluation failed');
  }
}
