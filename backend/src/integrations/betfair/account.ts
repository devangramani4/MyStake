import type { BetfairRpc } from './http.js';
import type { AccountFunds } from './types.js';

export const account = (rpc: BetfairRpc) => ({
  getAccountFunds: () => rpc.account<AccountFunds>('getAccountFunds', { wallet: 'UK' }),
});
