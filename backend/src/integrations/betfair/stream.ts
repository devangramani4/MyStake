import tls from 'node:tls';
import { logger } from '../../utils/logger.js';
import type { BetfairSession } from './auth.js';
import type { MarketStream, SnapshotListener } from './client.js';
import type { MarketBook, MarketSnapshot, MarketStatus, PriceSize, RunnerStatus } from './types.js';
import { bookToSnapshot } from './marketBook.js';

/**
 * Betfair Exchange Stream API client.
 * Protocol: CRLF-delimited JSON over TLS (stream-api.betfair.com:443).
 *   connection → authentication → marketSubscription → mcm (SUB_IMAGE / deltas / HEARTBEAT)
 * Maintains a local price cache, merges deltas, and resumes with clk/initialClk
 * after reconnects so no updates are missed.
 */

type Ladder = Map<number, PriceSize>; // level → price/size

interface RunnerCache { status: RunnerStatus; ltp: number | null; tv: number; batb: Ladder; batl: Ladder }
interface MarketCache { status: MarketStatus; inPlay: boolean; betDelay: number; tv: number; version: number; runners: Map<number, RunnerCache> }

interface Mcm {
  op: 'mcm';
  id?: number;
  ct?: 'SUB_IMAGE' | 'RESUB_DELTA' | 'HEARTBEAT';
  initialClk?: string;
  clk?: string;
  heartbeatMs?: number;
  mc?: Array<{
    id: string;
    img?: boolean;
    tv?: number;
    marketDefinition?: { status: MarketStatus; inPlay: boolean; betDelay: number; version: number; runners: Array<{ id: number; status: RunnerStatus }> };
    rc?: Array<{ id: number; ltp?: number; tv?: number; batb?: [number, number, number][]; batl?: [number, number, number][]; img?: boolean }>;
  }>;
}

const HEARTBEAT_MS = 5000;

export class BetfairStream implements MarketStream {
  private socket: tls.TLSSocket | null = null;
  private buffer = '';
  private markets = new Map<string, MarketCache>();
  private subscriptions: string[] = [];
  private initialClk: string | undefined;
  private clk: string | undefined;
  private connected = false;
  private stopped = true;
  private reqId = 1;
  private reconnectAttempt = 0;
  private watchdog: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;
  private snapshotListeners: SnapshotListener[] = [];
  private statusListeners: Array<(c: boolean) => void> = [];

  constructor(
    private readonly session: BetfairSession,
    private readonly host: string,
  ) {}

  onSnapshot(l: SnapshotListener) { this.snapshotListeners.push(l); }
  onStatus(l: (c: boolean) => void) { this.statusListeners.push(l); }
  isConnected() { return this.connected; }

  start() {
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    this.watchdog && clearInterval(this.watchdog);
    this.socket?.destroy();
  }

  setSubscriptions(marketIds: string[]) {
    const next = [...new Set(marketIds)].sort();
    if (next.join() === this.subscriptions.join()) return;
    this.subscriptions = next;
    // A new subscription replaces the previous one; clocks reset for a fresh image.
    this.initialClk = undefined;
    this.clk = undefined;
    if (this.connected) this.subscribe();
  }

  private setConnected(v: boolean) {
    if (this.connected === v) return;
    this.connected = v;
    this.statusListeners.forEach((l) => l(v));
  }

  private send(msg: Record<string, unknown>) {
    this.socket?.write(JSON.stringify({ ...msg, id: this.reqId++ }) + '\r\n');
  }

  private async connect() {
    if (this.stopped) return;
    let token: string;
    try {
      token = await this.session.getToken();
    } catch (err) {
      logger.error({ integration: 'betfair-stream', err: (err as Error).message }, 'stream login failed');
      return this.scheduleReconnect();
    }
    const socket = tls.connect({ host: this.host, port: 443, servername: this.host });
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.lastMessageAt = Date.now();
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf('\r\n')) >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        if (line) this.handle(JSON.parse(line), token);
      }
    });
    socket.on('error', (e) => logger.warn({ integration: 'betfair-stream', err: e.message }, 'stream socket error'));
    socket.on('close', () => {
      this.setConnected(false);
      this.buffer = '';
      this.scheduleReconnect();
    });
    this.watchdog && clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (this.connected && Date.now() - this.lastMessageAt > HEARTBEAT_MS * 3) {
        logger.warn({ integration: 'betfair-stream' }, 'stream heartbeat missed; reconnecting');
        socket.destroy();
      }
    }, HEARTBEAT_MS);
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const delay = Math.min(30_000, 500 * 2 ** this.reconnectAttempt++);
    logger.info({ integration: 'betfair-stream', delay }, 'stream reconnect scheduled');
    setTimeout(() => void this.connect(), delay).unref();
  }

  private subscribe() {
    if (!this.subscriptions.length) return;
    this.send({
      op: 'marketSubscription',
      initialClk: this.initialClk,
      clk: this.clk,
      heartbeatMs: HEARTBEAT_MS,
      conflateMs: 0,
      marketFilter: { marketIds: this.subscriptions.slice(0, 200) },
      marketDataFilter: { fields: ['EX_BEST_OFFERS', 'EX_MARKET_DEF', 'EX_LTP', 'EX_TRADED_VOL'], ladderLevels: 3 },
    });
  }

  private handle(msg: Record<string, unknown>, token: string) {
    switch (msg.op) {
      case 'connection':
        this.send({ op: 'authentication', appKey: this.session.appKey, session: token });
        break;
      case 'status':
        if (msg.statusCode === 'FAILURE') {
          logger.error({ integration: 'betfair-stream', errorCode: msg.errorCode }, 'stream status failure');
          if (msg.errorCode === 'INVALID_SESSION_INFORMATION' || msg.errorCode === 'NO_SESSION') this.session.invalidate();
          this.socket?.destroy();
        } else if (!this.connected) {
          this.reconnectAttempt = 0;
          this.setConnected(true);
          this.subscribe();
        }
        break;
      case 'mcm':
        this.handleMcm(msg as unknown as Mcm);
        break;
    }
  }

  private handleMcm(msg: Mcm) {
    if (msg.initialClk) this.initialClk = msg.initialClk;
    if (msg.clk) this.clk = msg.clk;
    if (msg.ct === 'HEARTBEAT' || !msg.mc) return;
    for (const mc of msg.mc) {
      let m = this.markets.get(mc.id);
      if (!m || mc.img) {
        m = { status: 'OPEN', inPlay: false, betDelay: 0, tv: 0, version: 0, runners: new Map() };
        this.markets.set(mc.id, m);
      }
      if (mc.tv !== undefined) m.tv = mc.tv;
      const def = mc.marketDefinition;
      if (def) {
        m.status = def.status;
        m.inPlay = def.inPlay;
        m.betDelay = def.betDelay;
        m.version = def.version;
        for (const r of def.runners) this.runner(m, r.id).status = r.status;
      }
      for (const rc of mc.rc ?? []) {
        const r = this.runner(m, rc.id);
        if (rc.img) { r.batb.clear(); r.batl.clear(); }
        if (rc.ltp !== undefined) r.ltp = rc.ltp;
        if (rc.tv !== undefined) r.tv = rc.tv;
        applyLadder(r.batb, rc.batb);
        applyLadder(r.batl, rc.batl);
      }
      const snap = this.toSnapshot(mc.id, m);
      this.snapshotListeners.forEach((l) => l(snap));
      if (m.status === 'CLOSED') this.markets.delete(mc.id);
    }
  }

  private runner(m: MarketCache, id: number): RunnerCache {
    let r = m.runners.get(id);
    if (!r) {
      r = { status: 'ACTIVE', ltp: null, tv: 0, batb: new Map(), batl: new Map() };
      m.runners.set(id, r);
    }
    return r;
  }

  private toSnapshot(marketId: string, m: MarketCache): MarketSnapshot {
    const ladder = (l: Ladder) => [...l.entries()].sort((a, b) => a[0] - b[0]).map(([, ps]) => ps);
    return {
      marketId,
      status: m.status,
      inPlay: m.inPlay,
      betDelay: m.betDelay,
      totalMatched: m.tv,
      version: m.version,
      updatedAt: Date.now(),
      runners: [...m.runners.entries()].map(([selectionId, r]) => ({
        selectionId,
        status: r.status,
        lastPriceTraded: r.ltp,
        totalMatched: r.tv,
        back: ladder(r.batb),
        lay: ladder(r.batl),
      })),
    };
  }
}

/** Level-based ladder delta: size 0 removes the level. */
function applyLadder(ladder: Ladder, updates?: [number, number, number][]) {
  for (const [level, price, size] of updates ?? []) {
    if (size === 0) ladder.delete(level);
    else ladder.set(level, { price, size });
  }
}

/**
 * Fallback feed when streaming is disabled: polls listMarketBook for the
 * subscribed markets and emits snapshots only when the market version or prices change.
 */
export class PollingStream implements MarketStream {
  private timer: NodeJS.Timeout | null = null;
  private subs: string[] = [];
  private last = new Map<string, string>();
  private connected = false;
  private snapshotListeners: SnapshotListener[] = [];
  private statusListeners: Array<(c: boolean) => void> = [];

  constructor(private readonly fetchBooks: (ids: string[]) => Promise<MarketBook[]>, private readonly intervalMs = 1000) {}

  onSnapshot(l: SnapshotListener) { this.snapshotListeners.push(l); }
  onStatus(l: (c: boolean) => void) { this.statusListeners.push(l); }
  isConnected() { return this.connected; }
  setSubscriptions(ids: string[]) { this.subs = [...new Set(ids)]; }

  start() {
    const tick = async () => {
      try {
        if (this.subs.length) {
          const books = await this.fetchBooks(this.subs);
          for (const b of books) {
            const snap = bookToSnapshot(b);
            const sig = JSON.stringify([snap.status, snap.inPlay, snap.runners]);
            if (this.last.get(b.marketId) !== sig) {
              this.last.set(b.marketId, sig);
              this.snapshotListeners.forEach((l) => l(snap));
            }
          }
        }
        this.setConnected(true);
      } catch {
        this.setConnected(false);
      }
      this.timer = setTimeout(tick, this.intervalMs);
      this.timer.unref();
    };
    void tick();
  }

  stop() { this.timer && clearTimeout(this.timer); }

  private setConnected(v: boolean) {
    if (this.connected !== v) {
      this.connected = v;
      this.statusListeners.forEach((l) => l(v));
    }
  }
}
