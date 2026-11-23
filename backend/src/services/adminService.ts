import { randomUUID } from 'node:crypto';
import { execute, query, queryOne, withTransaction } from '../config/db.js';
import { getBetfair } from '../integrations/betfair/index.js';
import type { AdminRole, AdminRow, UserRow } from '../models/types.js';
import { AppError, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { fromCents, toCents } from '../utils/money.js';
import { offset, toPage, type PageQuery } from '../utils/pagination.js';
import { audit } from './auditService.js';
import { hashPassword, toPublicUser, verifyPassword } from './authService.js';
import { odds } from './oddsService.js';
import { permissionsFor } from './permissions.js';
import { settleMarket } from './settlementService.js';
import { createSession, revokeByToken, rotateSession, signAccess, type ClientInfo } from './tokenService.js';
import { verifyTotp } from './totpService.js';
import { applyLedger, publishWallet, walletView, getWallet } from './walletService.js';
import { getLimits } from './complianceService.js';

// ───────── Admin authentication ─────────
const adminView = (a: AdminRow) => ({ id: a.id, email: a.email, name: a.name, role: a.role, twoFactorEnabled: !!a.totp_enabled, permissions: permissionsFor(a.role) });

export async function adminLogin(email: string, password: string, totpCode: string | undefined, client: ClientInfo) {
  const a = await queryOne<AdminRow>('SELECT * FROM admin_users WHERE email = ?', [email.toLowerCase()]);
  if (!a) {
    await hashPassword(password);
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  if (a.locked_until && a.locked_until > new Date()) throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
  if (!(await verifyPassword(a.password_hash, password))) {
    const failed = a.failed_logins + 1;
    await execute('UPDATE admin_users SET failed_logins = ?, locked_until = ? WHERE id = ?', [failed >= 5 ? 0 : failed, failed >= 5 ? new Date(Date.now() + 30 * 60_000) : null, a.id]);
    await audit({ actorType: 'ADMIN', actorId: a.id, action: 'ADMIN_LOGIN_FAILED', ip: client.ip });
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  if (!a.is_active) throw new AppError('ACCOUNT_SUSPENDED', 'This admin account is disabled.');
  if (a.totp_enabled) {
    if (!totpCode) throw new AppError('TWO_FACTOR_REQUIRED', 'Enter your authentication code.');
    if (!(await verifyTotp(a.totp_secret_enc!, totpCode))) throw new AppError('INVALID_2FA_CODE', 'Invalid authentication code.');
  }
  await execute('UPDATE admin_users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW(3) WHERE id = ?', [a.id]);
  await audit({ actorType: 'ADMIN', actorId: a.id, action: 'ADMIN_LOGIN', ip: client.ip });
  const s = await createSession('admin', a.id, client);
  return { admin: adminView(a), accessToken: signAccess(a.id, a.role, s.sessionId, 'admin'), refreshToken: s.token, refreshExpiresAt: s.expiresAt };
}

export async function adminRefresh(token: string, client: ClientInfo) {
  const r = await rotateSession('admin', token, client);
  const a = await queryOne<AdminRow>('SELECT * FROM admin_users WHERE id = ?', [r.ownerId]);
  if (!a || !a.is_active) throw new AppError('UNAUTHORIZED', 'Session no longer valid');
  return { admin: adminView(a), accessToken: signAccess(a.id, a.role, r.sessionId, 'admin'), refreshToken: r.token, refreshExpiresAt: r.expiresAt };
}

export const adminLogout = (token: string) => revokeByToken('admin', token);

export async function getAdmin(id: number) {
  const a = await queryOne<AdminRow>('SELECT * FROM admin_users WHERE id = ?', [id]);
  if (!a) throw notFound('Admin');
  return adminView(a);
}

// ───────── Dashboard ─────────
export async function dashboard() {
  const one = async <T>(sql: string) => (await query<T>(sql))[0];
  const [users, bets, money, deposits, withdrawals, alerts] = await Promise.all([
    one<{ total: number; active30: number; new24: number }>(`SELECT COUNT(*) AS total,
        SUM(last_login_at > NOW(3) - INTERVAL 30 DAY) AS active30, SUM(created_at > NOW(3) - INTERVAL 1 DAY) AS new24 FROM users`),
    one<{ total: number; open: number; settled: number; failed: number; pending: number }>(`SELECT COUNT(*) AS total,
        SUM(status IN ('UNMATCHED','PARTIALLY_MATCHED','MATCHED')) AS open, SUM(status IN ('SETTLED','VOIDED')) AS settled,
        SUM(status = 'FAILED') AS failed, SUM(status = 'PENDING') AS pending FROM bet_items`),
    one<{ stakes: string | null; pnl: string | null; commission: string | null }>(`SELECT SUM(stake) AS stakes,
        SUM(CASE WHEN status = 'SETTLED' THEN profit_loss ELSE 0 END) AS pnl, SUM(commission) AS commission FROM bet_items`),
    one<{ total: string | null; n: number; pending: number }>(`SELECT SUM(CASE WHEN status='COMPLETED' THEN amount END) AS total, COUNT(*) AS n, SUM(status='PENDING') AS pending FROM deposits`),
    one<{ total: string | null; n: number; pending: number }>(`SELECT SUM(CASE WHEN status IN ('APPROVED','PROCESSING','COMPLETED') THEN amount END) AS total, COUNT(*) AS n, SUM(status='PENDING') AS pending FROM withdrawals`),
    one<{ open: number }>(`SELECT COUNT(*) AS open FROM risk_alerts WHERE status = 'OPEN'`),
  ]);
  const daily = await query<{ day: string; stakes: string; bets: number; commission: string; customer_pnl: string }>(
    `SELECT DATE_FORMAT(placed_at, '%Y-%m-%d') AS day, SUM(stake) AS stakes, COUNT(*) AS bets, SUM(commission) AS commission,
            SUM(CASE WHEN status='SETTLED' THEN profit_loss ELSE 0 END) AS customer_pnl
       FROM bet_items WHERE placed_at > NOW(3) - INTERVAL 14 DAY GROUP BY day ORDER BY day`,
  );
  const bySport = await query<{ sport: string; stakes: string; bets: number }>(
    `SELECT s.name AS sport, SUM(bi.stake) AS stakes, COUNT(*) AS bets FROM bet_items bi JOIN markets m ON m.id = bi.market_id
       JOIN events e ON e.id = m.event_id JOIN sports s ON s.id = e.sport_id WHERE bi.placed_at > NOW(3) - INTERVAL 30 DAY GROUP BY s.id ORDER BY stakes DESC LIMIT 8`,
  );
  const { client } = await getBetfair();
  const apiErrors = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM api_logs WHERE status <> 'OK' AND created_at > NOW(3) - INTERVAL 1 HOUR`);
  // Platform revenue on an exchange = commission collected (customer P&L is matched against the exchange, not the house).
  return {
    users: { total: Number(users.total), active30d: Number(users.active30 ?? 0), new24h: Number(users.new24 ?? 0) },
    bets: { total: Number(bets.total), open: Number(bets.open ?? 0), settled: Number(bets.settled ?? 0), failed: Number(bets.failed ?? 0), pending: Number(bets.pending ?? 0) },
    totals: { stakes: fromCents(toCents(money.stakes)), customerProfitLoss: fromCents(toCents(money.pnl)), revenue: fromCents(toCents(money.commission)) },
    deposits: { total: fromCents(toCents(deposits.total)), count: Number(deposits.n), pending: Number(deposits.pending ?? 0) },
    withdrawals: { total: fromCents(toCents(withdrawals.total)), count: Number(withdrawals.n), pending: Number(withdrawals.pending ?? 0) },
    openRiskAlerts: Number(alerts.open),
    apiStatus: { ...client.status(), streamConnected: odds.isStreamConnected() || client.status().streamConnected, errorsLastHour: Number(apiErrors.n) },
    daily: daily.map((d) => ({ day: d.day, stakes: Number(d.stakes), bets: Number(d.bets), revenue: Number(d.commission), customerPnl: Number(d.customer_pnl) })),
    bySport: bySport.map((s) => ({ sport: s.sport, stakes: Number(s.stakes), bets: Number(s.bets) })),
  };
}

// ───────── Users ─────────
export async function listUsers(q: PageQuery & { search?: string; status?: string; kyc?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.search) {
    where.push('(u.email LIKE ? OR u.username LIKE ? OR u.uuid = ? OR CONCAT_WS(" ", u.first_name, u.last_name) LIKE ?)');
    const like = `%${q.search.replace(/[%_]/g, '\\$&')}%`;
    params.push(like, like, q.search, like);
  }
  if (q.status) { where.push('u.status = ?'); params.push(q.status); }
  if (q.kyc) { where.push('u.kyc_status = ?'); params.push(q.kyc); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query<{ total: number }>(`SELECT COUNT(*) AS total FROM users u ${w}`, params);
  const rows = await query(
    `SELECT u.id, u.uuid, u.email, u.username, u.status, u.kyc_status AS kycStatus, u.country_code AS country, u.created_at AS createdAt,
            u.last_login_at AS lastLoginAt, w.balance, w.exposure, (u.email_verified_at IS NOT NULL) AS emailVerified
       FROM users u JOIN user_wallets w ON w.user_id = u.id ${w} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
    [...params, q.pageSize, offset(q)],
  );
  return toPage(rows, Number(total), q);
}

export async function getUserDetail(userId: number) {
  const u = await queryOne<UserRow>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!u) throw notFound('User');
  const [stats] = await query<{ bets: number; stakes: string | null; pnl: string | null }>(
    `SELECT COUNT(*) AS bets, SUM(stake) AS stakes, SUM(CASE WHEN status='SETTLED' THEN profit_loss - commission ELSE 0 END) AS pnl FROM bet_items WHERE user_id = ?`,
    [userId],
  );
  const limits = await getLimits(userId);
  return {
    internalId: u.id,
    ...toPublicUser(u),
    dateOfBirth: u.date_of_birth,
    country: u.country_code,
    lastLoginAt: u.last_login_at,
    failedLogins: u.failed_logins,
    wallet: walletView(await getWallet(userId)),
    stats: { bets: Number(stats.bets), stakes: fromCents(toCents(stats.stakes)), profitLoss: fromCents(toCents(stats.pnl)) },
    limits,
    alerts: await query('SELECT id, rule, severity, status, details, created_at AS createdAt FROM risk_alerts WHERE user_id = ? ORDER BY id DESC LIMIT 20', [userId]),
  };
}

export async function setUserStatus(userId: number, status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED', adminId: number, reason: string, ip?: string) {
  await withTransaction(async (conn) => {
    const u = await queryOne<{ status: string }>('SELECT status FROM users WHERE id = ? FOR UPDATE', [userId], conn);
    if (!u) throw notFound('User');
    if (u.status === 'SELF_EXCLUDED' && status === 'ACTIVE') {
      const l = await queryOne<{ self_excluded_until: Date | null }>('SELECT self_excluded_until FROM user_limits WHERE user_id = ?', [userId], conn);
      if (l?.self_excluded_until && l.self_excluded_until > new Date()) throw new AppError('CONFLICT', 'User is self-excluded until ' + l.self_excluded_until.toISOString());
    }
    await execute('UPDATE users SET status = ? WHERE id = ?', [status, userId], conn);
    if (status !== 'ACTIVE') await execute(`UPDATE user_sessions SET revoked_at = NOW(3), revoked_reason = 'ADMIN_${status}' WHERE user_id = ? AND revoked_at IS NULL`, [userId], conn);
    await audit({ actorType: 'ADMIN', actorId: adminId, action: `USER_${status}`, targetType: 'user', targetId: userId, before: { status: u.status }, after: { status }, reason, ip }, conn);
  });
}

export async function setKycStatus(userId: number, kyc: 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED', adminId: number, reason: string) {
  const before = await queryOne<{ kyc_status: string }>('SELECT kyc_status FROM users WHERE id = ?', [userId]);
  if (!before) throw notFound('User');
  await execute('UPDATE users SET kyc_status = ?, age_verified = IF(? = "VERIFIED", 1, age_verified) WHERE id = ?', [kyc, kyc, userId]);
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'USER_KYC_UPDATED', targetType: 'user', targetId: userId, before, after: { kyc_status: kyc }, reason });
}

/** Admin-set limits/restrictions apply immediately and are fully audited. */
export async function setUserRestrictions(userId: number, input: Record<string, unknown>, adminId: number, reason: string) {
  const before = await getLimits(userId);
  const allowed = ['max_stake', 'max_exposure', 'daily_deposit_limit', 'weekly_deposit_limit', 'monthly_deposit_limit', 'daily_loss_limit', 'betting_restricted', 'withdrawals_restricted'];
  const fields = Object.keys(input).filter((k) => allowed.includes(k));
  if (!fields.length) return;
  await execute(`UPDATE user_limits SET ${fields.map((f) => `${f} = ?`).join(', ')}, set_by = 'ADMIN' WHERE user_id = ?`, [...fields.map((f) => input[f]), userId]);
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'USER_LIMITS_UPDATED', targetType: 'user', targetId: userId, before: Object.fromEntries(fields.map((f) => [f, (before as unknown as Record<string, unknown>)[f]])), after: input, reason });
}

/** Manual wallet adjustment — always double-entry in the ledger and audited with a reason. */
export async function adjustWallet(userId: number, amount: number, reason: string, adminId: number, idempotencyKey: string, ip?: string) {
  const cents = toCents(amount);
  if (cents === 0) throw new AppError('VALIDATION_ERROR', 'Amount must not be zero');
  await withTransaction(async (conn) => {
    const r = await applyLedger(conn, { userId, type: 'ADJUSTMENT', amount: cents, idempotencyKey: `adjust:${adminId}:${idempotencyKey}`, referenceType: 'admin', referenceId: adminId, description: reason.slice(0, 255), adminId });
    if (!r.duplicate) await audit({ actorType: 'ADMIN', actorId: adminId, action: 'WALLET_ADJUSTMENT', targetType: 'user', targetId: userId, after: { amount: fromCents(cents), balanceAfter: r.wallet.balance }, reason, ip }, conn);
  });
  await publishWallet(userId);
}

export async function userTransactions(userId: number, q: PageQuery) {
  const [{ total }] = await query<{ total: number }>('SELECT COUNT(*) AS total FROM wallet_transactions WHERE user_id = ?', [userId]);
  const rows = await query(
    `SELECT wt.uuid AS id, wt.type, wt.amount, wt.exposure_change AS exposureChange, wt.balance_after AS balanceAfter, wt.exposure_after AS exposureAfter,
            wt.reference_type AS referenceType, wt.reference_id AS referenceId, wt.description, wt.created_by_admin AS adminId, wt.created_at AS createdAt
       FROM wallet_transactions wt WHERE wt.user_id = ? ORDER BY wt.id DESC LIMIT ? OFFSET ?`,
    [userId, q.pageSize, offset(q)],
  );
  return toPage(rows, Number(total), q);
}

// ───────── Finance ─────────
export async function listAllTransactions(q: PageQuery & { type?: string; search?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.type) { where.push('wt.type = ?'); params.push(q.type); }
  if (q.search) { where.push('(u.email LIKE ? OR u.username LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query<{ total: number }>(`SELECT COUNT(*) AS total FROM wallet_transactions wt JOIN users u ON u.id = wt.user_id ${w}`, params);
  const rows = await query(
    `SELECT wt.uuid AS id, u.id AS userId, u.username, wt.type, wt.amount, wt.exposure_change AS exposureChange, wt.balance_after AS balanceAfter,
            wt.description, wt.created_by_admin AS adminId, wt.created_at AS createdAt
       FROM wallet_transactions wt JOIN users u ON u.id = wt.user_id ${w} ORDER BY wt.id DESC LIMIT ? OFFSET ?`,
    [...params, q.pageSize, offset(q)],
  );
  return toPage(rows, Number(total), q);
}

export async function listPayments(kind: 'deposits' | 'withdrawals', q: PageQuery & { status?: string }) {
  const where = q.status ? 'WHERE p.status = ?' : '';
  const params = q.status ? [q.status] : [];
  const [{ total }] = await query<{ total: number }>(`SELECT COUNT(*) AS total FROM ${kind} p ${where}`, params);
  const rows = await query(
    `SELECT p.*, p.uuid AS id, u.id AS userId, u.username, u.kyc_status AS kycStatus FROM ${kind} p JOIN users u ON u.id = p.user_id ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    [...params, q.pageSize, offset(q)],
  );
  return toPage(rows, Number(total), q);
}

// ───────── Sports / markets management ─────────
export async function adminListSports() {
  return query('SELECT id, betfair_id AS betfairId, name, slug, is_enabled AS isEnabled, display_order AS displayOrder, market_count AS marketCount FROM sports ORDER BY display_order');
}

export async function adminListEvents(q: PageQuery & { sport?: string; status?: string; search?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.sport) { where.push('s.slug = ?'); params.push(q.sport); }
  if (q.status) { where.push('e.status = ?'); params.push(q.status); }
  if (q.search) { where.push('e.name LIKE ?'); params.push(`%${q.search}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query<{ total: number }>(`SELECT COUNT(*) AS total FROM events e JOIN sports s ON s.id = e.sport_id ${w}`, params);
  const rows = await query(
    `SELECT e.id, e.betfair_id AS betfairId, e.name, e.open_date AS openDate, e.status, e.is_enabled AS isEnabled, e.is_featured AS isFeatured,
            s.name AS sport, c.name AS competition,
            (SELECT COUNT(*) FROM markets m WHERE m.event_id = e.id) AS markets,
            (SELECT COUNT(*) FROM bet_items bi JOIN markets m ON m.id = bi.market_id WHERE m.event_id = e.id) AS bets
       FROM events e JOIN sports s ON s.id = e.sport_id LEFT JOIN competitions c ON c.id = e.competition_id ${w}
      ORDER BY (e.status = 'IN_PLAY') DESC, e.open_date DESC LIMIT ? OFFSET ?`,
    [...params, q.pageSize, offset(q)],
  );
  return toPage(rows, Number(total), q);
}

export async function adminEventMarkets(eventId: number) {
  const markets = await query<{ id: number; betfair_id: string }>(
    `SELECT m.id, m.betfair_id AS betfairId, m.betfair_id, m.name, m.market_type AS marketType, m.status, m.in_play AS inPlay, m.admin_suspended AS adminSuspended,
            m.is_enabled AS isEnabled, m.settled_at AS settledAt, m.total_matched AS totalMatched,
            (SELECT COUNT(*) FROM bet_items bi WHERE bi.market_id = m.id) AS bets,
            (SELECT COALESCE(SUM(bi.liability),0) FROM bet_items bi WHERE bi.market_id = m.id AND bi.status IN ('UNMATCHED','PARTIALLY_MATCHED','MATCHED')) AS openLiability
       FROM markets m WHERE m.event_id = ? ORDER BY m.id`,
    [eventId],
  );
  const runners = markets.length ? await query<{ market_id: number }>('SELECT market_id, selection_id AS selectionId, name, status FROM market_runners WHERE market_id IN (?) ORDER BY sort_priority', [markets.map((m) => m.id)]) : [];
  return markets.map((m) => ({ ...m, runners: runners.filter((r) => r.market_id === m.id) }));
}

export async function updateCatalogueFlag(entity: 'sports' | 'events' | 'markets' | 'competitions', id: number, field: 'is_enabled' | 'is_featured' | 'admin_suspended', value: boolean, adminId: number, reason?: string) {
  const valid: Record<string, string[]> = { sports: ['is_enabled'], competitions: ['is_enabled'], events: ['is_enabled', 'is_featured'], markets: ['is_enabled', 'admin_suspended'] };
  if (!valid[entity].includes(field)) throw new AppError('BAD_REQUEST', 'Invalid field');
  const res = await execute(`UPDATE ${entity} SET ${field} = ? WHERE id = ?`, [value ? 1 : 0, id]);
  if (!res.affectedRows) throw notFound();
  if (entity === 'markets' && field === 'admin_suspended') {
    const m = await queryOne<{ betfair_id: string }>('SELECT betfair_id FROM markets WHERE id = ?', [id]);
    if (m) odds.setAdminSuspended(m.betfair_id, value);
  }
  await audit({ actorType: 'ADMIN', actorId: adminId, action: `${entity.toUpperCase()}_${field.toUpperCase()}`, targetType: entity, targetId: id, after: { [field]: value }, reason });
}

export async function manualSettle(marketDbId: number, winners: number[] | 'VOID', adminId: number, reason: string) {
  const m = await queryOne<{ betfair_id: string }>('SELECT betfair_id FROM markets WHERE id = ?', [marketDbId]);
  if (!m) throw notFound('Market');
  if (winners === 'VOID') return settleMarket(m.betfair_id, { type: 'VOID' }, { source: 'MANUAL', adminId, reason });
  const runners = await query<{ selection_id: number }>('SELECT selection_id FROM market_runners WHERE market_id = ?', [marketDbId]);
  const map = new Map(runners.map((r) => [Number(r.selection_id), winners.includes(Number(r.selection_id)) ? ('WINNER' as const) : ('LOSER' as const)]));
  return settleMarket(m.betfair_id, { type: 'RESULT', runners: map }, { source: 'MANUAL', adminId, reason });
}

// ───────── Risk ─────────
export async function listAlerts(q: PageQuery & { status?: string }) {
  const where = q.status ? 'WHERE a.status = ?' : '';
  const params = q.status ? [q.status] : [];
  const [{ total }] = await query<{ total: number }>(`SELECT COUNT(*) AS total FROM risk_alerts a ${where}`, params);
  const rows = await query(
    `SELECT a.id, a.user_id AS userId, u.username, a.rule, a.severity, a.details, a.status, a.created_at AS createdAt
       FROM risk_alerts a JOIN users u ON u.id = a.user_id ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    [...params, q.pageSize, offset(q)],
  );
  return toPage(rows, Number(total), q);
}

export async function reviewAlert(id: number, status: 'REVIEWED' | 'DISMISSED', adminId: number, note?: string) {
  await execute('UPDATE risk_alerts SET status = ?, reviewed_by = ? WHERE id = ?', [status, adminId, id]);
  await audit({ actorType: 'ADMIN', actorId: adminId, action: `RISK_ALERT_${status}`, targetType: 'risk_alert', targetId: id, reason: note });
}

export async function marketExposure() {
  return query(
    `SELECT m.betfair_id AS marketId, m.name AS marketName, e.name AS eventName, COUNT(*) AS bets,
            SUM(bi.liability) AS liability, SUM(bi.stake) AS stakes, SUM(bi.side='BACK') AS backs, SUM(bi.side='LAY') AS lays
       FROM bet_items bi JOIN markets m ON m.id = bi.market_id JOIN events e ON e.id = m.event_id
      WHERE bi.status IN ('UNMATCHED','PARTIALLY_MATCHED','MATCHED') GROUP BY m.id ORDER BY liability DESC LIMIT 25`,
  );
}

// ───────── Admin users / audit / api logs ─────────
export async function listAdmins() {
  return query('SELECT id, email, name, role, is_active AS isActive, totp_enabled AS twoFactorEnabled, last_login_at AS lastLoginAt, created_at AS createdAt FROM admin_users ORDER BY id');
}

export async function createAdmin(input: { email: string; name: string; password: string; role: AdminRole }, actorId: number) {
  const res = await execute('INSERT INTO admin_users (email, name, password_hash, role) VALUES (?,?,?,?)', [input.email.toLowerCase(), input.name, await hashPassword(input.password), input.role]);
  await audit({ actorType: 'ADMIN', actorId, action: 'ADMIN_CREATED', targetType: 'admin', targetId: res.insertId, after: { email: input.email, role: input.role } });
  return res.insertId;
}

export async function updateAdmin(id: number, input: { role?: AdminRole; isActive?: boolean }, actorId: number) {
  if (id === actorId) throw new AppError('BAD_REQUEST', 'You cannot change your own role or status.');
  const before = await queryOne('SELECT role, is_active FROM admin_users WHERE id = ?', [id]);
  if (!before) throw notFound('Admin');
  if (input.role) await execute('UPDATE admin_users SET role = ? WHERE id = ?', [input.role, id]);
  if (input.isActive !== undefined) {
    await execute('UPDATE admin_users SET is_active = ? WHERE id = ?', [input.isActive ? 1 : 0, id]);
    if (!input.isActive) await execute(`UPDATE admin_sessions SET revoked_at = NOW(3), revoked_reason = 'DISABLED' WHERE admin_id = ? AND revoked_at IS NULL`, [id]);
  }
  await audit({ actorType: 'ADMIN', actorId, action: 'ADMIN_UPDATED', targetType: 'admin', targetId: id, before, after: input });
}

export async function listAudit(q: PageQuery & { action?: string; actorType?: string; targetType?: string; targetId?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.action) { where.push('action = ?'); params.push(q.action); }
  if (q.actorType) { where.push('actor_type = ?'); params.push(q.actorType); }
  if (q.targetType) { where.push('target_type = ?'); params.push(q.targetType); }
  if (q.targetId) { where.push('target_id = ?'); params.push(q.targetId); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query<{ total: number }>(`SELECT COUNT(*) AS total FROM audit_logs ${w}`, params);
  const rows = await query(
    `SELECT id, actor_type AS actorType, actor_id AS actorId, action, target_type AS targetType, target_id AS targetId, before_state AS beforeState,
            after_state AS afterState, reason, ip_address AS ip, created_at AS createdAt FROM audit_logs ${w} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, q.pageSize, offset(q)],
  );
  return toPage(rows, Number(total), q);
}

export async function apiHealth() {
  const { client } = await getBetfair();
  const recent = await query(
    `SELECT operation, status, COUNT(*) AS calls, ROUND(AVG(duration_ms)) AS avgMs, MAX(created_at) AS lastAt
       FROM api_logs WHERE created_at > NOW(3) - INTERVAL 1 HOUR GROUP BY operation, status ORDER BY operation`,
  );
  return { status: { ...client.status(), streamConnected: odds.isStreamConnected() }, lastHour: recent };
}

/** Bootstrap the first SUPER_ADMIN (CLI only). */
export async function ensureSuperAdmin(email: string, password: string, name = 'Super Admin') {
  const existing = await queryOne<{ id: number }>('SELECT id FROM admin_users WHERE email = ?', [email.toLowerCase()]);
  if (existing) return existing.id;
  const res = await execute('INSERT INTO admin_users (email, name, password_hash, role) VALUES (?,?,?,?)', [email.toLowerCase(), name, await hashPassword(password), 'SUPER_ADMIN']);
  logger.info({ adminId: res.insertId }, 'super admin created');
  return res.insertId;
}

export const newIdempotencyKey = () => randomUUID();
