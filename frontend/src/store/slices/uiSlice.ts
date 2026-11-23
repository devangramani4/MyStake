import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface Toast { id: number; kind: 'success' | 'error' | 'info' | 'warning'; title: string; message?: string }

let nextId = 1;

const slice = createSlice({
  name: 'ui',
  initialState: {
    toasts: [] as Toast[],
    socket: 'connecting' as 'connecting' | 'open' | 'closed',
    feedConnected: true,
    navOpen: false,
    betsVersion: 0,
    unread: 0,
    /** 'house' = bets stay on this platform (Betfair supplies prices/results only). */
    executionMode: 'house' as 'house' | 'exchange',
  },
  reducers: {
    toast: {
      reducer(s, a: PayloadAction<Toast>) {
        s.toasts.push(a.payload);
        if (s.toasts.length > 4) s.toasts.shift();
      },
      prepare: (t: Omit<Toast, 'id'>) => ({ payload: { ...t, id: nextId++ } }),
    },
    dismissToast(s, a: PayloadAction<number>) {
      s.toasts = s.toasts.filter((t) => t.id !== a.payload);
    },
    socketStatus(s, a: PayloadAction<'connecting' | 'open' | 'closed'>) {
      s.socket = a.payload;
    },
    feedStatus(s, a: PayloadAction<boolean>) {
      s.feedConnected = a.payload;
    },
    setNavOpen(s, a: PayloadAction<boolean>) {
      s.navOpen = a.payload;
    },
    /** Bumped on real-time bet updates so open-bet views refetch. */
    betsChanged(s) {
      s.betsVersion++;
    },
    setUnread(s, a: PayloadAction<number>) {
      s.unread = a.payload;
    },
    setExecutionMode(s, a: PayloadAction<'house' | 'exchange'>) {
      s.executionMode = a.payload;
    },
    incrementUnread(s) {
      s.unread++;
    },
  },
});

export const { toast, dismissToast, socketStatus, feedStatus, setNavOpen, betsChanged, setUnread, incrementUnread, setExecutionMode } = slice.actions;
export default slice.reducer;
