import { randomUUID } from 'node:crypto';
import { execute, isDuplicateKey, query, queryOne, withTransaction } from '../config/db.js';
import { paymentProvider } from '../integrations/payments/provider.js';
import type { UserRow } from '../models/types.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { fromCents, toCents } from '../utils/money.js';
import { offset, toPage, type PageQuery } from '../utils/pagination.js';
import { audit } from './auditService.js';
import { assertAccountActive, assertDepositWithinLimits, getLimits } from './complianceService.js';
import { notify } from './notificationService.js';
import { getSetting } from './settingsService.js';
import { applyLedger, publishWallet } from './walletService.js';

interface DepositRow { id: number; uuid: string; user_id: number; amount: string; currency: string; status: string; provider_ref: string | null }
interface WithdrawalRow { id: number; uuid: string; user_id: number; amount: string; currency: string; status: string }

const depositView = (d: Record<string, unknown>) => ({ id: d.uuid, amount: d.amount, currency: d.currency, provider: d.provider, status: d.status, createdAt: d.created_at, completedAt: d.completed_at });

export async function createDeposit(user: UserRow, amount: number, idempotencyKey: string) {
  assertAccountActive(user);
  const cents = toCents(amount);
  if (cents < 100) throw new AppError('VALIDATION_ERROR', 'Minimum deposit is 1.00');
  const prior = await queryOne<Record<string, unknown>>('SELECT * FROM deposits WHERE user_id = ? AND idempotency_key = ?', [user.id, idempotencyKey]);
  if (prior) return { deposit: depositView(prior), duplicate: true };

  const uuid = randomUUID();
  try {
    await withTransaction(async (conn) => {
      // Lock the user's limits row so concurrent deposits can't both pass the limit check.
      await query('SELECT user_id FROM user_limits WHERE user_id = ? FOR UPDATE', [user.id], conn);
      await assertDepositWithinLimits(conn, user.id, cents);
      await execute('INSERT INTO deposits (uuid, user_id, amount, currency, provider, idempotency_key) VALUES (?,?,?,?,?,?)', [uuid, user.id, fromCents(cents), user.currency, paymentProvider.name, idempotencyKey], conn);
    });
  } catch (err) {
    if (isDuplicateKey(err)) return createDeposit(user, amount, idempotencyKey);
    throw err;
  }
  const intent = await paymentProvider.createDeposit({ depositUuid: uuid, amount: fromCents(cents), currency: user.currency });
  await execute('UPDATE deposits SET provider_ref = ? WHERE uuid = ?', [intent.providerRef, uuid]);
  logger.info({ payment: { type: 'deposit', uuid, userId: user.id, amount: fromCents(cents), provider: paymentProvider.name } }, 'deposit created');
  if (intent.status === 'COMPLETED') await completeDeposit(uuid, { source: 'PROVIDER' });
  const row = (await queryOne<Record<string, unknown>>('SELECT * FROM deposits WHERE uuid = ?', [uuid]))!;
  return { deposit: { ...depositView(row), instructions: intent.instructions, redirectUrl: intent.redirectUrl }, duplicate: false };
}

/** Credit a pending deposit exactly once (provider webhook or admin confirmation). */
export async function completeDeposit(uuid: string, by: { source: 'PROVIDER' | 'ADMIN'; adminId?: number }) {
  const userId = await withTransaction(async (conn) => {
    const d = await queryOne<DepositRow>('SELECT * FROM deposits WHERE uuid = ? FOR UPDATE', [uuid], conn);
    if (!d) throw new AppError('NOT_FOUND', 'Deposit not found');
    if (d.status === 'COMPLETED') return null;
    if (d.status !== 'PENDING') throw new AppError('CONFLICT', `Deposit is ${d.status}`);
    await execute(`UPDATE deposits SET status = 'COMPLETED', completed_at = NOW(3) WHERE id = ?`, [d.id], conn);
    await applyLedger(conn, { userId: d.user_id, type: 'DEPOSIT', amount: toCents(d.amount), idempotencyKey: `deposit:${d.uuid}`, referenceType: 'deposit', referenceId: d.uuid, description: 'Deposit', adminId: by.adminId });
    if (by.source === 'ADMIN') await audit({ actorType: 'ADMIN', actorId: by.adminId, action: 'DEPOSIT_CONFIRMED', targetType: 'deposit', targetId: d.uuid, after: { amount: d.amount } }, conn);
    return d.user_id;
  });
  if (userId) {
    await notify(userId, 'DEPOSIT', 'Deposit received', 'Your deposit has been credited to your wallet.');
    await publishWallet(userId);
  }
}

export async function failDeposit(uuid: string, reason: string, adminId?: number) {
  await withTransaction(async (conn) => {
    const d = await queryOne<DepositRow>('SELECT * FROM deposits WHERE uuid = ? FOR UPDATE', [uuid], conn);
    if (!d || d.status !== 'PENDING') throw new AppError('CONFLICT', 'Deposit is not pending');
    await execute(`UPDATE deposits SET status = 'FAILED', failure_reason = ? WHERE id = ?`, [reason.slice(0, 255), d.id], conn);
    await audit({ actorType: adminId ? 'ADMIN' : 'SYSTEM', actorId: adminId, action: 'DEPOSIT_FAILED', targetType: 'deposit', targetId: uuid, reason }, conn);
  });
}

export async function requestWithdrawal(user: UserRow, amount: number, method: string, destinationMasked: string | undefined, idempotencyKey: string) {
  assertAccountActive(user);
  const prior = await queryOne<Record<string, unknown>>('SELECT * FROM withdrawals WHERE user_id = ? AND idempotency_key = ?', [user.id, idempotencyKey]);
  if (prior) return { withdrawal: withdrawalView(prior), duplicate: true };
  const { requireKycForWithdrawal } = await getSetting('compliance');
  if (requireKycForWithdrawal && user.kyc_status !== 'VERIFIED') throw new AppError('KYC_REQUIRED', 'Please complete identity verification before withdrawing.');
  const limits = await getLimits(user.id);
  if (limits.withdrawals_restricted) throw new AppError('FORBIDDEN', 'Withdrawals are restricted on your account. Please contact support.');
  const cents = toCents(amount);
  if (cents < 100) throw new AppError('VALIDATION_ERROR', 'Minimum withdrawal is 1.00');
  const uuid = randomUUID();
  try {
    await withTransaction(async (conn) => {
      await execute('INSERT INTO withdrawals (uuid, user_id, amount, currency, method, destination_masked, idempotency_key) VALUES (?,?,?,?,?,?,?)',
        [uuid, user.id, fromCents(cents), user.currency, method, destinationMasked ?? null, idempotencyKey], conn);
      // Funds leave the available balance immediately and are returned if rejected.
      await applyLedger(conn, { userId: user.id, type: 'WITHDRAWAL', amount: -cents, idempotencyKey: `withdrawal:${uuid}`, referenceType: 'withdrawal', referenceId: uuid, description: 'Withdrawal requested' });
    });
  } catch (err) {
    if (isDuplicateKey(err)) return requestWithdrawal(user, amount, method, destinationMasked, idempotencyKey);
    throw err;
  }
  logger.info({ payment: { type: 'withdrawal', uuid, userId: user.id, amount: fromCents(cents) } }, 'withdrawal requested');
  await publishWallet(user.id);
  return { withdrawal: withdrawalView((await queryOne<Record<string, unknown>>('SELECT * FROM withdrawals WHERE uuid = ?', [uuid]))!), duplicate: false };
}

const withdrawalView = (w: Record<string, unknown>) => ({ id: w.uuid, amount: w.amount, currency: w.currency, method: w.method, destination: w.destination_masked, status: w.status, reviewNote: w.review_note, createdAt: w.created_at, updatedAt: w.updated_at });

export async function cancelWithdrawal(userId: number, uuid: string) {
  await rejectOrCancel(uuid, 'CANCELLED', { userId });
}

/** Admin review: APPROVED → payout; REJECTED → funds returned to the user. */
export async function reviewWithdrawal(uuid: string, decision: 'APPROVE' | 'REJECT', adminId: number, note?: string) {
  if (decision === 'REJECT') return rejectOrCancel(uuid, 'REJECTED', { adminId, note });
  const w = await withTransaction(async (conn) => {
    const row = await queryOne<WithdrawalRow>('SELECT * FROM withdrawals WHERE uuid = ? FOR UPDATE', [uuid], conn);
    if (!row || row.status !== 'PENDING') throw new AppError('CONFLICT', 'Withdrawal is not pending');
    await execute(`UPDATE withdrawals SET status = 'APPROVED', reviewed_by_admin = ?, review_note = ? WHERE id = ?`, [adminId, note ?? null, row.id], conn);
    await audit({ actorType: 'ADMIN', actorId: adminId, action: 'WITHDRAWAL_APPROVED', targetType: 'withdrawal', targetId: uuid, reason: note, after: { amount: row.amount } }, conn);
    return row;
  });
  const payout = await paymentProvider.payout({ withdrawalUuid: uuid, amount: w.amount, currency: w.currency });
  await execute('UPDATE withdrawals SET status = ? WHERE uuid = ?', [payout.status, uuid]);
  await notify(w.user_id, 'WITHDRAWAL', 'Withdrawal approved', `Your withdrawal of ${w.amount} ${w.currency} has been approved.`);
}

async function rejectOrCancel(uuid: string, status: 'REJECTED' | 'CANCELLED', by: { userId?: number; adminId?: number; note?: string }) {
  const userId = await withTransaction(async (conn) => {
    const w = await queryOne<WithdrawalRow>('SELECT * FROM withdrawals WHERE uuid = ? FOR UPDATE', [uuid], conn);
    if (!w || (by.userId && w.user_id !== by.userId)) throw new AppError('NOT_FOUND', 'Withdrawal not found');
    if (w.status !== 'PENDING') throw new AppError('CONFLICT', 'Only pending withdrawals can be changed');
    await execute('UPDATE withdrawals SET status = ?, reviewed_by_admin = ?, review_note = ? WHERE id = ?', [status, by.adminId ?? null, by.note ?? null, w.id], conn);
    await applyLedger(conn, { userId: w.user_id, type: 'REFUND', amount: toCents(w.amount), idempotencyKey: `withdrawal-return:${uuid}`, referenceType: 'withdrawal', referenceId: uuid, description: status === 'REJECTED' ? 'Withdrawal rejected — funds returned' : 'Withdrawal cancelled', adminId: by.adminId });
    if (by.adminId) await audit({ actorType: 'ADMIN', actorId: by.adminId, action: 'WITHDRAWAL_REJECTED', targetType: 'withdrawal', targetId: uuid, reason: by.note }, conn);
    return w.user_id;
  });
  if (by.adminId) await notify(userId, 'WITHDRAWAL', 'Withdrawal rejected', `Your withdrawal was rejected${by.note ? `: ${by.note}` : ''}. The funds were returned to your wallet.`);
  await publishWallet(userId);
}

export async function listDeposits(userId: number, q: PageQuery) {
  const [{ total }] = await query<{ total: number }>('SELECT COUNT(*) AS total FROM deposits WHERE user_id = ?', [userId]);
  const rows = await query<Record<string, unknown>>('SELECT * FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', [userId, q.pageSize, offset(q)]);
  return toPage(rows.map(depositView), Number(total), q);
}

export async function listWithdrawals(userId: number, q: PageQuery) {
  const [{ total }] = await query<{ total: number }>('SELECT COUNT(*) AS total FROM withdrawals WHERE user_id = ?', [userId]);
  const rows = await query<Record<string, unknown>>('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', [userId, q.pageSize, offset(q)]);
  return toPage(rows.map(withdrawalView), Number(total), q);
}
