import { oddsService } from '../services/betfair/oddsService';
import { socket } from '../services/ws/socket';
import type { LiveScore, MarketBook, Notification, Wallet } from '../types';
import type { AppStore } from './index';
import { booksReceived } from './slices/marketsSlice';
import { scoresReceived } from './slices/scoresSlice';
import { betsChanged, feedStatus, incrementUnread, socketStatus, toast } from './slices/uiSlice';
import { walletPushed } from './slices/walletSlice';

/**
 * Bridges WebSocket messages into Redux. Market updates are coalesced per
 * animation frame (latest snapshot per market wins) so bursts of ticks cause
 * at most one store update per frame.
 */
export function connectRealtime(store: AppStore) {
  let pending = new Map<string, MarketBook>();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (!pending.size) return;
    const batch = [...pending.values()];
    pending = new Map();
    store.dispatch(booksReceived(batch));
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    (typeof requestAnimationFrame === 'function' && document.visibilityState === 'visible' ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 250))(flush);
  };

  socket.onMessage((msg) => {
    switch (msg.type) {
      case 'market': {
        const b = msg.data as MarketBook;
        pending.set(b.marketId, b);
        schedule();
        break;
      }
      case 'score':
        store.dispatch(scoresReceived([msg.data as LiveScore]));
        break;
      case 'wallet':
        store.dispatch(walletPushed(msg.data as Wallet));
        break;
      case 'bet':
        store.dispatch(betsChanged());
        break;
      case 'notification': {
        const n = msg.data as Notification;
        store.dispatch(incrementUnread());
        store.dispatch(toast({ kind: n.type === 'BET_FAILED' ? 'error' : 'info', title: n.title, message: n.body }));
        break;
      }
      case 'hello':
        store.dispatch(feedStatus((msg.data as { feedConnected: boolean }).feedConnected));
        break;
      case 'feed':
        store.dispatch(feedStatus((msg as unknown as { connected: boolean }).connected));
        break;
    }
  });
  socket.onStatus((s) => {
    store.dispatch(socketStatus(s));
    if (s === 'open') oddsService.resubscribeAll();
  });
  socket.start();
}
