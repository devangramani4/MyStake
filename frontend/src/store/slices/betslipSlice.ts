import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Side } from '../../types';

export interface Selection {
  key: string;
  marketId: string;
  selectionId: number;
  side: Side;
  /** Price the user wants (editable). */
  price: number;
  stake: string;
  eventId: string;
  eventName: string;
  marketName: string;
  selectionName: string;
}

interface BetslipState {
  selections: Selection[];
  unmatchedPolicy: 'REJECT' | 'KEEP';
  open: boolean; // mobile drawer
}

const load = (): BetslipState => {
  try {
    const raw = sessionStorage.getItem('betslip');
    if (raw) return { ...JSON.parse(raw), open: false };
  } catch {
    /* storage unavailable */
  }
  return { selections: [], unmatchedPolicy: 'REJECT', open: false };
};

export const selectionKey = (marketId: string, selectionId: number, side: Side) => `${marketId}:${selectionId}:${side}`;

const slice = createSlice({
  name: 'betslip',
  initialState: load,
  reducers: {
    /** Clicking the same price again removes it; clicking the opposite side swaps. */
    toggleSelection(s, a: PayloadAction<Omit<Selection, 'key' | 'stake'> & { stake?: string }>) {
      const key = selectionKey(a.payload.marketId, a.payload.selectionId, a.payload.side);
      const existing = s.selections.findIndex((x) => x.key === key);
      if (existing >= 0 && s.selections[existing].price === a.payload.price) {
        s.selections.splice(existing, 1);
        return;
      }
      const opposite = selectionKey(a.payload.marketId, a.payload.selectionId, a.payload.side === 'BACK' ? 'LAY' : 'BACK');
      s.selections = s.selections.filter((x) => x.key !== opposite && x.key !== key);
      if (s.selections.length >= 10) s.selections.shift();
      s.selections.push({ ...a.payload, key, stake: a.payload.stake ?? '' });
      s.open = true;
    },
    removeSelection(s, a: PayloadAction<string>) {
      s.selections = s.selections.filter((x) => x.key !== a.payload);
    },
    setStake(s, a: PayloadAction<{ key: string; stake: string }>) {
      const x = s.selections.find((y) => y.key === a.payload.key);
      if (x) x.stake = a.payload.stake.replace(/[^\d.]/g, '').replace(/^(\d*\.\d{0,2}).*$/, '$1');
    },
    setPrice(s, a: PayloadAction<{ key: string; price: number }>) {
      const x = s.selections.find((y) => y.key === a.payload.key);
      if (x) x.price = a.payload.price;
    },
    setPolicy(s, a: PayloadAction<'REJECT' | 'KEEP'>) {
      s.unmatchedPolicy = a.payload;
    },
    clearSlip(s) {
      s.selections = [];
    },
    removeKeys(s, a: PayloadAction<string[]>) {
      s.selections = s.selections.filter((x) => !a.payload.includes(x.key));
    },
    setSlipOpen(s, a: PayloadAction<boolean>) {
      s.open = a.payload;
    },
  },
});

export const { toggleSelection, removeSelection, setStake, setPrice, setPolicy, clearSlip, removeKeys, setSlipOpen } = slice.actions;
export default slice.reducer;
