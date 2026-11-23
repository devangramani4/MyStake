import { execute, query, queryOne, withTransaction } from '../config/db.js';
import { getBetfair } from '../integrations/betfair/index.js';
import type { MarketSnapshot, RunnerStatus } from '../integrations/betfair/types.js';
import type { BetItemRow } from '../models/types.js';
import { AppError } from '../utils/errors.js';
import { bus } from '../utils/eventBus.js';
import { commissionOn, settlePnl } from '../utils/exchange.js';
import { logger } from '../utils/logger.js';
import { fromCents, toCents, type Cents } from '../utils/money.js';
import { audit } from './auditService.js';
import { heldFor, reconcileOpenOrders } from './betService.js';
import { notify } from './notificationService.js';
import { getSetting } from './settingsService.js';
import { applyLedger, publishWallet } from './walletService.js';

export type Outcome = { type: 'RESULT'; runners: Map<number, RunnerStatus> } | { type: 'VOID' };

const SETTLEABLE = ['UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED'];
const settling = new Set<string>();

/** Derive an outcome from a closed market book; null if results aren't final yet. */
export function outcomeFromSnapshot(s: MarketSnapshot): Outcome | null {
  if (s.status !== 'CLOSED') return null;
  const statuses = s.runners.map((r) => r.status);
  if (statuses.some((st) => st === 'ACTIVE')) return null; // closed but not yet resulted
  if (statuses.every((st) => st === 'REMOVED' || st === 'REMOVED_VACANT')) return { type: 'VOID' };
  return { type: 'RESULT', runners: new Map(s.runners.map((r) => [r.selectionId, r.status])) };
}

/**
 * Settle every open bet item on a market. Safe to run repeatedly:
 *  - each item is locked and re-checked inside its own transaction,
 *  - `settlements.bet_item_id` is UNIQUE,
 *  - ledger rows use deterministic idempotency keys.
 * Commission is charged on each user's net positive P&L for the market.
 */
export async function settleMarket(betfairMarketId: string, outcome: Outcome, opts: { source?: 'AUTO' | 'MANUAL'; adminId?: number; reason?: string } = {}) {
  if (settling.has(betfairMarketId)) return { settled: 0, skipped: 0 };
  settling.add(betfairMarketId);
  try {
    const market = await queryOne<{ id: number; name: string; event_name: string }>(
      'SELECT m.id, m.name, e.name AS event_name FROM markets m JOIN events e ON e.id = m.event_id WHERE m.betfair_id = ?',
      [betfairMarketId],
    );
    if (!market) throw new AppError('NOT_FOUND', 'Market not found');
    const { rate } = await getSetting('commission');

    const pendingCount = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM bet_items WHERE market_id = ? AND status = 'PENDING'`, [market.id]);
    if (Number(pendingCount?.n) > 0) {
      // Resolve ambiguous placements first; anything still pending is retried next run.
      await reconcileOpenOrders().catch(() => undefined);
    }

    const users = await query<{ user_id: number }>(`SELECT DISTINCT user_id FROM bet_items WHERE market_id = ? AND status IN (?)`, [market.id, SETTLEABLE]);
    let settled = 0;
    for (const { user_id: userId } of users) {
      const results = await withTransaction(async (conn) => {
        const items = await query<BetItemRow>(`SELECT * FROM bet_items WHERE market_id = ? AND user_id = ? AND status IN (?) ORDER BY id FOR UPDATE`, [market.id, userId, SETTLEABLE], conn);
        const computed = items.map((item) => {
          const held = heldFor(item);
          const matched = toCents(item.size_matched);
          const avg = Number(item.avg_price_matched ?? item.requested_price);
          const runnerStatus = outcome.type === 'RESULT' ? outcome.runners.get(Number(item.selection_id)) : undefined;
          const voided = outcome.type === 'VOID' || runnerStatus === 'REMOVED' || runnerStatus === 'REMOVED_VACANT' || runnerStatus === undefined || matched === 0;
          const won = runnerStatus === 'WINNER' || runnerStatus === 'PLACED';
          const pnl: Cents = voided ? 0 : settlePnl(item.side, matched, avg, won);
          const unmatchedRefund = matched < toCents(item.stake) - toCents(item.size_cancelled) - toCents(item.size_lapsed);
          const result = voided ? 'VOID' : unmatchedRefund ? 'PARTIAL' : pnl > 0 ? 'WIN' : 'LOSS';
          return { item, held, pnl, result: result as 'WIN' | 'LOSS' | 'VOID' | 'PARTIAL' };
        });
        // Commission on net market winnings, allocated pro-rata to winning items.
        const net = computed.reduce((a, r) => a + r.pnl, 0);
        const commission = commissionOn(net, rate);
        const winners = computed.filter((r) => r.pnl > 0);
        const grossWins = winners.reduce((a, r) => a + r.pnl, 0);
        let allocated = 0;
        const commissionFor = new Map<number, Cents>();
        winners.forEach((r, i) => {
          const share = i === winners.length - 1 ? commission - allocated : Math.round((commission * r.pnl) / grossWins);
          allocated += share;
          commissionFor.set(r.item.id, share);
        });

        for (const r of computed) {
          const credit = r.held + r.pnl;
          const itemCommission = commissionFor.get(r.item.id) ?? 0;
          await execute(
            'INSERT INTO settlements (bet_item_id, market_id, result, gross_pnl, commission, credited_amount, source, settled_by_admin) VALUES (?,?,?,?,?,?,?,?)',
            [r.item.id, market.id, r.result, fromCents(r.pnl), fromCents(itemCommission), fromCents(credit - itemCommission), opts.source ?? 'AUTO', opts.adminId ?? null],
            conn,
          );
          await execute(
            'UPDATE bet_items SET status = ?, result = ?, profit_loss = ?, commission = ?, settled_at = NOW(3) WHERE id = ?',
            [r.result === 'VOID' ? 'VOIDED' : 'SETTLED', r.result, fromCents(r.pnl), fromCents(itemCommission), r.item.id],
            conn,
          );
          await applyLedger(conn, {
            userId, type: r.pnl > 0 ? 'WIN' : r.pnl < 0 ? 'LOSS' : 'REFUND', amount: credit, exposureChange: -r.held,
            idempotencyKey: `settle:${r.item.uuid}`, referenceType: 'bet_item', referenceId: r.item.uuid,
            description: `${market.event_name} — ${market.name}: ${r.result}`,
          });
        }
        if (commission > 0) {
          await applyLedger(conn, { userId, type: 'COMMISSION', amount: -commission, idempotencyKey: `commission:${betfairMarketId}:${userId}:${computed.map((r) => r.item.id).join('-')}`, referenceType: 'market', referenceId: betfairMarketId, description: `Commission ${(rate * 100).toFixed(1)}% on net winnings` });
        }
        return { computed, net, commission };
      });
      if (!results.computed.length) continue;
      settled += results.computed.length;
      const netAfter = results.net - results.commission;
      await notify(userId, 'BET_SETTLED', 'Bets settled', `${market.event_name} — ${market.name}: ${netAfter > 0 ? `you won ${fromCents(netAfter)}` : netAfter < 0 ? `net loss ${fromCents(-netAfter)}` : 'stakes returned'}.`);
      bus.toUser(userId, { type: 'bet', bet: { settledMarketId: betfairMarketId } });
      await publishWallet(userId);
    }

    const remaining = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM bet_items WHERE market_id = ? AND status IN ('PENDING', ?)`, [market.id, SETTLEABLE]);
    if (Number(remaining?.n) === 0) {
      await execute(`UPDATE markets SET status = 'CLOSED', settled_at = COALESCE(settled_at, NOW(3)) WHERE id = ?`, [market.id]);
    }
    if (opts.source === 'MANUAL') {
      await audit({ actorType: 'ADMIN', actorId: opts.adminId, action: outcome.type === 'VOID' ? 'MARKET_VOIDED' : 'MARKET_SETTLED_MANUAL', targetType: 'market', targetId: betfairMarketId, after: outcome.type === 'RESULT' ? Object.fromEntries(outcome.runners) : { void: true }, reason: opts.reason });
    }
    logger[settled ? 'info' : 'debug']({ settlement: { marketId: betfairMarketId, outcome: outcome.type, items: settled, source: opts.source ?? 'AUTO' } }, 'market settled');
    return { settled, skipped: Number(remaining?.n ?? 0) };
  } finally {
    settling.delete(betfairMarketId);
  }
}

export async function settleFromSnapshot(s: MarketSnapshot) {
  const outcome = outcomeFromSnapshot(s);
  if (!outcome) return null;
  return settleMarket(s.marketId, outcome);
}

/** Job: settle closed markets that still have open bets (covers restarts / missed stream messages). */
export async function settlePendingMarkets() {
  const markets = await query<{ betfair_id: string }>(
    `SELECT DISTINCT m.betfair_id FROM markets m JOIN bet_items bi ON bi.market_id = m.id
      WHERE bi.status IN ('UNMATCHED','PARTIALLY_MATCHED','MATCHED') AND (m.status = 'CLOSED' OR m.start_time < NOW(3) - INTERVAL 1 HOUR)
      LIMIT 100`,
  );
  if (!markets.length) return;
  const { client } = await getBetfair();
  const books = await client.listMarketBook(markets.map((m) => m.betfair_id));
  const { bookToSnapshot } = await import('../integrations/betfair/marketBook.js');
  for (const b of books) {
    try {
      await settleFromSnapshot(bookToSnapshot(b));
    } catch (err) {
      logger.error({ marketId: b.marketId, err: (err as Error).message }, 'settlement failed');
    }
  }
}
