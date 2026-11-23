import { socket } from '../ws/socket';

/**
 * Live odds subscriptions. Reference-counted so several components can watch
 * the same market; the socket only unsubscribes when the last one leaves.
 */
const marketRefs = new Map<string, number>();
const eventRefs = new Map<string, number>();

function change(map: Map<string, number>, ids: string[], delta: 1 | -1) {
  const changed: string[] = [];
  for (const id of ids) {
    const n = (map.get(id) ?? 0) + delta;
    if (n <= 0) {
      if (map.delete(id)) changed.push(id);
    } else {
      if (!map.has(id)) changed.push(id);
      map.set(id, n);
    }
  }
  return changed;
}

export const oddsService = {
  watchMarkets(ids: string[]) {
    const added = change(marketRefs, ids, 1);
    if (added.length) socket.send({ type: 'subscribe', markets: added });
    return () => {
      const removed = change(marketRefs, ids, -1);
      if (removed.length) socket.send({ type: 'unsubscribe', markets: removed });
    };
  },
  watchEvents(ids: string[]) {
    const added = change(eventRefs, ids, 1);
    if (added.length) socket.send({ type: 'subscribe', events: added });
    return () => {
      const removed = change(eventRefs, ids, -1);
      if (removed.length) socket.send({ type: 'unsubscribe', events: removed });
    };
  },
  /** After a reconnect, restore every active subscription. */
  resubscribeAll() {
    if (marketRefs.size) socket.send({ type: 'subscribe', markets: [...marketRefs.keys()] });
    if (eventRefs.size) socket.send({ type: 'subscribe', events: [...eventRefs.keys()] });
  },
};
