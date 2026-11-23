import type { BetfairSession } from './auth.js';
import type { ApiCallObserver, BetfairClient, IntegrationStatus } from './client.js';
import { BetfairRpc } from './http.js';
import { navigation } from './navigation.js';
import { marketCatalogue } from './marketCatalogue.js';
import { marketBook } from './marketBook.js';
import { order } from './order.js';
import { account } from './account.js';

/** Real Betfair API-NG client composed from the per-domain modules. */
export function createLiveClient(
  session: BetfairSession,
  apiUrl: string,
  timeoutMs: number,
  observer: ApiCallObserver | undefined,
  streamConnected: () => boolean,
): BetfairClient {
  const rpc = new BetfairRpc(session, apiUrl, timeoutMs, observer);
  return {
    mode: 'live',
    ...navigation(rpc),
    ...marketCatalogue(rpc),
    ...marketBook(rpc),
    ...order(rpc),
    ...account(rpc),
    status(): IntegrationStatus {
      const h = rpc.health();
      return { mode: 'live', sessionValid: session.isValid(), streamConnected: streamConnected(), lastError: h.lastError, lastSuccessAt: h.lastSuccessAt };
    },
  };
}
