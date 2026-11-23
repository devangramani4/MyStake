import { configureStore } from '@reduxjs/toolkit';
import auth from './slices/authSlice';
import betslip from './slices/betslipSlice';
import markets from './slices/marketsSlice';
import scores from './slices/scoresSlice';
import ui from './slices/uiSlice';
import wallet from './slices/walletSlice';

export const makeStore = () =>
  configureStore({
    reducer: { auth, wallet, markets, betslip, ui, scores },
    // Market books are large and update often; skip dev-only deep checks for them.
    middleware: (gdm) => gdm({ immutableCheck: { ignoredPaths: ['markets'] }, serializableCheck: { ignoredPaths: ['markets'] } }),
  });

export const store = makeStore();

// Persist the bet slip for the tab session only (not credentials, not balances).
let lastSlip = store.getState().betslip;
store.subscribe(() => {
  const slip = store.getState().betslip;
  if (slip !== lastSlip) {
    lastSlip = slip;
    try {
      sessionStorage.setItem('betslip', JSON.stringify({ selections: slip.selections, unmatchedPolicy: slip.unmatchedPolicy }));
    } catch {
      /* ignore */
    }
  }
});

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
