import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MarketBook, MarketStatus, PriceSize, RunnerStatus } from '../../types';

export type Move = 'up' | 'down' | null;

export interface RunnerState {
  status: RunnerStatus;
  ltp: number | null;
  back: PriceSize[];
  lay: PriceSize[];
  /** Direction of the last best-price change, for subtle flash feedback. */
  backMove: Move;
  layMove: Move;
  changedAt: number;
}

export interface BookState {
  status: MarketStatus;
  inPlay: boolean;
  betDelay: number;
  totalMatched: number;
  version: number;
  updatedAt: number;
  runners: Record<number, RunnerState>;
}

interface MarketsState {
  books: Record<string, BookState>;
}

const move = (prev: number | undefined, next: number | undefined): Move => (prev === undefined || next === undefined || prev === next ? null : next > prev ? 'up' : 'down');
const sameLadder = (a: PriceSize[], b: PriceSize[]) => a.length === b.length && a.every((x, i) => x.price === b[i].price && x.size === b[i].size);

const slice = createSlice({
  name: 'markets',
  initialState: { books: {} } as MarketsState,
  reducers: {
    /**
     * Merge market snapshots. Unchanged runners keep their object identity,
     * so only components bound to the changed market/runner re-render.
     */
    booksReceived(state, a: PayloadAction<MarketBook[]>) {
      for (const b of a.payload) {
        const prev = state.books[b.marketId];
        if (prev && prev.updatedAt > b.updatedAt) continue; // stale
        if (!prev) {
          state.books[b.marketId] = {
            status: b.status, inPlay: b.inPlay, betDelay: b.betDelay, totalMatched: b.totalMatched, version: b.version, updatedAt: b.updatedAt,
            runners: Object.fromEntries(b.runners.map((r) => [r.selectionId, { status: r.status, ltp: r.lastPriceTraded, back: r.back, lay: r.lay, backMove: null, layMove: null, changedAt: 0 }])),
          };
          continue;
        }
        if (prev.status !== b.status) prev.status = b.status;
        if (prev.inPlay !== b.inPlay) prev.inPlay = b.inPlay;
        prev.betDelay = b.betDelay;
        prev.totalMatched = b.totalMatched;
        prev.version = b.version;
        prev.updatedAt = b.updatedAt;
        for (const r of b.runners) {
          const pr = prev.runners[r.selectionId];
          if (!pr) {
            prev.runners[r.selectionId] = { status: r.status, ltp: r.lastPriceTraded, back: r.back, lay: r.lay, backMove: null, layMove: null, changedAt: 0 };
            continue;
          }
          if (pr.status !== r.status) pr.status = r.status;
          if (pr.ltp !== r.lastPriceTraded) pr.ltp = r.lastPriceTraded;
          if (!sameLadder(pr.back, r.back)) {
            const m = move(pr.back[0]?.price, r.back[0]?.price);
            if (m) { pr.backMove = m; pr.changedAt = b.updatedAt; }
            pr.back = r.back;
          }
          if (!sameLadder(pr.lay, r.lay)) {
            const m = move(pr.lay[0]?.price, r.lay[0]?.price);
            if (m) { pr.layMove = m; pr.changedAt = b.updatedAt; }
            pr.lay = r.lay;
          }
        }
      }
    },
  },
});

export const { booksReceived } = slice.actions;
export default slice.reducer;
