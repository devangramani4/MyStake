import type { BetItem, Side } from '../../types';
import { http } from '../api/http';

export interface PlaceBetItem { marketId: string; selectionId: number; side: Side; price: number; stake: number }
export interface PlaceBetsResponse { duplicate: boolean; bet: { id: string; status: 'PENDING' | 'PLACED' | 'PARTIAL' | 'FAILED'; totalStake: string; totalLiability: string; items: BetItem[] } }

export const bettingService = {
  /**
   * `idempotencyKey` must stay the same for retries of one confirmation so a
   * double-click or flaky network can never create a duplicate bet.
   */
  place: (items: PlaceBetItem[], idempotencyKey: string, unmatchedPolicy: 'REJECT' | 'KEEP') =>
    http.post<PlaceBetsResponse>('/bets', { items, unmatchedPolicy }, { headers: { 'Idempotency-Key': idempotencyKey } }).then((r) => r.data),
};
