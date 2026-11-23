import { execute, query } from '../config/db.js';
import { getBetfair } from '../integrations/betfair/index.js';
import { bookToSnapshot } from '../integrations/betfair/marketBook.js';
import type { MarketSnapshot } from '../integrations/betfair/types.js';
import { logger } from '../utils/logger.js';

/**
 * Live price hub. Receives snapshots from the active MarketStream (Betfair
 * Stream API / polling / mock), keeps the latest book per market in memory,
 * overlays platform controls (admin suspension), persists state transitions,
 * and fans out per-market updates to the WebSocket layer.
 */
type Listener = (snap: MarketSnapshot) => void;
type ClosedListener = (snap: MarketSnapshot) => void;

const MAX_STREAM_MARKETS = 200; // Betfair default stream subscription limit

class OddsHub {
  private cache = new Map<string, MarketSnapshot>();
  private listeners = new Set<Listener>();
  private closedListeners = new Set<ClosedListener>();
  private adminSuspended = new Set<string>();
  private lastPersisted = new Map<string, string>();
  private inflight = new Map<string, Promise<MarketSnapshot | null>>();
  private timers: NodeJS.Timeout[] = [];
  private streamConnected = false;
  private started = false;

  async start() {
    if (this.started) return;
    this.started = true;
    const { stream } = await getBetfair();
    stream.onSnapshot((s) => this.ingest(s));
    stream.onStatus((c) => {
      this.streamConnected = c;
      logger.info({ ws: 'betfair-stream', connected: c }, 'market stream status');
    });
    await this.reloadAdminSuspensions();
    await this.refreshSubscriptions();
    stream.start();
    this.timers.push(setInterval(() => void this.refreshSubscriptions(), 30_000));
    this.timers.push(setInterval(() => void this.persistSnapshots(), 60_000));
    this.timers.forEach((t) => t.unref());
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.started = false;
  }

  isStreamConnected() { return this.streamConnected; }

  onUpdate(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  onClosed(l: ClosedListener) { this.closedListeners.add(l); }

  /** Markets that need live prices: in-play + next 24h + any with open bets. */
  async refreshSubscriptions() {
    try {
      const rows = await query<{ betfair_id: string }>(
        `(SELECT m.betfair_id, m.in_play, m.start_time FROM markets m JOIN events e ON e.id = m.event_id
           WHERE m.status <> 'CLOSED' AND m.is_enabled = 1 AND e.is_enabled = 1 AND m.start_time < NOW(3) + INTERVAL 24 HOUR
           ORDER BY m.in_play DESC, m.start_time ASC LIMIT ${MAX_STREAM_MARKETS})
         UNION
         (SELECT DISTINCT m.betfair_id, m.in_play, m.start_time FROM bet_items bi JOIN markets m ON m.id = bi.market_id
           WHERE bi.status IN ('PENDING','UNMATCHED','PARTIALLY_MATCHED','MATCHED'))`,
      );
      const { stream } = await getBetfair();
      stream.setSubscriptions(rows.map((r) => r.betfair_id).slice(0, MAX_STREAM_MARKETS));
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'subscription refresh failed');
    }
  }

  async reloadAdminSuspensions() {
    const rows = await query<{ betfair_id: string }>('SELECT betfair_id FROM markets WHERE admin_suspended = 1 AND status <> ?', ['CLOSED']);
    this.adminSuspended = new Set(rows.map((r) => r.betfair_id));
  }

  setAdminSuspended(marketId: string, suspended: boolean) {
    if (suspended) this.adminSuspended.add(marketId);
    else this.adminSuspended.delete(marketId);
    const snap = this.cache.get(marketId);
    if (snap) this.emit(snap);
  }

  private overlay(s: MarketSnapshot): MarketSnapshot {
    return this.adminSuspended.has(s.marketId) && s.status === 'OPEN' ? { ...s, status: 'SUSPENDED' } : s;
  }

  private emit(raw: MarketSnapshot) {
    const s = this.overlay(raw);
    for (const l of this.listeners) l(s);
  }

  /** Entry point for every price update from the stream. */
  ingest(snap: MarketSnapshot) {
    const prev = this.cache.get(snap.marketId);
    this.cache.set(snap.marketId, snap);
    this.emit(snap);
    void this.persistState(snap, prev);
    if (snap.status === 'CLOSED' && prev?.status !== 'CLOSED') {
      for (const l of this.closedListeners) l(snap);
    }
  }

  /** Current book for a market (cache first, then a one-off listMarketBook). */
  async get(marketId: string, maxAgeMs = 15_000): Promise<MarketSnapshot | null> {
    const cached = this.cache.get(marketId);
    if (cached && (this.streamConnected || Date.now() - cached.updatedAt < maxAgeMs)) return this.overlay(cached);
    let p = this.inflight.get(marketId);
    if (!p) {
      p = (async () => {
        const { client } = await getBetfair();
        const [book] = await client.listMarketBook([marketId]);
        if (!book) return null;
        const s = bookToSnapshot(book);
        this.cache.set(marketId, s);
        return s;
      })().finally(() => this.inflight.delete(marketId));
      this.inflight.set(marketId, p);
    }
    const s = await p;
    return s ? this.overlay(s) : null;
  }

  async getMany(ids: string[]) {
    const out: MarketSnapshot[] = [];
    const missing = ids.filter((id) => !this.cache.has(id));
    if (missing.length) {
      try {
        const { client } = await getBetfair();
        for (const b of await client.listMarketBook(missing.slice(0, 100))) this.cache.set(b.marketId, bookToSnapshot(b));
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'bulk market book fetch failed');
      }
    }
    for (const id of ids) {
      const s = this.cache.get(id);
      if (s) out.push(this.overlay(s));
    }
    return out;
  }

  /** Persist status / in-play / runner-status transitions (not every price tick). */
  private async persistState(s: MarketSnapshot, prev?: MarketSnapshot) {
    const sig = `${s.status}|${s.inPlay}|${s.runners.map((r) => r.status).join(',')}`;
    if (this.lastPersisted.get(s.marketId) === sig) return;
    this.lastPersisted.set(s.marketId, sig);
    try {
      await execute('UPDATE markets SET status = ?, in_play = ?, total_matched = ? WHERE betfair_id = ?', [s.status, s.inPlay ? 1 : 0, s.totalMatched.toFixed(2), s.marketId]);
      if (!prev || prev.runners.some((r, i) => r.status !== s.runners[i]?.status)) {
        for (const r of s.runners) {
          await execute(
            'UPDATE market_runners mr JOIN markets m ON m.id = mr.market_id SET mr.status = ? WHERE m.betfair_id = ? AND mr.selection_id = ?',
            [r.status, s.marketId, r.selectionId],
          );
        }
      }
      if (s.inPlay) {
        await execute(`UPDATE events e JOIN markets m ON m.event_id = e.id SET e.status = 'IN_PLAY' WHERE m.betfair_id = ? AND e.status = 'UPCOMING'`, [s.marketId]);
      }
      if (s.status === 'CLOSED') {
        await execute(
          `UPDATE events e JOIN markets m ON m.event_id = e.id SET e.status = 'CLOSED'
            WHERE m.betfair_id = ? AND NOT EXISTS (SELECT 1 FROM markets o WHERE o.event_id = e.id AND o.status <> 'CLOSED')`,
          [s.marketId],
        );
      }
    } catch (err) {
      logger.error({ marketId: s.marketId, err: (err as Error).message }, 'persist market state failed');
    }
  }

  /** Periodic top-of-book capture for in-play markets (charts / disputes). */
  private async persistSnapshots() {
    try {
      const inPlay = [...this.cache.values()].filter((s) => s.inPlay && s.status !== 'CLOSED').slice(0, 200);
      if (!inPlay.length) return;
      const ids = await query<{ id: number; betfair_id: string }>('SELECT id, betfair_id FROM markets WHERE betfair_id IN (?)', [inPlay.map((s) => s.marketId)]);
      const idMap = new Map(ids.map((r) => [r.betfair_id, r.id]));
      const values: unknown[][] = [];
      for (const s of inPlay) {
        const id = idMap.get(s.marketId);
        if (!id) continue;
        for (const r of s.runners) values.push([id, r.selectionId, r.back[0]?.price ?? null, r.back[0]?.size ?? null, r.lay[0]?.price ?? null, r.lay[0]?.size ?? null, r.lastPriceTraded]);
      }
      if (values.length) await execute('INSERT INTO odds_snapshots (market_id, selection_id, best_back, best_back_size, best_lay, best_lay_size, last_traded) VALUES ?', [values]);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'odds snapshot persist failed');
    }
  }

  /** Test helper */
  reset() {
    this.cache.clear();
    this.lastPersisted.clear();
    this.adminSuspended.clear();
  }
}

export const odds = new OddsHub();
