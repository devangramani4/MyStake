import type { PoolConnection } from 'mysql2/promise';
import { query, queryOne, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import type { MarketSnapshot } from '../integrations/betfair/types.js';
import type { BetItemRow } from '../models/types.js';
import { AppError } from '../utils/errors.js';
import { bus } from '../utils/eventBus.js';
import { settlePnl, type Side } from '../utils/exchange.js';
import { logger } from '../utils/logger.js';
import { fromCents, toCents, type Cents } from '../utils/money.js';
import { getSetting } from './settingsService.js';

/**
 * HOUSE BOOK (BET_EXECUTION_MODE=house)
 *
 * Bets never leave the platform. The platform is the counterparty to every
 * bet; Betfair is only the source of prices and results:
 *   - a bet is matched immediately, at the customer's requested odds, if
 *     Betfair currently shows that price or better on the same side;
 *   - otherwise (and only if the customer chose "keep") it waits UNMATCHED and
 *     is matched as soon as the Betfair price reaches it;
 *   - unmatched bets lapse when the market turns in-play, a runner is removed,
 *     or the market closes;
 *   - settlement uses the Betfair result (WINNER/LOSER) exactly as before.
 */
export const isHouseMode = () => env.BET_EXECUTION_MODE === 'house';

/** Is `price` currently available for this side on the Betfair book? */
export function priceAvailable(snap: MarketSnapshot, selectionId: number, side: Side, price: number): boolean {
  const r = snap.runners.find((x) => x.selectionId === selectionId);
  if (!r || r.status !== 'ACTIVE' || snap.status !== 'OPEN') return false;
  const best = side === 'BACK' ? r.back[0]?.price : r.lay[0]?.price;
  if (best === undefined) return false;
  return side === 'BACK' ? best >= price : best <= price;
}

// ───────── Matching unmatched bets as prices move ─────────
const watching = new Set<string>();
type Applier = (conn: PoolConnection, itemId: number, o: { sizeMatched: number; averagePriceMatched: number; sizeCancelled: number; sizeLapsed: number; sizeVoided: number }) => Promise<void>;
let applySummary: Applier;

export function initHouseBook(apply: Applier) {
  applySummary = apply;
}

export function watchMarket(marketId: string) {
  watching.add(marketId);
}

export async function loadWatchedMarkets() {
  const rows = await query<{ betfair_id: string }>(
    `SELECT DISTINCT m.betfair_id FROM bet_items bi JOIN markets m ON m.id = bi.market_id WHERE bi.status = 'UNMATCHED'`,
  );
  rows.forEach((r) => watching.add(r.betfair_id));
}

export const watchedMarkets = () => [...watching];

/**
 * Match or lapse a single item under a row lock. Returns what happened.
 * The status re-check inside the lock makes this safe against a concurrent cancel.
 */
export async function resolveItem(itemId: number, snap: MarketSnapshot, marketStart: Date | null): Promise<'MATCHED' | 'LAPSED' | null> {
  return withTransaction(async (conn) => {
    const item = await queryOne<BetItemRow>('SELECT * FROM bet_items WHERE id = ? FOR UPDATE', [itemId], conn);
    if (!item || (item.status !== 'UNMATCHED' && item.status !== 'PENDING')) return null;
    const stake = toCents(item.stake) - toCents(item.size_cancelled);
    const price = Number(item.requested_price);
    const runner = snap.runners.find((r) => r.selectionId === Number(item.selection_id));
    const turnedInPlay = snap.inPlay && marketStart !== null && item.placed_at < marketStart;
    if (snap.status === 'CLOSED' || turnedInPlay || (runner && runner.status !== 'ACTIVE')) {
      await applySummary(conn, item.id, { sizeMatched: 0, averagePriceMatched: 0, sizeCancelled: toCents(item.size_cancelled) / 100, sizeLapsed: stake / 100, sizeVoided: 0 });
      return 'LAPSED';
    }
    if (priceAvailable(snap, Number(item.selection_id), item.side, price)) {
      await applySummary(conn, item.id, { sizeMatched: stake / 100, averagePriceMatched: price, sizeCancelled: toCents(item.size_cancelled) / 100, sizeLapsed: 0, sizeVoided: 0 });
      return 'MATCHED';
    }
    return null;
  });
}

/** Called for every price update (and by a fallback timer) — cheap when nothing is waiting. */
export async function processMarket(snap: MarketSnapshot) {
  if (!isHouseMode() || !watching.has(snap.marketId)) return;
  const items = await query<{ id: number; user_id: number; start_time: Date }>(
    `SELECT bi.id, bi.user_id, m.start_time FROM bet_items bi JOIN markets m ON m.id = bi.market_id
      WHERE m.betfair_id = ? AND bi.status = 'UNMATCHED'`,
    [snap.marketId],
  );
  if (!items.length) {
    watching.delete(snap.marketId);
    return;
  }
  const touched = new Set<number>();
  for (const it of items) {
    try {
      const r = await resolveItem(it.id, snap, it.start_time);
      if (r) {
        touched.add(it.user_id);
        logger.info({ bet: { itemId: it.id, marketId: snap.marketId, outcome: r, mode: 'house' } }, 'house order update');
      }
    } catch (err) {
      logger.error({ itemId: it.id, err: (err as Error).message }, 'house matching failed');
    }
  }
  for (const userId of touched) {
    bus.toUser(userId, { type: 'bet', bet: { marketId: snap.marketId } });
    const { publishWallet } = await import('./walletService.js');
    await publishWallet(userId);
  }
}

// ───────── House risk: worst-case loss per market ─────────
export interface Position { selectionId: number; side: Side; stake: Cents; price: number }

/**
 * The house's loss if each runner wins = sum of customers' P&L in that outcome.
 * Unmatched bets are included (they may still match) so the limit is conservative.
 */
export function worstCaseLoss(positions: Position[], runnerIds: number[]): { worst: Cents; byRunner: Record<number, Cents> } {
  const byRunner: Record<number, Cents> = {};
  for (const w of runnerIds) {
    byRunner[w] = positions.reduce((sum, p) => sum + settlePnl(p.side, p.stake, p.price, p.selectionId === w), 0);
  }
  const worst = Math.max(0, ...Object.values(byRunner));
  return { worst, byRunner };
}

export async function marketPositions(marketDbId: number, conn?: PoolConnection) {
  const items = await query<{ selection_id: number; side: Side; stake: string; size_cancelled: string; size_lapsed: string; requested_price: string; avg_price_matched: string | null }>(
    `SELECT selection_id, side, stake, size_cancelled, size_lapsed, requested_price, avg_price_matched FROM bet_items
      WHERE market_id = ? AND status IN ('PENDING','UNMATCHED','PARTIALLY_MATCHED','MATCHED')`,
    [marketDbId],
    conn,
  );
  const runners = await query<{ selection_id: number }>('SELECT selection_id FROM market_runners WHERE market_id = ?', [marketDbId], conn);
  return {
    positions: items.map((i) => ({ selectionId: Number(i.selection_id), side: i.side, stake: toCents(i.stake) - toCents(i.size_cancelled) - toCents(i.size_lapsed), price: Number(i.avg_price_matched ?? i.requested_price) })),
    runnerIds: runners.map((r) => Number(r.selection_id)),
  };
}

/** Reject a bet that would push the house's worst-case loss on a market over the limit. Call inside the placement transaction. */
export async function assertMarketCapacity(conn: PoolConnection, marketDbIds: number[], incoming: Array<Position & { marketDbId: number }>) {
  const { maxMarketLiability } = await getSetting('risk.defaults');
  // Serialise placements per market so two bets can't both pass the check.
  for (const id of [...new Set(marketDbIds)].sort((a, b) => a - b)) await query('SELECT id FROM markets WHERE id = ? FOR UPDATE', [id], conn);
  for (const id of new Set(marketDbIds)) {
    const { positions, runnerIds } = await marketPositions(id, conn);
    const before = worstCaseLoss(positions, runnerIds).worst;
    const after = worstCaseLoss([...positions, ...incoming.filter((i) => i.marketDbId === id)], runnerIds).worst;
    // Bets that reduce house risk are always allowed.
    if (after > before && after > toCents(maxMarketLiability)) {
      throw new AppError('LIMIT_EXCEEDED', 'This market has reached its betting limit. Try a smaller stake.', { maxMarketLiability: fromCents(toCents(maxMarketLiability)) });
    }
  }
}
