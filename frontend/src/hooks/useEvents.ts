import { useCallback, useEffect, useState } from 'react';
import { eventsService, type EventQuery } from '../services/betfair/eventsService';
import { useAppDispatch } from '../store/hooks';
import { scoresReceived } from '../store/slices/scoresSlice';
import type { EventSummary } from '../types';
import { errorMessage } from '../utils/errors';
import { useEventScores, useMarketSubscription } from './useMarketSubscription';

/** Server-filtered, paginated event list with live prices for each headline market. */
export function useEvents(query: EventQuery, opts: { refreshMs?: number } = {}) {
  const dispatch = useAppDispatch();
  const [items, setItems] = useState<EventSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const qKey = JSON.stringify(query);

  const load = useCallback(
    (signal?: AbortSignal, silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      return eventsService
        .list(JSON.parse(qKey), signal)
        .then((r) => {
          setItems(r.items);
          setTotal(r.total);
          const live = r.items.filter((e) => e.status === 'IN_PLAY').map((e) => e.eventId);
          if (live.length) eventsService.scores(live).then((s) => dispatch(scoresReceived(s))).catch(() => undefined);
        })
        .catch((e) => {
          if (!signal?.aborted) setError(errorMessage(e));
        })
        .finally(() => !signal?.aborted && setLoading(false));
    },
    [qKey, dispatch],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const id = opts.refreshMs ? setInterval(() => void load(undefined, true), opts.refreshMs) : undefined;
    return () => {
      ctrl.abort();
      if (id) clearInterval(id);
    };
  }, [load, opts.refreshMs]);

  useMarketSubscription(items.flatMap((e) => (e.mainMarket ? [e.mainMarket.marketId] : [])));
  useEventScores(items.filter((e) => e.status === 'IN_PLAY').map((e) => e.eventId));
  return { items, total, loading, error, reload: () => load() };
}
