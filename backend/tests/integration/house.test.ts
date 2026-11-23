import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { query, queryOne } from '../../src/config/db.js';
import { env } from '../../src/config/env.js';
import { getBetfair } from '../../src/integrations/betfair/index.js';
import type { MockExchange } from '../../src/integrations/betfair/mock/mockExchange.js';
import { processMarket } from '../../src/services/houseBookService.js';
import { odds } from '../../src/services/oddsService.js';
import { settleMarket } from '../../src/services/settlementService.js';
import { execute } from '../../src/config/db.js';
import { tick } from '../../src/utils/exchange.js';
import { api, bearer, createAdmin, createUser, idem, resetWorld, wallet } from '../helpers.js';

let ex: MockExchange;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];
const used = new Set<string>();

beforeAll(async () => {
  env.BET_EXECUTION_MODE = 'house';
  ex = await resetWorld();
  const { client } = await getBetfair();
  for (const fn of ['placeOrders', 'cancelOrders', 'replaceOrders', 'listCurrentOrders'] as const) spies.push(vi.spyOn(client, fn));
});
afterAll(() => {
  env.BET_EXECUTION_MODE = 'exchange';
});

function fresh() {
  const m = [...ex.markets.values()].find((x) => x.status === 'OPEN' && !x.inPlay && x.marketType === 'MATCH_ODDS' && x.runners.length === 2 && !used.has(x.marketId))!;
  used.add(m.marketId);
  const b = ex.books.get(m.marketId)!;
  return { m, a: b.runners[0], b: b.runners[1] };
}
const place = (token: string, item: object, policy = 'REJECT') =>
  api().post('/api/bets').set(bearer(token)).set('Idempotency-Key', idem()).send({ items: [item], unmatchedPolicy: policy });

describe('house book — bets stay on the platform', () => {
  it('matches locally at the requested odds and never calls Betfair order APIs', async () => {
    const u = await createUser({ balance: 1000 });
    const { m, a } = fresh();
    const res = await place(u.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'BACK', price: a.back[0].price, stake: 100 });
    expect(res.status).toBe(201);
    expect(res.body.bet.items[0]).toMatchObject({ status: 'MATCHED', sizeMatched: '100.00', avgPriceMatched: a.back[0].price.toFixed(2) });
    expect(await wallet(u.id)).toEqual({ balance: 900, exposure: 100 });
    expect(await query('SELECT id FROM bet_orders')).toHaveLength(0);
    spies.forEach((s) => expect(s).not.toHaveBeenCalled());
  });

  it('takes stakes larger than Betfair liquidity (the house is the counterparty)', async () => {
    const u = await createUser({ balance: 100000 });
    const { m, a } = fresh();
    const res = await place(u.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'LAY', price: a.lay[0].price, stake: Math.ceil(a.lay[0].size) + 500 });
    expect(res.body.bet.items[0].status).toBe('MATCHED');
  });

  it('still rejects when the odds moved (REJECT), or waits and matches when the price comes back (KEEP)', async () => {
    const u = await createUser({ balance: 1000 });
    const { m, a } = fresh();
    const better = tick(tick(a.back[0].price, 1), 1);
    expect((await place(u.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'BACK', price: better, stake: 50 })).body.error.code).toBe('ODDS_CHANGED');

    const kept = await place(u.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'BACK', price: better, stake: 50 }, 'KEEP');
    expect(kept.body.bet.items[0].status).toBe('UNMATCHED');
    expect((await wallet(u.id)).exposure).toBe(50);

    // Betfair price drifts out to our requested odds → the waiting bet is matched.
    const cur = (await odds.get(m.marketId))!;
    const snap = { ...cur, updatedAt: Date.now(), runners: cur.runners.map((r) => (r.selectionId === a.selectionId ? { ...r, back: [{ price: better, size: 500 }, ...r.back.slice(1)] } : r)) };
    odds.ingest(snap);
    await processMarket(snap);
    const row = await queryOne<{ status: string; avg_price_matched: string }>('SELECT status, avg_price_matched FROM bet_items WHERE uuid = ?', [kept.body.bet.items[0].id]);
    expect(row).toEqual({ status: 'MATCHED', avg_price_matched: better.toFixed(2) });
    spies.forEach((s) => expect(s).not.toHaveBeenCalled());
  });

  it('cancels and re-prices waiting bets locally', async () => {
    const u = await createUser({ balance: 1000 });
    const { m, a } = fresh();
    const kept = await place(u.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'LAY', price: 1.01, stake: 100 }, 'KEEP');
    const id = kept.body.bet.items[0].id;
    expect((await api().post(`/api/bets/${id}/replace`).set(bearer(u.token)).send({ price: 1.2 })).body.price).toBe('1.20');
    expect((await wallet(u.id)).exposure).toBe(20);
    expect((await api().post(`/api/bets/${id}/cancel`).set(bearer(u.token))).body.status).toBe('CANCELLED');
    expect(await wallet(u.id)).toEqual({ balance: 1000, exposure: 0 });
    spies.forEach((s) => expect(s).not.toHaveBeenCalled());
  });

  it('lapses waiting bets when the market goes in-play', async () => {
    const u = await createUser({ balance: 1000 });
    const { m, a } = fresh();
    const kept = await place(u.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'BACK', price: 900, stake: 100 }, 'KEEP');
    await execute('UPDATE markets SET start_time = NOW(3) + INTERVAL 1 MINUTE WHERE betfair_id = ?', [m.marketId]);
    const snap = { ...(await odds.get(m.marketId))!, inPlay: true };
    await processMarket(snap);
    const row = await queryOne<{ status: string }>('SELECT status FROM bet_items WHERE uuid = ?', [kept.body.bet.items[0].id]);
    expect(row!.status).toBe('LAPSED');
    expect(await wallet(u.id)).toEqual({ balance: 1000, exposure: 0 });
  });

  it('settles from the Betfair result; the house pays winners and keeps losing stakes', async () => {
    const winner = await createUser({ balance: 1000 });
    const loser = await createUser({ balance: 1000 });
    const { m, a, b } = fresh();
    await place(winner.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'BACK', price: a.back[0].price, stake: 100 });
    await place(loser.token, { marketId: m.marketId, selectionId: b.selectionId, side: 'BACK', price: b.back[0].price, stake: 100 });
    await settleMarket(m.marketId, { type: 'RESULT', runners: new Map([[a.selectionId, 'WINNER'], [b.selectionId, 'LOSER']]) });
    const profit = Math.round(100 * (a.back[0].price - 1) * 100) / 100;
    const commission = Math.round(profit * 0.02 * 100) / 100;
    expect((await wallet(winner.id)).balance).toBe(Math.round((1000 + profit - commission) * 100) / 100);
    expect((await wallet(loser.id)).balance).toBe(900);
    const admin = await createAdmin('SUPER_ADMIN');
    const dash = await api().get('/api/admin/dashboard').set(bearer(admin));
    expect(dash.body.executionMode).toBe('house');
    expect(Number(dash.body.totals.revenue)).toBeCloseTo(Number(dash.body.totals.commission) - Number(dash.body.totals.customerProfitLoss), 2);
  });

  it('caps the house worst-case loss per market', async () => {
    const admin = await createAdmin('SUPER_ADMIN');
    await api().put('/api/admin/settings/risk.defaults').set(bearer(admin)).send({ maxMarketLiability: 300 });
    const u = await createUser({ balance: 10000 });
    const { m, a, b } = fresh();
    const p = a.back[0].price; // house loses stake × (p − 1) if A wins
    const stake = Math.floor(250 / (p - 1));
    expect((await place(u.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'BACK', price: p, stake })).status).toBe(201);
    const over = await place(u.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'BACK', price: p, stake });
    expect(over.body.error.code).toBe('LIMIT_EXCEEDED');
    // A bet on the other runner reduces the house's worst case, so it is accepted.
    expect((await place(u.token, { marketId: m.marketId, selectionId: b.selectionId, side: 'BACK', price: b.back[0].price, stake: 10 })).status).toBe(201);
    const exp = await api().get('/api/admin/risk/exposure').set(bearer(admin));
    expect(Number(exp.body.items.find((x: { marketId: string }) => x.marketId === m.marketId).houseWorstCase)).toBeLessThanOrEqual(300);
    await api().put('/api/admin/settings/risk.defaults').set(bearer(admin)).send({ maxMarketLiability: 1000000 });
  });
});
