import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from './index';
import { liability, profit } from '../utils/exchange';

/**
 * Fine-grained selectors: components select primitives for a single
 * market/runner/level, so one odds tick re-renders only that button.
 */
export const selectBook = (s: RootState, marketId: string) => s.markets.books[marketId];
export const selectMarketStatus = (s: RootState, marketId: string) => s.markets.books[marketId]?.status;
export const selectInPlay = (s: RootState, marketId: string) => s.markets.books[marketId]?.inPlay ?? false;
export const selectRunner = (s: RootState, marketId: string, selectionId: number) => s.markets.books[marketId]?.runners[selectionId];

export const selectSlipTotals = createSelector([(s: RootState) => s.betslip.selections], (selections) => {
  let stake = 0;
  let risk = 0;
  let maxProfit = 0;
  for (const x of selections) {
    const st = Number(x.stake) || 0;
    stake += st;
    risk += liability(x.side, st, x.price);
    maxProfit += profit(x.side, st, x.price);
  }
  return { stake: Math.round(stake * 100) / 100, liability: Math.round(risk * 100) / 100, profit: Math.round(maxProfit * 100) / 100 };
});

export const selectIsSelected = (s: RootState, key: string) => s.betslip.selections.some((x) => x.key === key);
