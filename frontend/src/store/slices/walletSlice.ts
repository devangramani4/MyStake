import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { walletApi } from '../../services/api/accountApi';
import type { Wallet } from '../../types';
import { logout } from './authSlice';

/** Read-only mirror of the server wallet. The client never computes or sends balances. */
export const fetchWallet = createAsyncThunk('wallet/fetch', () => walletApi.summary());

const slice = createSlice({
  name: 'wallet',
  initialState: { wallet: null as Wallet | null },
  reducers: {
    walletPushed(s, a: PayloadAction<Wallet>) {
      s.wallet = { ...s.wallet, ...a.payload };
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchWallet.fulfilled, (s, a) => {
      s.wallet = a.payload;
    });
    b.addCase(logout.fulfilled, (s) => {
      s.wallet = null;
    });
  },
});

export const { walletPushed } = slice.actions;
export default slice.reducer;
