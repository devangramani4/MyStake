import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { LiveScore } from '../../types';

const slice = createSlice({
  name: 'scores',
  initialState: { byEvent: {} as Record<string, LiveScore> },
  reducers: {
    scoresReceived(s, a: PayloadAction<LiveScore[]>) {
      for (const sc of a.payload) {
        const prev = s.byEvent[sc.eventId];
        if (!prev || prev.updatedAt <= sc.updatedAt) s.byEvent[sc.eventId] = sc;
      }
    },
  },
});

export const { scoresReceived } = slice.actions;
export default slice.reducer;
