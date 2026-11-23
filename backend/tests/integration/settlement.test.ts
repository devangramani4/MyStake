import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/config/db.js';
import type { MockExchange } from '../../src/integrations/betfair/mock/mockExchange.js';
import { settleMarket } from '../../src/services/settlementService.js';
import { api, bearer, createUser, idem, resetWorld, wallet } from '../helpers.js';

let ex: MockExchange;
beforeAll(async () => {
  ex = await resetWorld();
});

function freshMarket() {
  const m = [...ex.markets.values()].find((x) => x.status === 'OPEN' && x.marketType === 'MATCH_ODDS' && x.runners.length === 2 && !used.has(x.marketId))!;
  used.add(m.marketId);
  const b = ex.books.get(m.marketId)!;
  return { m, a: b.runners[0], b: b.runners[1] };
}
const used = new Set<string>();

const bet = (token: string, item: object, policy = 'REJECT') =>
  api().post('/api/bets').set(bearer(token)).set('Idempotency-Key', idem()).send({ items: [item], unmatchedPolicy: policy });

describe('settlement', () => {
  it('pays a winning back bet (minus commission) and closes a losing lay', async () => {
    const backer = await createUser({ balance: 1000 });
    const layer = await createUser({ balance: 1000 });
    const { m, a } = freshMarket();
    const backPrice = a.back[0].price;
    const layPrice = a.lay[0].price;
    await bet(backer.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'BACK', price: backPrice, stake: 100 });
    await bet(layer.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'LAY', price: layPrice, stake: 100 });

    ex.settle(m, a.selectionId); // runner A wins → triggers auto-settlement through the odds hub
    await new Promise((r) => setTimeout(r, 300));
    await settleMarket(m.marketId, { type: 'RESULT', runners: new Map([[a.selectionId, 'WINNER']]) }); // idempotent re-run

    const profit = Math.round(100 * (backPrice - 1) * 100) / 100;
    const commission = Math.round(profit * 0.02 * 100) / 100;
    expect(await wallet(backer.id)).toEqual({ balance: Math.round((1000 + profit - commission) * 100) / 100, exposure: 0 });
    const layLiability = Math.round(100 * (layPrice - 1) * 100) / 100;
    expect(await wallet(layer.id)).toEqual({ balance: Math.round((1000 - layLiability) * 100) / 100, exposure: 0 });

    const [row] = await query<{ status: string; result: string; profit_loss: string; commission: string }>('SELECT status, result, profit_loss, commission FROM bet_items WHERE user_id = ?', [backer.id]);
    expect(row).toMatchObject({ status: 'SETTLED', result: 'WIN', profit_loss: profit.toFixed(2), commission: commission.toFixed(2) });
    const settlements = await query('SELECT s.id FROM settlements s JOIN bet_items bi ON bi.id = s.bet_item_id WHERE bi.user_id IN (?, ?)', [backer.id, layer.id]);
    expect(settlements).toHaveLength(2);
  });

  it('charges commission on net market winnings only (hedged positions)', async () => {
    const u = await createUser({ balance: 1000 });
    const { m, a, b } = freshMarket();
    await bet(u.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'BACK', price: a.back[0].price, stake: 100 });
    await bet(u.token, { marketId: m.marketId, selectionId: b.selectionId, side: 'BACK', price: b.back[0].price, stake: 100 });
    await settleMarket(m.marketId, { type: 'RESULT', runners: new Map([[a.selectionId, 'WINNER'], [b.selectionId, 'LOSER']]) });
    const net = Math.round((100 * (a.back[0].price - 1) - 100) * 100) / 100;
    const commission = net > 0 ? Math.round(net * 0.02 * 100) / 100 : 0;
    expect((await wallet(u.id)).balance).toBe(Math.round((1000 + net - commission) * 100) / 100);
  });

  it('voids a market and refunds everyone in full', async () => {
    const u = await createUser({ balance: 500 });
    const { m, a } = freshMarket();
    await bet(u.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'LAY', price: a.lay[0].price, stake: 100 });
    await settleMarket(m.marketId, { type: 'VOID' });
    expect(await wallet(u.id)).toEqual({ balance: 500, exposure: 0 });
    const [row] = await query<{ status: string; result: string }>('SELECT status, result FROM bet_items WHERE user_id = ?', [u.id]);
    expect(row).toEqual({ status: 'VOIDED', result: 'VOID' });
  });

  it('refunds the unmatched part of a partially matched bet (PARTIAL)', async () => {
    const u = await createUser({ balance: 100000 });
    const { m, a } = freshMarket();
    const available = a.back.reduce((s, l) => s + l.size, 0);
    const lowest = a.back[a.back.length - 1].price;
    const stake = Math.ceil(available) + 1000;
    const res = await bet(u.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'BACK', price: lowest, stake }, 'KEEP');
    const matched = Number(res.body.bet.items[0].sizeMatched);
    const avg = Number(res.body.bet.items[0].avgPriceMatched);
    await settleMarket(m.marketId, { type: 'RESULT', runners: new Map([[a.selectionId, 'LOSER']]) });
    const [row] = await query<{ result: string; profit_loss: string }>('SELECT result, profit_loss FROM bet_items WHERE user_id = ?', [u.id]);
    expect(row.result).toBe('PARTIAL');
    expect(Number(row.profit_loss)).toBe(-matched);
    expect(await wallet(u.id)).toEqual({ balance: Math.round((100000 - matched) * 100) / 100, exposure: 0 });
    expect(avg).toBeGreaterThan(1);
  });

  it('is idempotent — settling twice never double-pays', async () => {
    const u = await createUser({ balance: 1000 });
    const { m, a } = freshMarket();
    await bet(u.token, { marketId: m.marketId, selectionId: a.selectionId, side: 'BACK', price: a.back[0].price, stake: 100 });
    const outcome = { type: 'RESULT' as const, runners: new Map([[a.selectionId, 'WINNER' as const]]) };
    await Promise.all([settleMarket(m.marketId, outcome), settleMarket(m.marketId, outcome)]);
    await settleMarket(m.marketId, outcome);
    const wins = await query("SELECT id FROM wallet_transactions WHERE user_id = ? AND type = 'WIN'", [u.id]);
    expect(wins).toHaveLength(1);
  });

  it('voids bets on a removed runner', async () => {
    const u = await createUser({ balance: 1000 });
    const { m, a, b } = freshMarket();
    await bet(u.token, { marketId: m.marketId, selectionId: b.selectionId, side: 'BACK', price: b.back[0].price, stake: 100 });
    await settleMarket(m.marketId, { type: 'RESULT', runners: new Map([[a.selectionId, 'WINNER'], [b.selectionId, 'REMOVED']]) });
    expect(await wallet(u.id)).toEqual({ balance: 1000, exposure: 0 });
  });
});
