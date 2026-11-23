import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, isDuplicateKey, query, queryOne, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { BetfairError, toAppError } from '../integrations/betfair/errors.js';
import { getBetfair } from '../integrations/betfair/index.js';
import type { CurrentOrderSummary, PlaceExecutionReport, PlaceInstruction } from '../integrations/betfair/types.js';
import type { BetItemRow, UserRow } from '../models/types.js';
import { AppError } from '../utils/errors.js';
import { bus } from '../utils/eventBus.js';
import { isValidPrice, liability, potentialProfit, type Side } from '../utils/exchange.js';
import { logger } from '../utils/logger.js';
import { fromCents, toCents, type Cents } from '../utils/money.js';
import { offset, resolveRange, toPage, type PageQuery } from '../utils/pagination.js';
import { assertCanBet } from './complianceService.js';
import { getMarketRecord, type MarketRecord } from './marketService.js';
import { notify } from './notificationService.js';
import { odds } from './oddsService.js';
import { assertWithinRisk, evaluateBetActivity } from './riskService.js';
import { applyLedger, lockWallet, publishWallet } from './walletService.js';
import { toCents as c } from '../utils/money.js';
import { assertMarketCapacity, initHouseBook, isHouseMode, resolveItem, watchMarket } from './houseBookService.js';

export interface BetRequestItem {
  marketId: string;
  selectionId: number;
  side: Side;
  price: number;
  stake: number;
}

export interface PlaceBetsInput {
  idempotencyKey: string;
  /** REJECT: fail if the price/size is no longer fully available. KEEP: place anyway; any shortfall rests unmatched on the exchange. */
  unmatchedPolicy: 'REJECT' | 'KEEP';
  items: BetRequestItem[];
}

export const canPlaceOrders = () => isHouseMode() || env.BETFAIR_MODE === 'mock' || env.BETFAIR_PLACE_ORDERS;

const OPEN_STATUSES = ['PENDING', 'UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED'] as const;
const hex = (uuid: string) => uuid.replace(/-/g, '');

/** Liability still reserved for an item (cancelled/lapsed portions released). */
export function heldFor(item: Pick<BetItemRow, 'side' | 'stake' | 'size_cancelled' | 'size_lapsed' | 'requested_price'>): Cents {
  const live = c(item.stake) - c(item.size_cancelled) - c(item.size_lapsed);
  return liability(item.side, Math.max(0, live), Number(item.requested_price));
}

interface Validated {
  req: BetRequestItem;
  market: MarketRecord;
  stake: Cents;
  liability: Cents;
  runnerName?: string;
}

/** Pre-trade validation against the live book. Throws user-safe errors. */
async function validateItem(req: BetRequestItem, policy: PlaceBetsInput['unmatchedPolicy']): Promise<Validated> {
  const stake = toCents(req.stake);
  if (!(stake > 0) || Math.abs(req.stake * 100 - stake) > 1e-6) throw new AppError('INVALID_STAKE', 'Stake must be a positive amount with at most 2 decimals.');
  if (!isValidPrice(req.price)) throw new AppError('INVALID_PRICE', `${req.price} is not a valid exchange price.`);
  const market = await getMarketRecord(req.marketId);
  if (!market || !market.is_enabled) throw new AppError('MARKET_CLOSED', 'This market is not available.');
  if (market.status === 'CLOSED' || market.settled_at) throw new AppError('MARKET_CLOSED', 'This market is closed for betting.');
  if (market.admin_suspended) throw new AppError('MARKET_SUSPENDED', 'This market is suspended. Please try again shortly.');

  let book;
  try {
    book = await odds.get(req.marketId);
  } catch (err) {
    throw toAppError(err);
  }
  if (!book) throw new AppError('MARKET_CLOSED', 'This market is not available.');
  if (book.status === 'SUSPENDED') throw new AppError('MARKET_SUSPENDED', 'This market is suspended. Please try again shortly.', { marketId: req.marketId });
  if (book.status !== 'OPEN') throw new AppError('MARKET_CLOSED', 'This market is closed for betting.', { marketId: req.marketId });
  const runner = book.runners.find((r) => r.selectionId === req.selectionId);
  if (!runner || runner.status !== 'ACTIVE') throw new AppError('RUNNER_NOT_ACTIVE', 'This selection is no longer available.', { marketId: req.marketId, selectionId: req.selectionId });

  // A BACK at P matches offers in the back column priced ≥ P; a LAY at P matches lay-column offers ≤ P.
  const levels = req.side === 'BACK' ? runner.back.filter((l) => l.price >= req.price) : runner.lay.filter((l) => l.price <= req.price);
  const available = toCents(levels.reduce((a, l) => a + l.size, 0));
  if (policy === 'REJECT') {
    const best = req.side === 'BACK' ? runner.back[0]?.price : runner.lay[0]?.price;
    if (!levels.length) {
      throw new AppError('ODDS_CHANGED', 'The odds have changed. Please review your bet.', { marketId: req.marketId, selectionId: req.selectionId, side: req.side, currentPrice: best ?? null });
    }
    if (!isHouseMode() && available < stake) {
      throw new AppError('INSUFFICIENT_LIQUIDITY', `Only ${fromCents(available)} is available at these odds.`, { marketId: req.marketId, selectionId: req.selectionId, availableSize: fromCents(available) });
    }
  }
  return { req, market, stake, liability: liability(req.side, stake, req.price) };
}

export async function placeBets(user: UserRow, input: PlaceBetsInput, ip?: string) {
  if (!canPlaceOrders()) throw new AppError('EXCHANGE_UNAVAILABLE', 'Betting is currently unavailable.');

  // Idempotency: a repeated key (double click / network retry) returns the original bet.
  const existing = await queryOne<{ id: number }>('SELECT id FROM bets WHERE user_id = ? AND idempotency_key = ?', [user.id, input.idempotencyKey]);
  if (existing) return { duplicate: true, bet: await getBetSlip(user.id, existing.id) };

  const limits = await assertCanBet(user);
  const validated: Validated[] = [];
  for (const item of input.items) validated.push(await validateItem(item, input.unmatchedPolicy));
  const totalStake = validated.reduce((a, v) => a + v.stake, 0);
  const totalLiability = validated.reduce((a, v) => a + v.liability, 0);

  // ── Tx 1: reserve funds + persist intent ──────────────────────────────
  const betUuid = randomUUID();
  let created: { betId: number; items: Array<{ id: number; uuid: string; customerRef: string; v: Validated }> };
  try {
    created = await withTransaction(async (conn) => {
      const wallet = await lockWallet(conn, user.id);
      await assertWithinRisk({ userId: user.id, limits, stakes: validated.map((v) => ({ stake: v.stake, price: v.req.price })), newLiability: totalLiability, currentExposure: toCents(wallet.exposure), db: conn });
      if (toCents(wallet.balance) < totalLiability) {
        throw new AppError('INSUFFICIENT_FUNDS', 'Insufficient balance for this bet.', { required: fromCents(totalLiability), available: wallet.balance });
      }
      if (isHouseMode()) {
        await assertMarketCapacity(conn, validated.map((v) => v.market.id), validated.map((v) => ({ marketDbId: v.market.id, selectionId: v.req.selectionId, side: v.req.side, stake: v.stake, price: v.req.price })));
      }
      const bet = await execute(
        'INSERT INTO bets (uuid, user_id, idempotency_key, total_stake, total_liability, status, ip_address) VALUES (?,?,?,?,?,?,?)',
        [betUuid, user.id, input.idempotencyKey, fromCents(totalStake), fromCents(totalLiability), 'PENDING', ip ?? null],
        conn,
      );
      const items = [];
      for (const v of validated) {
        const uuid = randomUUID();
        const it = await execute(
          `INSERT INTO bet_items (uuid, bet_id, user_id, market_id, selection_id, side, requested_price, stake, liability, status)
           VALUES (?,?,?,?,?,?,?,?,?, 'PENDING')`,
          [uuid, bet.insertId, user.id, v.market.id, v.req.selectionId, v.req.side, v.req.price.toFixed(2), fromCents(v.stake), fromCents(v.liability)],
          conn,
        );
        const customerRef = hex(uuid);
        if (!isHouseMode()) await execute('INSERT INTO bet_orders (bet_item_id, customer_ref, operation, status, price, size) VALUES (?,?,?,?,?,?)', [it.insertId, customerRef, 'PLACE', 'SENT', v.req.price.toFixed(2), fromCents(v.stake)], conn);
        items.push({ id: it.insertId, uuid, customerRef, v });
      }
      await applyLedger(conn, {
        userId: user.id, type: 'BET', amount: -totalLiability, exposureChange: totalLiability,
        idempotencyKey: `bet:${betUuid}`, referenceType: 'bet', referenceId: betUuid, description: `Bet placed (${items.length} selection${items.length > 1 ? 's' : ''})`,
      });
      return { betId: bet.insertId, items };
    });
  } catch (err) {
    if (isDuplicateKey(err)) {
      const dup = await queryOne<{ id: number }>('SELECT id FROM bets WHERE user_id = ? AND idempotency_key = ?', [user.id, input.idempotencyKey]);
      if (dup) return { duplicate: true, bet: await getBetSlip(user.id, dup.id) };
    }
    throw err;
  }
  logger.info({ bet: { betUuid, userId: user.id, items: created.items.length, liability: fromCents(totalLiability) } }, 'bet request');

  if (isHouseMode()) {
    // ── House book: match locally against the current Betfair price. Nothing is sent to Betfair. ──
    for (const it of created.items) {
      const book = await odds.get(it.v.req.marketId);
      const outcome = book ? await resolveItem(it.id, book, null) : null;
      if (!outcome) {
        // Price not available now: keep it waiting (status UNMATCHED) until the Betfair price reaches it.
        await withTransaction((conn) => applyOrderSummary(conn, it.id, { sizeMatched: 0, averagePriceMatched: 0, sizeCancelled: 0, sizeLapsed: 0, sizeVoided: 0 }));
        watchMarket(it.v.req.marketId);
      }
    }
    return finishPlacement(user.id, created.betId, betUuid, totalStake);
  }

  // ── Exchange mode: one placeOrders call per market ────────────────────
  const { client } = await getBetfair();
  const byMarket = new Map<string, typeof created.items>();
  for (const it of created.items) {
    const list = byMarket.get(it.v.req.marketId) ?? [];
    list.push(it);
    byMarket.set(it.v.req.marketId, list);
  }
  let idx = 0;
  for (const [marketId, items] of byMarket) {
    const instructions: PlaceInstruction[] = items.map((it) => ({
      orderType: 'LIMIT',
      selectionId: it.v.req.selectionId,
      side: it.v.req.side,
      limitOrder: { size: it.v.stake / 100, price: it.v.req.price, persistenceType: 'LAPSE' },
      customerOrderRef: it.customerRef,
    }));
    let report: PlaceExecutionReport | null = null;
    let definiteFailure: string | null = null;
    try {
      report = await client.placeOrders(marketId, instructions, `${hex(betUuid).slice(0, 30)}${(idx++).toString(36).padStart(2, '0')}`);
    } catch (err) {
      const retryable = err instanceof BetfairError ? err.retryable : true;
      if (!retryable) definiteFailure = err instanceof BetfairError ? err.betfairCode : 'ERROR_IN_ORDER';
      // Retryable (timeout/network): outcome unknown → items stay PENDING and the reconciler resolves them.
      logger.warn({ bet: { betUuid, marketId, retryable } }, 'placeOrders error');
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const ir = report?.instructionReports[i];
      if (ir?.status === 'SUCCESS' && ir.betId) {
        await withTransaction(async (conn) => {
          await execute(`UPDATE bet_orders SET betfair_bet_id = ?, status = 'SUCCESS', order_status = ?, size_matched = ?, avg_price_matched = ? WHERE bet_item_id = ? AND customer_ref = ?`,
            [ir.betId, ir.orderStatus ?? null, (ir.sizeMatched ?? 0).toFixed(2), ir.averagePriceMatched ? ir.averagePriceMatched.toFixed(2) : null, it.id, it.customerRef], conn);
          await applyOrderSummary(conn, it.id, { sizeMatched: ir.sizeMatched ?? 0, averagePriceMatched: ir.averagePriceMatched ?? 0, sizeCancelled: 0, sizeLapsed: 0, sizeVoided: 0 });
        });
      } else if (definiteFailure || (report && (ir?.status === 'FAILURE' || report.status === 'FAILURE'))) {
        const code = ir?.errorCode ?? report?.errorCode ?? definiteFailure ?? 'ERROR_IN_ORDER';
        await failItem(it.id, code);
      }
    }
  }

  return finishPlacement(user.id, created.betId, betUuid, totalStake);
}

async function finishPlacement(userId: number, betId: number, betUuid: string, totalStake: Cents) {
  const final = await finaliseBetStatus(betId);
  await publishWallet(userId);
  const slip = await getBetSlip(userId, betId);
  bus.toUser(userId, { type: 'bet', bet: slip });
  void evaluateBetActivity(userId, totalStake);
  logger.info({ bet: { betUuid, status: final, mode: env.BET_EXECUTION_MODE } }, 'bet response');

  if (final === 'FAILED') {
    const first = slip.items.find((i) => i.failureCode);
    throw toAppError(new BetfairError(first?.failureCode ?? 'ERROR_IN_ORDER', 'All bet items failed'));
  }
  return { duplicate: false, bet: slip };
}

/** Mark an item failed and release its reserved liability (idempotent). */
export async function failItem(itemId: number, code: string) {
  await withTransaction(async (conn) => {
    const item = await queryOne<BetItemRow>('SELECT * FROM bet_items WHERE id = ? FOR UPDATE', [itemId], conn);
    if (!item || item.status !== 'PENDING') return;
    const held = heldFor(item);
    await execute(`UPDATE bet_items SET status = 'FAILED', failure_code = ? WHERE id = ?`, [code.slice(0, 50), itemId], conn);
    await execute(`UPDATE bet_orders SET status = 'FAILURE', error_code = ? WHERE bet_item_id = ? AND status IN ('SENT','TIMEOUT')`, [code.slice(0, 60), itemId], conn);
    if (held > 0) {
      await applyLedger(conn, { userId: item.user_id, type: 'REFUND', amount: held, exposureChange: -held, idempotencyKey: `fail:${item.uuid}`, referenceType: 'bet_item', referenceId: item.uuid, description: 'Bet not placed — funds released' });
    }
  });
}

type OrderNumbers = Pick<CurrentOrderSummary, 'sizeMatched' | 'averagePriceMatched' | 'sizeCancelled' | 'sizeLapsed' | 'sizeVoided'>;

/**
 * Apply the exchange's view of an order to its bet item: matched size,
 * average price, cancelled/lapsed amounts. Releases liability for any
 * newly cancelled/lapsed portion. Idempotent — re-applying the same summary is a no-op.
 */
export async function applyOrderSummary(conn: PoolConnection, itemId: number, o: OrderNumbers) {
  const item = await queryOne<BetItemRow>('SELECT * FROM bet_items WHERE id = ? FOR UPDATE', [itemId], conn);
  if (!item || ['SETTLED', 'VOIDED', 'FAILED'].includes(item.status)) return;
  const stake = c(item.stake);
  const matched = Math.min(stake, toCents(o.sizeMatched));
  const cancelled = toCents(o.sizeCancelled) + toCents(o.sizeVoided);
  const lapsed = toCents(o.sizeLapsed);
  const remaining = Math.max(0, stake - matched - cancelled - lapsed);
  const status = matched === 0 && remaining === 0 ? (lapsed > cancelled ? 'LAPSED' : 'CANCELLED') : remaining === 0 ? 'MATCHED' : matched > 0 ? 'PARTIALLY_MATCHED' : 'UNMATCHED';

  const heldBefore = heldFor(item);
  const next = { ...item, size_cancelled: fromCents(cancelled), size_lapsed: fromCents(lapsed) };
  const heldAfter = heldFor(next);
  const release = heldBefore - heldAfter;

  await execute(
    `UPDATE bet_items SET size_matched = ?, avg_price_matched = ?, size_cancelled = ?, size_lapsed = ?, status = ?,
            matched_at = IF(? > 0 AND matched_at IS NULL, NOW(3), matched_at) WHERE id = ?`,
    [fromCents(matched), matched > 0 && o.averagePriceMatched ? o.averagePriceMatched.toFixed(2) : null, fromCents(cancelled), fromCents(lapsed), status, matched, itemId],
    conn,
  );
  if (release > 0) {
    await applyLedger(conn, {
      userId: item.user_id, type: 'REFUND', amount: release, exposureChange: -release,
      idempotencyKey: `release:${item.uuid}:${cancelled + lapsed}`, referenceType: 'bet_item', referenceId: item.uuid,
      description: status === 'LAPSED' ? 'Unmatched bet lapsed' : 'Unmatched stake cancelled',
    });
  }
  if (status !== item.status && ['LAPSED'].includes(status)) {
    await notify(item.user_id, 'BET_LAPSED', 'Unmatched bet lapsed', `Your unmatched bet was lapsed by the exchange and ${fromCents(release)} has been returned.`, conn);
  }
}

async function finaliseBetStatus(betId: number) {
  const items = await query<{ status: string }>('SELECT status FROM bet_items WHERE bet_id = ?', [betId]);
  const failed = items.filter((i) => i.status === 'FAILED').length;
  const pending = items.filter((i) => i.status === 'PENDING').length;
  const status = failed === items.length ? 'FAILED' : pending ? 'PENDING' : failed ? 'PARTIAL' : 'PLACED';
  await execute('UPDATE bets SET status = ? WHERE id = ?', [status, betId]);
  return status;
}

// ───────── Cancel / replace unmatched ─────────
async function getOwnedItem(userId: number, itemUuid: string) {
  const item = await queryOne<BetItemRow & { betfair_market_id: string }>(
    'SELECT bi.*, m.betfair_id AS betfair_market_id FROM bet_items bi JOIN markets m ON m.id = bi.market_id WHERE bi.uuid = ? AND bi.user_id = ?',
    [itemUuid, userId],
  );
  if (!item) throw new AppError('NOT_FOUND', 'Bet not found');
  return item;
}

const activeOrder = (itemId: number) =>
  queryOne<{ id: number; betfair_bet_id: string | null; customer_ref: string }>(
    `SELECT id, betfair_bet_id, customer_ref FROM bet_orders WHERE bet_item_id = ? AND (order_status IS NULL OR order_status <> 'REPLACED') ORDER BY id DESC LIMIT 1`,
    [itemId],
  );

export async function cancelUnmatched(userId: number, itemUuid: string) {
  const item = await getOwnedItem(userId, itemUuid);
  if (!['UNMATCHED', 'PARTIALLY_MATCHED'].includes(item.status)) throw new AppError('CONFLICT', 'Only unmatched bets can be cancelled.');
  if (isHouseMode()) {
    await withTransaction(async (conn) => {
      const cur = await queryOne<BetItemRow>('SELECT * FROM bet_items WHERE id = ? FOR UPDATE', [item.id], conn);
      if (!cur || !['UNMATCHED', 'PARTIALLY_MATCHED'].includes(cur.status)) throw new AppError('CONFLICT', 'This bet was matched or closed before it could be cancelled.');
      const remaining = c(cur.stake) - c(cur.size_matched) - c(cur.size_lapsed);
      await applyOrderSummary(conn, cur.id, { sizeMatched: c(cur.size_matched) / 100, averagePriceMatched: Number(cur.avg_price_matched ?? 0), sizeCancelled: remaining / 100, sizeLapsed: c(cur.size_lapsed) / 100, sizeVoided: 0 });
    });
    await publishWallet(userId);
    return getBetItemView(userId, itemUuid);
  }
  const order = await activeOrder(item.id);
  if (!order?.betfair_bet_id) throw new AppError('CONFLICT', 'This bet cannot be cancelled yet.');
  const { client } = await getBetfair();
  try {
    await client.cancelOrders(item.betfair_market_id, [{ betId: order.betfair_bet_id }]);
  } catch (err) {
    throw toAppError(err);
  }
  await syncOrder(item.id, order.betfair_bet_id);
  await publishWallet(userId);
  return getBetItemView(userId, itemUuid);
}

export async function replacePrice(userId: number, itemUuid: string, newPrice: number) {
  if (!isValidPrice(newPrice)) throw new AppError('INVALID_PRICE', `${newPrice} is not a valid exchange price.`);
  const item = await getOwnedItem(userId, itemUuid);
  if (item.status !== 'UNMATCHED' || c(item.size_matched) > 0) throw new AppError('CONFLICT', 'Only fully unmatched bets can be edited.');
  if (isHouseMode()) {
    await withTransaction(async (conn) => {
      const cur = await queryOne<BetItemRow>('SELECT * FROM bet_items WHERE id = ? FOR UPDATE', [item.id], conn);
      if (!cur || cur.status !== 'UNMATCHED') throw new AppError('CONFLICT', 'This bet was matched or closed before it could be edited.');
      const before = heldFor(cur);
      const after = heldFor({ ...cur, requested_price: newPrice.toFixed(2) });
      const diff = after - before;
      if (diff !== 0) {
        await applyLedger(conn, { userId, type: diff > 0 ? 'BET' : 'REFUND', amount: -diff, exposureChange: diff, idempotencyKey: `replace:${cur.uuid}:${Date.now()}`, referenceType: 'bet_item', referenceId: cur.uuid, description: diff > 0 ? 'Bet odds changed — additional liability' : 'Bet odds changed — liability reduced' });
      }
      await execute('UPDATE bet_items SET requested_price = ?, liability = ? WHERE id = ?', [newPrice.toFixed(2), fromCents(liability(cur.side, c(cur.stake), newPrice)), cur.id], conn);
    });
    const book = await odds.get(item.betfair_market_id);
    if (book) await resolveItem(item.id, book, null);
    await publishWallet(userId);
    return getBetItemView(userId, itemUuid);
  }
  const order = await activeOrder(item.id);
  if (!order?.betfair_bet_id) throw new AppError('CONFLICT', 'This bet cannot be edited yet.');
  const oldHeld = heldFor(item);
  const newHeld = heldFor({ ...item, requested_price: newPrice.toFixed(2) });
  const diff = newHeld - oldHeld;
  const n = Date.now();
  if (diff > 0) {
    await withTransaction((conn) => applyLedger(conn, { userId, type: 'BET', amount: -diff, exposureChange: diff, idempotencyKey: `replace:${item.uuid}:${n}`, referenceType: 'bet_item', referenceId: item.uuid, description: 'Bet odds changed — additional liability' }));
  }
  const { client } = await getBetfair();
  let report;
  try {
    report = await client.replaceOrders(item.betfair_market_id, [{ betId: order.betfair_bet_id, newPrice }]);
  } catch (err) {
    report = null;
    if (diff > 0) await withTransaction((conn) => applyLedger(conn, { userId, type: 'REFUND', amount: diff, exposureChange: -diff, idempotencyKey: `replace-undo:${item.uuid}:${n}`, referenceType: 'bet_item', referenceId: item.uuid, description: 'Odds change failed — liability released' }));
    throw toAppError(err);
  }
  const ir = report.instructionReports[0];
  const placed = ir?.placeInstructionReport;
  if (ir?.status !== 'SUCCESS' || !placed?.betId) {
    if (diff > 0) await withTransaction((conn) => applyLedger(conn, { userId, type: 'REFUND', amount: diff, exposureChange: -diff, idempotencyKey: `replace-undo:${item.uuid}:${n}`, referenceType: 'bet_item', referenceId: item.uuid, description: 'Odds change failed — liability released' }));
    throw toAppError(new BetfairError(ir?.errorCode ?? report.errorCode ?? 'ERROR_IN_ORDER', 'replace failed'));
  }
  await withTransaction(async (conn) => {
    await execute(`UPDATE bet_orders SET order_status = 'REPLACED' WHERE id = ?`, [order.id], conn);
    await execute('INSERT INTO bet_orders (bet_item_id, customer_ref, betfair_bet_id, operation, status, order_status, price, size) VALUES (?,?,?,?,?,?,?,?)',
      [item.id, hex(randomUUID()), placed.betId, 'REPLACE', 'SUCCESS', placed.orderStatus ?? null, newPrice.toFixed(2), item.stake], conn);
    await execute('UPDATE bet_items SET requested_price = ?, liability = ? WHERE id = ?', [newPrice.toFixed(2), fromCents(liability(item.side, c(item.stake), newPrice)), item.id], conn);
    if (diff < 0) {
      await applyLedger(conn, { userId, type: 'REFUND', amount: -diff, exposureChange: diff, idempotencyKey: `replace:${item.uuid}:${n}`, referenceType: 'bet_item', referenceId: item.uuid, description: 'Bet odds changed — liability reduced' });
    }
    await applyOrderSummary(conn, item.id, { sizeMatched: placed.sizeMatched ?? 0, averagePriceMatched: placed.averagePriceMatched ?? 0, sizeCancelled: 0, sizeLapsed: 0, sizeVoided: 0 });
  });
  await publishWallet(userId);
  return getBetItemView(userId, itemUuid);
}

/** Pull the latest state of one exchange order and apply it. */
export async function syncOrder(itemId: number, betfairBetId: string) {
  const { client } = await getBetfair();
  const [o] = await client.listCurrentOrders({ betIds: [betfairBetId] });
  if (!o) return;
  await withTransaction(async (conn) => {
    await execute('UPDATE bet_orders SET order_status = ?, size_matched = ?, avg_price_matched = ? WHERE betfair_bet_id = ? AND (order_status IS NULL OR order_status <> \'REPLACED\')',
      [o.status, o.sizeMatched.toFixed(2), o.averagePriceMatched ? o.averagePriceMatched.toFixed(2) : null, betfairBetId], conn);
    await applyOrderSummary(conn, itemId, o);
  });
}

/**
 * Reconciler (job): resolves PENDING items whose placeOrders outcome was
 * unknown (timeout) and refreshes matched/lapsed state of resting orders.
 */
export async function reconcileOpenOrders() {
  if (isHouseMode()) return; // house bets never reach Betfair; see houseBookService
  const { client } = await getBetfair();
  // 1) Ambiguous placements: look up by our customerOrderRef.
  const pending = await query<{ item_id: number; user_id: number; customer_ref: string; placed_at: Date }>(
    `SELECT bi.id AS item_id, bi.user_id, bo.customer_ref, bi.placed_at FROM bet_items bi JOIN bet_orders bo ON bo.bet_item_id = bi.id
      WHERE bi.status = 'PENDING' AND bo.betfair_bet_id IS NULL AND bi.placed_at < NOW(3) - INTERVAL 5 SECOND LIMIT 200`,
  );
  if (pending.length) {
    const found = await client.listCurrentOrders({ customerOrderRefs: pending.map((p) => p.customer_ref) });
    const byRef = new Map(found.map((o) => [o.customerOrderRef, o]));
    for (const p of pending) {
      const o = byRef.get(p.customer_ref);
      if (o) {
        await withTransaction(async (conn) => {
          await execute(`UPDATE bet_orders SET betfair_bet_id = ?, status = 'SUCCESS', order_status = ? WHERE customer_ref = ?`, [o.betId, o.status, p.customer_ref], conn);
          await applyOrderSummary(conn, p.item_id, o);
        });
      } else if (Date.now() - p.placed_at.getTime() > 60_000) {
        // Not on the exchange after a minute → the placement never happened.
        await failItem(p.item_id, 'NOT_PLACED');
        await notify(p.user_id, 'BET_FAILED', 'Bet not placed', 'A bet could not be confirmed by the exchange. Your funds have been returned.');
      }
      await publishWallet(p.user_id);
    }
    const bets = await query<{ bet_id: number }>('SELECT DISTINCT bet_id FROM bet_items WHERE id IN (?)', [pending.map((p) => p.item_id)]);
    for (const b of bets) await finaliseBetStatus(b.bet_id);
  }
  // 2) Resting orders: refresh matched / lapsed sizes.
  const open = await query<{ item_id: number; user_id: number; betfair_bet_id: string; size_matched: string }>(
    `SELECT bi.id AS item_id, bi.user_id, bo.betfair_bet_id, bi.size_matched FROM bet_items bi
       JOIN bet_orders bo ON bo.bet_item_id = bi.id AND bo.betfair_bet_id IS NOT NULL AND (bo.order_status IS NULL OR bo.order_status <> 'REPLACED')
      WHERE bi.status IN ('UNMATCHED','PARTIALLY_MATCHED') LIMIT 500`,
  );
  if (open.length) {
    const orders = await client.listCurrentOrders({ betIds: open.map((o) => o.betfair_bet_id) });
    const byId = new Map(orders.map((o) => [o.betId, o]));
    for (const row of open) {
      const o = byId.get(row.betfair_bet_id);
      if (!o) continue;
      await withTransaction(async (conn) => {
        await execute('UPDATE bet_orders SET order_status = ?, size_matched = ?, avg_price_matched = ? WHERE betfair_bet_id = ?', [o.status, o.sizeMatched.toFixed(2), o.averagePriceMatched ? o.averagePriceMatched.toFixed(2) : null, o.betId], conn);
        await applyOrderSummary(conn, row.item_id, o);
      });
      if (toCents(o.sizeMatched) !== toCents(row.size_matched)) {
        const view = await getBetItemViewById(row.item_id);
        if (view) bus.toUser(row.user_id, { type: 'bet', bet: { items: [view] } });
      }
      await publishWallet(row.user_id);
    }
  }
}

// ───────── Read models ─────────
const ITEM_SELECT = `
  SELECT bi.uuid AS id, b.uuid AS betId, bi.side, bi.requested_price AS price, bi.stake, bi.liability, bi.size_matched AS sizeMatched,
         bi.avg_price_matched AS avgPriceMatched, bi.size_cancelled AS sizeCancelled, bi.size_lapsed AS sizeLapsed, bi.status, bi.result,
         bi.profit_loss AS profitLoss, bi.commission, bi.failure_code AS failureCode, bi.placed_at AS placedAt, bi.matched_at AS matchedAt, bi.settled_at AS settledAt,
         m.betfair_id AS marketId, m.name AS marketName, e.betfair_id AS eventId, e.name AS eventName, s.name AS sportName, s.slug AS sportSlug,
         bi.selection_id AS selectionId, COALESCE(mr.name, CAST(bi.selection_id AS CHAR)) AS selectionName
    FROM bet_items bi
    JOIN bets b ON b.id = bi.bet_id
    JOIN markets m ON m.id = bi.market_id
    JOIN events e ON e.id = m.event_id
    JOIN sports s ON s.id = e.sport_id
    LEFT JOIN market_runners mr ON mr.market_id = m.id AND mr.selection_id = bi.selection_id`;

export interface BetItemView {
  id: string; betId: string; side: Side; price: string; stake: string; liability: string; sizeMatched: string; avgPriceMatched: string | null;
  status: string; result: string | null; profitLoss: string | null; commission: string; failureCode: string | null; potentialProfit: string;
  placedAt: Date; settledAt: Date | null; marketId: string; marketName: string; eventId: string; eventName: string; sportName: string; selectionId: number; selectionName: string;
}

const decorate = (r: Record<string, unknown>): BetItemView => ({
  ...(r as unknown as BetItemView),
  selectionId: Number(r.selectionId),
  potentialProfit: fromCents(potentialProfit(r.side as Side, c(r.stake as string), Number(r.price))),
});

async function getBetSlip(userId: number, betId: number) {
  const bet = await queryOne<{ uuid: string; status: string; total_stake: string; total_liability: string; created_at: Date }>('SELECT * FROM bets WHERE id = ? AND user_id = ?', [betId, userId]);
  const items = (await query(`${ITEM_SELECT} WHERE bi.bet_id = ? ORDER BY bi.id`, [betId])).map(decorate);
  return { id: bet!.uuid, status: bet!.status, totalStake: bet!.total_stake, totalLiability: bet!.total_liability, createdAt: bet!.created_at, items };
}

export async function getBetItemView(userId: number, itemUuid: string) {
  const r = await queryOne(`${ITEM_SELECT} WHERE bi.uuid = ? AND bi.user_id = ?`, [itemUuid, userId]);
  if (!r) throw new AppError('NOT_FOUND', 'Bet not found');
  return decorate(r);
}

async function getBetItemViewById(id: number) {
  const r = await queryOne(`${ITEM_SELECT} WHERE bi.id = ?`, [id]);
  return r ? decorate(r) : null;
}

export interface BetFilter extends PageQuery {
  view: 'open' | 'settled' | 'all';
  range: 'today' | 'yesterday' | '7d' | '30d' | 'custom' | 'all';
  from?: string;
  to?: string;
  sport?: string;
  side?: Side;
  status?: string;
  result?: 'WIN' | 'LOSS' | 'VOID' | 'PARTIAL';
}

export async function listBets(userId: number | null, f: BetFilter) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (userId !== null) { where.push('bi.user_id = ?'); params.push(userId); }
  if (f.view === 'open') where.push(`bi.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`), params.push(...OPEN_STATUSES);
  if (f.view === 'settled') where.push(`bi.status IN ('SETTLED','VOIDED','CANCELLED','LAPSED')`);
  const { from, to } = resolveRange(f);
  const dateCol = f.view === 'settled' ? 'COALESCE(bi.settled_at, bi.updated_at)' : 'bi.placed_at';
  if (from) { where.push(`${dateCol} >= ?`); params.push(from); }
  if (to) { where.push(`${dateCol} < ?`); params.push(to); }
  if (f.sport) { where.push('s.slug = ?'); params.push(f.sport); }
  if (f.side) { where.push('bi.side = ?'); params.push(f.side); }
  if (f.status) { where.push('bi.status = ?'); params.push(f.status); }
  if (f.result) { where.push('bi.result = ?'); params.push(f.result); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM bet_items bi JOIN markets m ON m.id = bi.market_id JOIN events e ON e.id = m.event_id JOIN sports s ON s.id = e.sport_id ${w}`,
    params,
  );
  const rows = await query(`${ITEM_SELECT} ${w} ORDER BY bi.id DESC LIMIT ? OFFSET ?`, [...params, f.pageSize, offset(f)]);
  return toPage(rows.map(decorate), Number(total), f);
}


// House-book matching reuses the same order-state logic as exchange orders.
initHouseBook(applyOrderSummary);
