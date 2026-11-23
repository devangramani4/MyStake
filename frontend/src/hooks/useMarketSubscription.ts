import { useEffect } from 'react';
import { marketsService } from '../services/betfair/marketsService';
import { oddsService } from '../services/betfair/oddsService';
import { useAppDispatch } from '../store/hooks';
import { booksReceived } from '../store/slices/marketsSlice';
import type { MarketBook } from '../types';

/**
 * Keep live prices for `marketIds`: seed the store once over REST (unless
 * `initial` books were already loaded), then stream deltas over WebSocket.
 */
export function useMarketSubscription(marketIds: string[], initial?: MarketBook[]) {
  const dispatch = useAppDispatch();
  const key = [...marketIds].sort().join(',');
  useEffect(() => {
    if (!key) return;
    const ids = key.split(',');
    if (initial?.length) dispatch(booksReceived(initial));
    else marketsService.books(ids).then((b) => dispatch(booksReceived(b))).catch(() => undefined);
    return oddsService.watchMarkets(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dispatch]);
}

export function useEventScores(eventIds: string[]) {
  const key = [...eventIds].sort().join(',');
  useEffect(() => {
    if (!key) return;
    return oddsService.watchEvents(key.split(','));
  }, [key]);
}
