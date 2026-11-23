import { makeStore } from '../store';
import { selectSlipTotals } from '../store/selectors';
import { setStake, toggleSelection } from '../store/slices/betslipSlice';
import { booksReceived } from '../store/slices/marketsSlice';
import type { MarketBook } from '../types';

const book = (overrides: Partial<MarketBook> = {}, backPrice = 1.85): MarketBook => ({
  marketId: '1.1', status: 'OPEN', inPlay: false, betDelay: 0, totalMatched: 1000, version: 1, updatedAt: Date.now(),
  runners: [
    { selectionId: 1, status: 'ACTIVE', lastPriceTraded: 1.85, totalMatched: 0, back: [{ price: backPrice, size: 500 }], lay: [{ price: 1.9, size: 300 }] },
    { selectionId: 2, status: 'ACTIVE', lastPriceTraded: 2.1, totalMatched: 0, back: [{ price: 2.1, size: 200 }], lay: [{ price: 2.2, size: 100 }] },
  ],
  ...overrides,
});
const ctx = { eventId: '9', eventName: 'India v Australia', marketName: 'Match Odds', selectionName: 'India' };

describe('markets slice', () => {
  it('only replaces the runner whose prices changed (render isolation)', () => {
    const store = makeStore();
    store.dispatch(booksReceived([book()]));
    const before = store.getState().markets.books['1.1'];
    store.dispatch(booksReceived([book({ updatedAt: Date.now() + 1 }, 1.8)]));
    const after = store.getState().markets.books['1.1'];
    expect(after.runners[1]).not.toBe(before.runners[1]);
    expect(after.runners[1].backMove).toBe('down');
    expect(after.runners[2]).toBe(before.runners[2]);
  });
  it('ignores out-of-order (stale) snapshots and tracks suspension', () => {
    const store = makeStore();
    store.dispatch(booksReceived([book({ updatedAt: 200, status: 'SUSPENDED' })]));
    store.dispatch(booksReceived([book({ updatedAt: 100, status: 'OPEN' })]));
    expect(store.getState().markets.books['1.1'].status).toBe('SUSPENDED');
  });
});

describe('bet slip', () => {
  it('adds, swaps side, toggles off and totals liability', () => {
    const store = makeStore();
    store.dispatch(toggleSelection({ marketId: '1.1', selectionId: 1, side: 'BACK', price: 1.85, ...ctx }));
    store.dispatch(toggleSelection({ marketId: '1.1', selectionId: 1, side: 'LAY', price: 1.9, ...ctx }));
    expect(store.getState().betslip.selections.map((s) => s.side)).toEqual(['LAY']);
    const key = store.getState().betslip.selections[0].key;
    store.dispatch(setStake({ key, stake: '100.999abc' }));
    expect(store.getState().betslip.selections[0].stake).toBe('100.99');
    store.dispatch(setStake({ key, stake: '100' }));
    expect(selectSlipTotals(store.getState())).toEqual({ stake: 100, liability: 90, profit: 100 });
    store.dispatch(toggleSelection({ marketId: '1.1', selectionId: 1, side: 'LAY', price: 1.9, ...ctx }));
    expect(store.getState().betslip.selections).toHaveLength(0);
  });
});
