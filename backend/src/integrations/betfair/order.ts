import type { BetfairRpc } from './http.js';
import type {
  CancelExecutionReport, CancelInstruction, CurrentOrderSummary, PlaceExecutionReport, PlaceInstruction,
  ReplaceExecutionReport, ReplaceInstruction,
} from './types.js';

export const order = (rpc: BetfairRpc) => ({
  /**
   * `customerRef` (≤32 chars) makes the request idempotent on Betfair's side
   * for 60s — retries with the same ref are rejected as DUPLICATE_TRANSACTION.
   */
  placeOrders: (marketId: string, instructions: PlaceInstruction[], customerRef: string) =>
    rpc.betting<PlaceExecutionReport>('placeOrders', { marketId, instructions, customerRef }),

  cancelOrders: (marketId: string, instructions: CancelInstruction[], customerRef?: string) =>
    rpc.betting<CancelExecutionReport>('cancelOrders', { marketId, instructions, customerRef }),

  replaceOrders: (marketId: string, instructions: ReplaceInstruction[], customerRef?: string) =>
    rpc.betting<ReplaceExecutionReport>('replaceOrders', { marketId, instructions, customerRef }),

  async listCurrentOrders(params: { betIds?: string[]; customerOrderRefs?: string[]; marketIds?: string[] }): Promise<CurrentOrderSummary[]> {
    const res = await rpc.betting<{ currentOrders: CurrentOrderSummary[]; moreAvailable: boolean }>('listCurrentOrders', {
      ...params,
      orderProjection: 'ALL',
      recordCount: 1000,
    });
    return res.currentOrders;
  },
});
