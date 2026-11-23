import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query, queryOne } from '../../src/config/db.js';
import type { MockExchange } from '../../src/integrations/betfair/mock/mockExchange.js';
import { reconcileOpenOrders } from '../../src/services/betService.js';
import { tick } from '../../src/utils/exchange.js';
import { api, bearer, createUser, idem, pickMarket, resetWorld, wallet } from '../helpers.js';

let ex: MockExchange;
beforeAll(async () => {
  ex = await resetWorld();
});
beforeEach(() => ex.setLatency(0));

const place = (token: string, items: unknown[], key = idem(), unmatchedPolicy = 'REJECT') =>
  api().post('/api/bets').set(bearer(token)).set('Idempotency-Key', key).send({ items, unmatchedPolicy });

describe('bet placement', () => {
  it('places a matched BACK bet and reserves the stake as exposure', async () => {
    const u = await createUser({ balance: 1000 });
    const m = pickMarket(ex);
    const res = await place(u.token, [{ marketId: m.marketId, selectionId: m.selectionId, side: 'BACK', price: m.bestBack, stake: 100 }]);
    expect(res.status).toBe(201);
    expect(res.body.bet.items[0].status).toBe('MATCHED');
    expect(await wallet(u.id)).toEqual({ balance: 900, exposure: 100 });
  });

  it('reserves lay liability = stake × (odds − 1)', async () => {
    const u = await createUser({ balance: 1000 });
    const m = pickMarket(ex);
    const res = await place(u.token, [{ marketId: m.marketId, selectionId: m.selectionId, side: 'LAY', price: m.bestLay, stake: 100 }]);
    expect(res.status).toBe(201);
    const liability = Math.round(100 * (m.bestLay - 1) * 100) / 100;
    expect(Number(res.body.bet.items[0].liability)).toBe(liability);
    expect((await wallet(u.id)).exposure).toBe(liability);
  });

  it('prevents duplicate bets from double clicks / retries (same Idempotency-Key)', async () => {
    const u = await createUser({ balance: 1000 });
    const m = pickMarket(ex);
    const key = idem();
    const item = [{ marketId: m.marketId, selectionId: m.selectionId, side: 'BACK', price: m.bestBack, stake: 50 }];
    const results = await Promise.all([place(u.token, item, key), place(u.token, item, key), place(u.token, item, key)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.bet.id)).size).toBe(1);
    expect((await query('SELECT id FROM bet_items WHERE user_id = ?', [u.id])).length).toBe(1);
    expect((await wallet(u.id)).balance).toBe(950);
  });

  it('never overdraws under concurrent bets', async () => {
    const u = await createUser({ balance: 100 });
    const m = pickMarket(ex);
    const item = [{ marketId: m.marketId, selectionId: m.selectionId, side: 'BACK', price: m.bestBack, stake: 40 }];
    const results = await Promise.all(Array.from({ length: 5 }, () => place(u.token, item)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.body.error?.code === 'INSUFFICIENT_FUNDS').length).toBe(3);
    expect(await wallet(u.id)).toEqual({ balance: 20, exposure: 80 });
  });

  it('rejects when odds have moved (REJECT policy) and reports the current price', async () => {
    const u = await createUser({ balance: 1000 });
    const m = pickMarket(ex);
    const better = tick(tick(m.bestBack, 1), 1);
    const res = await place(u.token, [{ marketId: m.marketId, selectionId: m.selectionId, side: 'BACK', price: better, stake: 10 }]);
    expect(res.body.error.code).toBe('ODDS_CHANGED');
    expect(res.body.error.details.currentPrice).toBe(m.bestBack);
    expect((await wallet(u.id)).balance).toBe(1000);
  });

  it('rejects when liquidity is insufficient, or keeps the remainder unmatched (KEEP)', async () => {
    const u = await createUser({ balance: 100000 });
    const m = pickMarket(ex);
    const book = ex.books.get(m.marketId)!.runners[0];
    const available = book.back.reduce((a, l) => a + l.size, 0);
    const lowest = book.back[book.back.length - 1].price;
    const stake = Math.ceil(available) + 100;
    const rejected = await place(u.token, [{ marketId: m.marketId, selectionId: m.selectionId, side: 'BACK', price: lowest, stake }]);
    expect(rejected.body.error.code).toBe('INSUFFICIENT_LIQUIDITY');
    const kept = await place(u.token, [{ marketId: m.marketId, selectionId: m.selectionId, side: 'BACK', price: lowest, stake }], idem(), 'KEEP');
    expect(kept.status).toBe(201);
    expect(kept.body.bet.items[0].status).toBe('PARTIALLY_MATCHED');
  });

  it('rejects bets on a suspended market', async () => {
    const u = await createUser({ balance: 1000 });
    const m = pickMarket(ex);
    ex.setMarketStatus(m.marketId, 'SUSPENDED');
    const res = await place(u.token, [{ marketId: m.marketId, selectionId: m.selectionId, side: 'BACK', price: m.bestBack, stake: 10 }]);
    expect(res.body.error.code).toBe('MARKET_SUSPENDED');
    ex.setMarketStatus(m.marketId, 'OPEN');
  });

  it('validates stake, ladder price and balance', async () => {
    const u = await createUser({ balance: 5 });
    const m = pickMarket(ex);
    expect((await place(u.token, [{ marketId: m.marketId, selectionId: m.selectionId, side: 'BACK', price: 2.01, stake: 10 }])).body.error.code).toBe('INVALID_PRICE');
    expect((await place(u.token, [{ marketId: m.marketId, selectionId: m.selectionId, side: 'BACK', price: m.bestBack, stake: 1 }])).body.error.code).toBe('INVALID_STAKE');
    expect((await place(u.token, [{ marketId: m.marketId, selectionId: m.selectionId, side: 'BACK', price: m.bestBack, stake: 10 }])).body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('refunds reserved funds when the exchange rejects the order', async () => {
    const u = await createUser({ balance: 1000 });
    const m = pickMarket(ex);
    ex.injectFailure('INSUFFICIENT_FUNDS'); // platform's exchange account rejected
    const res = await place(u.token, [{ marketId: m.marketId, selectionId: m.selectionId, side: 'BACK', price: m.bestBack, stake: 100 }]);
    expect(res.body.error.code).toBe('EXCHANGE_REJECTED');
    expect(res.body.error.message).not.toMatch(/INSUFFICIENT_FUNDS|Injected/);
    expect(await wallet(u.id)).toEqual({ balance: 1000, exposure: 0 });
    const tx = await query<{ type: string }>('SELECT type FROM wallet_transactions WHERE user_id = ? ORDER BY id', [u.id]);
    expect(tx.map((t) => t.type)).toEqual(['BET', 'REFUND']);
  });

  it('keeps a timed-out placement PENDING and reconciles it from the exchange', async () => {
    const u = await createUser({ balance: 1000 });
    const m = pickMarket(ex);
    ex.injectFailure('TIMEOUT');
    const res = await place(u.token, [{ marketId: m.marketId, selectionId: m.selectionId, side: 'BACK', price: m.bestBack, stake: 100 }]);
    expect(res.status).toBe(201);
    expect(res.body.bet.status).toBe('PENDING');
    expect((await wallet(u.id)).exposure).toBe(100);
    // The order never reached the exchange → after the grace period it fails and funds return.
    await query(`UPDATE bet_items SET placed_at = NOW(3) - INTERVAL 2 MINUTE WHERE user_id = ?`, [u.id]);
    await reconcileOpenOrders();
    const item = await queryOne<{ status: string }>('SELECT status FROM bet_items WHERE user_id = ?', [u.id]);
    expect(item!.status).toBe('FAILED');
    expect(await wallet(u.id)).toEqual({ balance: 1000, exposure: 0 });
  });

  it('cancels an unmatched bet and releases its liability', async () => {
    const u = await createUser({ balance: 1000 });
    const m = pickMarket(ex);
    const far = 900; // a BACK at 900 will not match
    const res = await place(u.token, [{ marketId: m.marketId, selectionId: m.selectionId, side: 'BACK', price: far, stake: 200 }], idem(), 'KEEP');
    expect(res.body.bet.items[0].status).toBe('UNMATCHED');
    expect((await wallet(u.id)).exposure).toBe(200);
    const cancel = await api().post(`/api/bets/${res.body.bet.items[0].id}/cancel`).set(bearer(u.token));
    expect(cancel.body.status).toBe('CANCELLED');
    expect(await wallet(u.id)).toEqual({ balance: 1000, exposure: 0 });
  });

  it('edits the price of an unmatched lay bet and re-sizes the liability', async () => {
    const u = await createUser({ balance: 1000 });
    const m = pickMarket(ex);
    const res = await place(u.token, [{ marketId: m.marketId, selectionId: m.selectionId, side: 'LAY', price: 1.01, stake: 100 }], idem(), 'KEEP');
    expect((await wallet(u.id)).exposure).toBe(1);
    const edited = await api().post(`/api/bets/${res.body.bet.items[0].id}/replace`).set(bearer(u.token)).send({ price: 1.5 });
    expect(edited.status).toBe(200);
    expect((await wallet(u.id)).exposure).toBe(50);
  });

  it('blocks self-excluded users', async () => {
    const u = await createUser({ balance: 1000 });
    await api().post('/api/me/self-exclusion').set(bearer(u.token)).send({ period: '180', password: u.password });
    const login = await api().post('/api/auth/login').send({ identifier: u.username, password: u.password });
    expect(login.body.error.code).toBe('SELF_EXCLUDED');
  });
});
