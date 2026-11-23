import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, isDuplicateKey, query, queryOne, type Db, pool } from '../config/db.js';
import type { WalletRow } from '../models/types.js';
import { AppError } from '../utils/errors.js';
import { bus } from '../utils/eventBus.js';
import { fromCents, toCents, type Cents } from '../utils/money.js';
import { offset, toPage, type PageQuery } from '../utils/pagination.js';

export type LedgerType = 'DEPOSIT' | 'WITHDRAWAL' | 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'COMMISSION' | 'ADJUSTMENT';

export interface LedgerEntry {
  userId: number;
  type: LedgerType;
  /** change to available balance (cents, signed) */
  amount: Cents;
  /** change to exposure (cents, signed) */
  exposureChange?: Cents;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string | number;
  description?: string;
  adminId?: number;
}

export interface WalletView {
  currency: string;
  balance: string;
  exposure: string;
  total: string;
}

export const walletView = (w: WalletRow): WalletView => ({
  currency: w.currency,
  balance: fromCents(toCents(w.balance)),
  exposure: fromCents(toCents(w.exposure)),
  total: fromCents(toCents(w.balance) + toCents(w.exposure)),
});

export async function createWallet(userId: number, currency: string, db: Db = pool) {
  await execute('INSERT INTO user_wallets (user_id, currency) VALUES (?, ?)', [userId, currency], db);
}

export async function getWallet(userId: number, db: Db = pool): Promise<WalletRow> {
  const w = await queryOne<WalletRow>('SELECT * FROM user_wallets WHERE user_id = ?', [userId], db);
  if (!w) throw new AppError('NOT_FOUND', 'Wallet not found');
  return w;
}

/** Row-locks the wallet for the remainder of the transaction. */
export async function lockWallet(conn: PoolConnection, userId: number): Promise<WalletRow> {
  const w = await queryOne<WalletRow>('SELECT * FROM user_wallets WHERE user_id = ? FOR UPDATE', [userId], conn);
  if (!w) throw new AppError('NOT_FOUND', 'Wallet not found');
  return w;
}

/**
 * The ONLY function that changes a wallet. Must be called inside a transaction.
 * Locks the wallet row, enforces non-negative balance/exposure, writes an
 * append-only ledger row, and is idempotent on `idempotencyKey`:
 * a repeated key returns the original transaction without applying twice.
 */
export async function applyLedger(conn: PoolConnection, e: LedgerEntry): Promise<{ txId: number; wallet: WalletRow; duplicate: boolean }> {
  const existing = await queryOne<{ id: number }>('SELECT id FROM wallet_transactions WHERE idempotency_key = ?', [e.idempotencyKey], conn);
  const wallet = await lockWallet(conn, e.userId);
  if (existing) return { txId: existing.id, wallet, duplicate: true };

  const balance = toCents(wallet.balance) + e.amount;
  const exposure = toCents(wallet.exposure) + (e.exposureChange ?? 0);
  if (balance < 0) throw new AppError('INSUFFICIENT_FUNDS', 'Insufficient available balance');
  if (exposure < 0) throw new AppError('INTERNAL_ERROR', 'Exposure would become negative');

  await execute('UPDATE user_wallets SET balance = ?, exposure = ?, version = version + 1 WHERE id = ?', [fromCents(balance), fromCents(exposure), wallet.id], conn);
  try {
    const res = await execute(
      `INSERT INTO wallet_transactions
        (uuid, wallet_id, user_id, type, amount, exposure_change, balance_after, exposure_after, reference_type, reference_id, idempotency_key, description, created_by_admin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        randomUUID(), wallet.id, e.userId, e.type, fromCents(e.amount), fromCents(e.exposureChange ?? 0), fromCents(balance), fromCents(exposure),
        e.referenceType ?? null, e.referenceId !== undefined ? String(e.referenceId) : null, e.idempotencyKey, e.description ?? null, e.adminId ?? null,
      ],
      conn,
    );
    const updated = { ...wallet, balance: fromCents(balance), exposure: fromCents(exposure), version: wallet.version + 1 };
    return { txId: res.insertId, wallet: updated, duplicate: false };
  } catch (err) {
    if (isDuplicateKey(err)) throw new AppError('DUPLICATE_REQUEST', 'Duplicate transaction');
    throw err;
  }
}

/** Push the latest wallet to the user's live connections (call after commit). */
export async function publishWallet(userId: number) {
  const w = await getWallet(userId);
  bus.toUser(userId, { type: 'wallet', wallet: walletView(w) });
}

export interface TxFilter extends PageQuery {
  type?: LedgerType;
  from?: Date | null;
  to?: Date | null;
}

export async function listTransactions(userId: number, f: TxFilter) {
  const where = ['user_id = ?'];
  const params: unknown[] = [userId];
  if (f.type) { where.push('type = ?'); params.push(f.type); }
  if (f.from) { where.push('created_at >= ?'); params.push(f.from); }
  if (f.to) { where.push('created_at < ?'); params.push(f.to); }
  const w = where.join(' AND ');
  const [{ total }] = await query<{ total: number }>(`SELECT COUNT(*) AS total FROM wallet_transactions WHERE ${w}`, params);
  const rows = await query(
    `SELECT uuid AS id, type, amount, exposure_change AS exposureChange, balance_after AS balanceAfter, exposure_after AS exposureAfter,
            reference_type AS referenceType, reference_id AS referenceId, description, created_at AS createdAt
       FROM wallet_transactions WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, f.pageSize, offset(f)],
  );
  return toPage(rows, Number(total), f);
}

export async function walletSummary(userId: number) {
  const w = await getWallet(userId);
  const [pl] = await query<{ pnl: string | null; commission: string | null }>(
    `SELECT SUM(profit_loss) AS pnl, SUM(commission) AS commission FROM bet_items WHERE user_id = ? AND status = 'SETTLED'`,
    [userId],
  );
  const [pending] = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM bet_items WHERE user_id = ? AND status IN ('PENDING','UNMATCHED','PARTIALLY_MATCHED','MATCHED')`,
    [userId],
  );
  return {
    ...walletView(w),
    profitLoss: fromCents(toCents(pl?.pnl) - toCents(pl?.commission)),
    pendingBets: Number(pending.cnt),
  };
}
