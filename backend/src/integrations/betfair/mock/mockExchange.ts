/**
 * DEVELOPMENT / TEST ONLY — in-memory exchange simulator implementing the same
 * BetfairClient/MarketStream contracts as the live integration.
 * Simulates: price movement, suspensions, in-play turn, runner removal,
 * order matching (full/partial/unmatched), lapsing, and market settlement.
 */
import type { BetfairClient, IntegrationStatus, MarketStream, SnapshotListener } from '../client.js';
import { BetfairError } from '../errors.js';
import type {
  CancelExecutionReport, CancelInstruction, CurrentOrderSummary, MarketBook, MarketCatalogue, MarketFilter,
  MarketSnapshot, PlaceExecutionReport, PlaceInstruction, ReplaceExecutionReport, ReplaceInstruction,
} from '../types.js';
import { buildEvent, competitionsList, ladders, rand, SPORTS, type MockEvent, type MockMarket } from './mockData.js';

interface MockOrder extends CurrentOrderSummary { placedAt: number; persistenceType: string }

export class MockExchange {
  events = new Map<string, MockEvent>();
  markets = new Map<string, MockMarket>();
  books = new Map<string, MarketSnapshot>();
  orders = new Map<string, MockOrder>();
  customerRefs = new Map<string, PlaceExecutionReport>();
  private nextBetId = 300000000000;
  private failNext: string | null = null;
  private latencyMs = 0;

  constructor(opts: { autoSimulate?: boolean } = {}) {
    const now = Date.now();
    for (const sport of SPORTS) {
      // Mix of in-play (started in the past) and upcoming events per sport.
      const offsets = [-12, -4, 20, 75, 180, 420, 1440].map((m) => m * 60_000);
      for (const off of offsets) this.addEvent(sport.id, now + off + Math.floor(rand() * 600_000));
    }
    this.refreshAll();
    if (opts.autoSimulate !== false) {
      setInterval(() => this.step(), 1000).unref();
    }
  }

  /** Test hooks */
  injectFailure(code: string) { this.failNext = code; }
  setLatency(ms: number) { this.latencyMs = ms; }

  private async guard() {
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.failNext) {
      const code = this.failNext;
      this.failNext = null;
      throw new BetfairError(code, `Injected mock failure ${code}`, code === 'TIMEOUT');
    }
  }

  addEvent(sportId: string, openDate: number) {
    const { event, markets } = buildEvent(sportId, openDate);
    this.events.set(event.eventId, event);
    for (const m of markets) {
      this.markets.set(m.marketId, m);
      this.books.set(m.marketId, this.toSnapshot(m));
    }
    return event;
  }

  private toSnapshot(m: MockMarket): MarketSnapshot {
    const active = m.status === 'OPEN';
    return {
      marketId: m.marketId,
      status: m.status,
      inPlay: m.inPlay,
      betDelay: m.inPlay ? 5 : 0,
      totalMatched: m.totalMatched,
      version: m.version,
      updatedAt: Date.now(),
      runners: m.runners.map((r) => {
        const l = r.status === 'ACTIVE' && active ? ladders(r.prob) : { back: [], lay: [] };
        return { selectionId: r.selectionId, status: r.status, lastPriceTraded: r.status === 'ACTIVE' ? l.back[0]?.price ?? null : null, totalMatched: Math.round(m.totalMatched * r.prob), back: l.back, lay: l.lay };
      }),
    };
  }

  private refresh(m: MockMarket) {
    const snap = this.toSnapshot(m);
    this.books.set(m.marketId, snap);
    return snap;
  }

  private refreshAll() {
    for (const m of this.markets.values()) this.refresh(m);
  }

  listeners: SnapshotListener[] = [];

  /** One simulation tick. Public so tests can drive time deterministically. */
  step(now = Date.now()) {
    for (const m of this.markets.values()) {
      if (m.status === 'CLOSED') continue;
      let changed = false;
      const ev = this.events.get(m.eventId)!;
      if (m.closeAtStart && now >= ev.openDate) {
        this.settle(m);
        changed = true;
      } else if (!m.inPlay && now >= m.startTime && m.turnInPlay) {
        m.inPlay = true;
        m.version++;
        this.lapseUnmatched(m.marketId);
        changed = true;
      }
      if ((m.status as string) !== 'CLOSED' && now >= m.closesAt) {
        this.settle(m);
        changed = true;
      } else if (m.status === 'SUSPENDED' && now >= m.suspendedUntil) {
        m.status = 'OPEN';
        changed = true;
      } else if (m.status === 'OPEN') {
        // In-play markets move faster and suspend occasionally (goal, wicket…).
        const volatility = m.inPlay ? 0.02 : 0.008;
        if (rand() < (m.inPlay ? 0.3 : 0.1)) {
          for (const r of m.runners) if (r.status === 'ACTIVE') r.prob = Math.max(0.005, r.prob * (1 + (rand() - 0.5) * volatility * 2));
          const active = m.runners.filter((r) => r.status === 'ACTIVE');
          const s = active.reduce((a, r) => a + r.prob, 0);
          active.forEach((r) => (r.prob /= s));
          m.totalMatched += Math.round(rand() * 2500);
          changed = true;
        }
        if (m.inPlay && rand() < 0.01) {
          m.status = 'SUSPENDED';
          m.suspendedUntil = now + 4000 + rand() * 6000;
          m.version++;
          changed = true;
        }
      }
      if (changed) {
        const snap = this.refresh(m);
        this.matchResting(m.marketId);
        this.listeners.forEach((l) => l(snap));
      }
    }
    // Keep the board populated: replace finished events with new upcoming ones.
    for (const ev of [...this.events.values()]) {
      const ms = [...this.markets.values()].filter((m) => m.eventId === ev.eventId);
      if (ms.length && ms.every((m) => m.status === 'CLOSED') && now - ev.openDate > ev.durationMs + 10 * 60_000) {
        ms.forEach((m) => { this.markets.delete(m.marketId); this.books.delete(m.marketId); });
        this.events.delete(ev.eventId);
        this.addEvent(ev.sportId, now + (60 + rand() * 600) * 60_000);
      }
    }
  }

  /** Force-close a market with a chosen winner (tests / admin demo). */
  settle(m: MockMarket, winnerSelectionId?: number) {
    const active = m.runners.filter((r) => r.status === 'ACTIVE');
    let winner = winnerSelectionId;
    if (winner === undefined) {
      let x = rand();
      for (const r of active) {
        x -= r.prob;
        if (x <= 0) { winner = r.selectionId; break; }
      }
      winner ??= active[0]?.selectionId;
    }
    for (const r of m.runners) if (r.status === 'ACTIVE') r.status = r.selectionId === winner ? 'WINNER' : 'LOSER';
    m.status = 'CLOSED';
    m.version++;
    this.lapseUnmatched(m.marketId);
    for (const o of this.orders.values()) if (o.marketId === m.marketId) o.status = 'EXECUTION_COMPLETE';
    const snap = this.refresh(m);
    this.listeners.forEach((l) => l(snap));
  }

  setMarketStatus(marketId: string, status: 'OPEN' | 'SUSPENDED') {
    const m = this.markets.get(marketId);
    if (!m || m.status === 'CLOSED') return;
    m.status = status;
    m.suspendedUntil = status === 'SUSPENDED' ? Number.MAX_SAFE_INTEGER : 0;
    m.version++;
    const snap = this.refresh(m);
    this.listeners.forEach((l) => l(snap));
  }

  private lapseUnmatched(marketId: string) {
    for (const o of this.orders.values()) {
      if (o.marketId === marketId && o.status === 'EXECUTABLE' && o.persistenceType === 'LAPSE') {
        o.sizeLapsed = Math.round((o.sizeLapsed + o.sizeRemaining) * 100) / 100;
        o.sizeRemaining = 0;
        o.status = 'EXECUTION_COMPLETE';
      }
    }
  }

  /** Try to match a (remaining) order against the current book. */
  private tryMatch(o: MockOrder) {
    const book = this.books.get(o.marketId);
    const runner = book?.runners.find((r) => r.selectionId === o.selectionId);
    if (!book || book.status !== 'OPEN' || !runner || runner.status !== 'ACTIVE' || o.sizeRemaining <= 0) return;
    const levels = o.side === 'BACK' ? runner.back.filter((l) => l.price >= o.priceSize.price) : runner.lay.filter((l) => l.price <= o.priceSize.price);
    let matchedValue = o.averagePriceMatched * o.sizeMatched;
    for (const lvl of levels) {
      if (o.sizeRemaining <= 0) break;
      const take = Math.min(lvl.size, o.sizeRemaining);
      lvl.size = Math.round((lvl.size - take) * 100) / 100;
      o.sizeMatched = Math.round((o.sizeMatched + take) * 100) / 100;
      o.sizeRemaining = Math.round((o.sizeRemaining - take) * 100) / 100;
      matchedValue += take * lvl.price;
    }
    if (o.sizeMatched > 0) o.averagePriceMatched = Math.round((matchedValue / o.sizeMatched) * 100) / 100;
    if (o.sizeRemaining <= 0) o.status = 'EXECUTION_COMPLETE';
  }

  private matchResting(marketId: string) {
    for (const o of this.orders.values()) if (o.marketId === marketId && o.status === 'EXECUTABLE') this.tryMatch(o);
  }

  // ───────────── BetfairClient surface ─────────────
  client(): BetfairClient {
    const ex = this;
    const filterMarkets = (f: MarketFilter) =>
      [...ex.markets.values()].filter((m) => {
        const ev = ex.events.get(m.eventId)!;
        if (f.marketIds && !f.marketIds.includes(m.marketId)) return false;
        if (f.eventIds && !f.eventIds.includes(ev.eventId)) return false;
        if (f.eventTypeIds && !f.eventTypeIds.includes(ev.sportId)) return false;
        if (f.competitionIds && !f.competitionIds.includes(ev.competitionId)) return false;
        if (f.inPlayOnly && !m.inPlay) return false;
        return true;
      });
    return {
      mode: 'mock',
      async listEventTypes() {
        await ex.guard();
        return SPORTS.map((s) => ({ eventType: { id: s.id, name: s.name }, marketCount: [...ex.markets.values()].filter((m) => ex.events.get(m.eventId)?.sportId === s.id).length }));
      },
      async listCompetitions(f) {
        await ex.guard();
        return competitionsList().filter((c) => !f.eventTypeIds || f.eventTypeIds.includes(c.sportId)).map((c) => ({ competition: { id: c.id, name: c.name }, competitionRegion: c.region, marketCount: 1 }));
      },
      async listEvents(f) {
        await ex.guard();
        const ids = new Set(filterMarkets(f).map((m) => m.eventId));
        return [...ids].map((id) => ex.events.get(id)!).map((e) => ({ event: { id: e.eventId, name: e.name, countryCode: e.countryCode, timezone: 'GMT', venue: e.venue, openDate: new Date(e.openDate).toISOString() }, marketCount: 1 }));
      },
      async listMarketCatalogue(f, maxResults) {
        await ex.guard();
        const comps = new Map(competitionsList().map((c) => [c.id, c]));
        return filterMarkets(f).filter((m) => m.status !== 'CLOSED').slice(0, maxResults).map((m): MarketCatalogue => {
          const e = ex.events.get(m.eventId)!;
          const c = comps.get(e.competitionId)!;
          return {
            marketId: m.marketId,
            marketName: m.name,
            marketStartTime: new Date(m.startTime).toISOString(),
            totalMatched: m.totalMatched,
            description: { bettingType: 'ODDS', marketType: m.marketType, turnInPlayEnabled: m.turnInPlay },
            runners: m.runners.map((r, i) => ({ selectionId: r.selectionId, runnerName: r.name, handicap: 0, sortPriority: i + 1 })),
            eventType: { id: e.sportId, name: SPORTS.find((s) => s.id === e.sportId)!.name },
            competition: { id: c.id, name: c.name },
            event: { id: e.eventId, name: e.name, countryCode: e.countryCode, timezone: 'GMT', venue: e.venue, openDate: new Date(e.openDate).toISOString() },
          };
        });
      },
      async listMarketBook(ids): Promise<MarketBook[]> {
        await ex.guard();
        return ids.flatMap((id) => {
          const s = ex.books.get(id);
          if (!s) return [];
          return [{
            marketId: s.marketId, isMarketDataDelayed: false, status: s.status, betDelay: s.betDelay, inplay: s.inPlay,
            numberOfActiveRunners: s.runners.filter((r) => r.status === 'ACTIVE').length, totalMatched: s.totalMatched, version: s.version,
            runners: s.runners.map((r) => ({ selectionId: r.selectionId, handicap: 0, status: r.status, lastPriceTraded: r.lastPriceTraded ?? undefined, totalMatched: r.totalMatched, ex: { availableToBack: r.back, availableToLay: r.lay } })),
          }];
        });
      },
      async placeOrders(marketId, instructions: PlaceInstruction[], customerRef): Promise<PlaceExecutionReport> {
        await ex.guard();
        const prior = ex.customerRefs.get(customerRef);
        if (prior) return { ...prior, status: 'FAILURE', errorCode: 'DUPLICATE_TRANSACTION', instructionReports: [] };
        const m = ex.markets.get(marketId);
        const fail = (errorCode: string): PlaceExecutionReport => ({ customerRef, marketId, status: 'FAILURE', errorCode, instructionReports: instructions.map((i) => ({ status: 'FAILURE', errorCode, instruction: i })) });
        if (!m || m.status === 'CLOSED') return fail('MARKET_NOT_OPEN_FOR_BETTING');
        if (m.status === 'SUSPENDED') return fail('MARKET_SUSPENDED');
        const reports = instructions.map((ins) => {
          const runner = m.runners.find((r) => r.selectionId === ins.selectionId);
          if (!runner || runner.status !== 'ACTIVE') return { status: 'FAILURE' as const, errorCode: 'RUNNER_REMOVED', instruction: ins };
          const betId = String(ex.nextBetId++);
          const o: MockOrder = {
            betId, marketId, selectionId: ins.selectionId, side: ins.side, priceSize: { price: ins.limitOrder.price, size: ins.limitOrder.size },
            status: 'EXECUTABLE', averagePriceMatched: 0, sizeMatched: 0, sizeRemaining: ins.limitOrder.size, sizeLapsed: 0, sizeCancelled: 0, sizeVoided: 0,
            customerOrderRef: ins.customerOrderRef, placedAt: Date.now(), persistenceType: ins.limitOrder.persistenceType,
          };
          ex.orders.set(betId, o);
          ex.tryMatch(o);
          return { status: 'SUCCESS' as const, instruction: ins, betId, placedDate: new Date().toISOString(), orderStatus: o.status, sizeMatched: o.sizeMatched, averagePriceMatched: o.averagePriceMatched || undefined };
        });
        const report: PlaceExecutionReport = { customerRef, marketId, status: reports.every((r) => r.status === 'SUCCESS') ? 'SUCCESS' : 'FAILURE', errorCode: reports.find((r) => r.errorCode)?.errorCode, instructionReports: reports };
        ex.customerRefs.set(customerRef, report);
        return report;
      },
      async cancelOrders(marketId, instructions: CancelInstruction[]): Promise<CancelExecutionReport> {
        await ex.guard();
        const reports = instructions.map((ins) => {
          const o = ex.orders.get(ins.betId);
          if (!o || o.status !== 'EXECUTABLE') return { status: 'FAILURE' as const, errorCode: 'BET_TAKEN_OR_LAPSED', instruction: ins, sizeCancelled: 0 };
          const size = Math.min(ins.sizeReduction ?? o.sizeRemaining, o.sizeRemaining);
          o.sizeRemaining = Math.round((o.sizeRemaining - size) * 100) / 100;
          o.sizeCancelled = Math.round((o.sizeCancelled + size) * 100) / 100;
          if (o.sizeRemaining <= 0) o.status = 'EXECUTION_COMPLETE';
          return { status: 'SUCCESS' as const, instruction: ins, sizeCancelled: size, cancelledDate: new Date().toISOString() };
        });
        return { marketId, status: reports.every((r) => r.status === 'SUCCESS') ? 'SUCCESS' : 'FAILURE', instructionReports: reports };
      },
      async replaceOrders(marketId, instructions: ReplaceInstruction[]): Promise<ReplaceExecutionReport> {
        await ex.guard();
        const reports = instructions.map((ins) => {
          const o = ex.orders.get(ins.betId);
          if (!o || o.status !== 'EXECUTABLE') return { status: 'FAILURE' as const, errorCode: 'BET_TAKEN_OR_LAPSED' };
          const remaining = o.sizeRemaining;
          o.sizeCancelled += remaining;
          o.sizeRemaining = 0;
          o.status = 'EXECUTION_COMPLETE';
          const betId = String(ex.nextBetId++);
          const n: MockOrder = { ...o, betId, priceSize: { price: ins.newPrice, size: remaining }, status: 'EXECUTABLE', sizeMatched: 0, averagePriceMatched: 0, sizeRemaining: remaining, sizeCancelled: 0, sizeLapsed: 0, placedAt: Date.now() };
          ex.orders.set(betId, n);
          ex.tryMatch(n);
          return {
            status: 'SUCCESS' as const,
            cancelInstructionReport: { sizeCancelled: remaining },
            placeInstructionReport: { status: 'SUCCESS' as const, betId, orderStatus: n.status, sizeMatched: n.sizeMatched, averagePriceMatched: n.averagePriceMatched, instruction: { orderType: 'LIMIT' as const, selectionId: n.selectionId, side: n.side, limitOrder: { size: remaining, price: ins.newPrice, persistenceType: 'LAPSE' as const } } },
          };
        });
        return { marketId, status: reports.every((r) => r.status === 'SUCCESS') ? 'SUCCESS' : 'FAILURE', instructionReports: reports };
      },
      async listCurrentOrders(p) {
        await ex.guard();
        return [...ex.orders.values()].filter((o) => (!p.betIds || p.betIds.includes(o.betId)) && (!p.customerOrderRefs || (o.customerOrderRef && p.customerOrderRefs.includes(o.customerOrderRef))) && (!p.marketIds || p.marketIds.includes(o.marketId)));
      },
      async getAccountFunds() {
        await ex.guard();
        return { availableToBetBalance: 1_000_000, exposure: 0, retainedCommission: 0, exposureLimit: -10_000_000 };
      },
      status(): IntegrationStatus {
        return { mode: 'mock', sessionValid: true, streamConnected: true, lastError: null, lastSuccessAt: Date.now() };
      },
    };
  }

  stream(): MarketStream {
    const ex = this;
    let subs = new Set<string>();
    const statusListeners: Array<(c: boolean) => void> = [];
    return {
      start() { statusListeners.forEach((l) => l(true)); },
      stop() {},
      setSubscriptions(ids) { subs = new Set(ids); },
      onSnapshot(l) { ex.listeners.push((s) => (subs.size === 0 || subs.has(s.marketId)) && l(s)); },
      onStatus(l) { statusListeners.push(l); },
      isConnected: () => true,
    };
  }
}
