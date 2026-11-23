import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { env } from '../config/env.js';
import { getBetfair } from '../integrations/betfair/index.js';
import type { MarketSnapshot } from '../integrations/betfair/types.js';
import { odds } from '../services/oddsService.js';
import { verifyAccess } from '../services/tokenService.js';
import { bus, type UserEvent } from '../utils/eventBus.js';
import { logger } from '../utils/logger.js';

/**
 * Real-time channel: /ws
 * Client → server: auth | subscribe | unsubscribe | ping
 * Server → client: hello | market | score | wallet | bet | notification | feed | pong | error
 * Each socket only receives updates for markets it subscribed to, and only
 * the changed market is sent — never the whole board.
 */

interface Client {
  ws: WebSocket;
  alive: boolean;
  userId: number | null;
  markets: Set<string>;
  events: Set<string>;
}

const MAX_SUBS = 300;
const MAX_BUFFERED = 1_000_000; // bytes — slow consumers skip frames (next snapshot supersedes)

const inbound = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().max(2000) }),
  z.object({ type: z.literal('logout') }),
  z.object({ type: z.literal('subscribe'), markets: z.array(z.string().regex(/^\d\.\d+$/)).max(MAX_SUBS).optional(), events: z.array(z.string().regex(/^\d+$/)).max(MAX_SUBS).optional() }),
  z.object({ type: z.literal('unsubscribe'), markets: z.array(z.string()).max(MAX_SUBS).optional(), events: z.array(z.string()).max(MAX_SUBS).optional() }),
  z.object({ type: z.literal('ping'), ts: z.number().optional() }),
]);

export function attachWebSocket(server: HttpServer) {
  const allowed = new Set(env.CORS_ORIGINS.split(',').map((s) => s.trim()));
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 16 * 1024,
    verifyClient: ({ origin }: { origin: string; req: IncomingMessage }) => !origin || allowed.has(origin),
  });
  const clients = new Set<Client>();
  const byMarket = new Map<string, Set<Client>>();
  const byEvent = new Map<string, Set<Client>>();
  const byUser = new Map<number, Set<Client>>();

  const send = (c: Client, payload: string) => {
    if (c.ws.readyState === WebSocket.OPEN && c.ws.bufferedAmount < MAX_BUFFERED) c.ws.send(payload);
  };
  const index = <K>(map: Map<K, Set<Client>>, key: K, c: Client, add: boolean) => {
    let set = map.get(key);
    if (add) {
      if (!set) map.set(key, (set = new Set()));
      set.add(c);
    } else if (set) {
      set.delete(c);
      if (!set.size) map.delete(key);
    }
  };

  // ── Fan-out from the odds hub / score provider / domain bus ──
  odds.onUpdate((snap: MarketSnapshot) => {
    const subs = byMarket.get(snap.marketId);
    if (!subs?.size) return;
    const payload = JSON.stringify({ type: 'market', data: snap });
    for (const c of subs) send(c, payload);
  });

  void getBetfair().then(({ scores, stream }) => {
    scores.onScore((s) => {
      const subs = byEvent.get(s.eventId);
      if (!subs?.size) return;
      const payload = JSON.stringify({ type: 'score', data: s });
      for (const c of subs) send(c, payload);
    });
    stream.onStatus((connected) => {
      const payload = JSON.stringify({ type: 'feed', connected });
      for (const c of clients) send(c, payload);
    });
  });

  bus.on('user', (userId: number, ev: UserEvent) => {
    const subs = byUser.get(userId);
    if (!subs?.size) return;
    const payload = JSON.stringify({ type: ev.type, data: ev.type === 'wallet' ? ev.wallet : ev.type === 'bet' ? ev.bet : ev.notification });
    for (const c of subs) send(c, payload);
  });

  wss.on('connection', (ws, req) => {
    const c: Client = { ws, alive: true, userId: null, markets: new Set(), events: new Set() };
    clients.add(c);
    logger.debug({ ws: 'connect', ip: req.socket.remoteAddress, clients: clients.size }, 'ws connected');
    send(c, JSON.stringify({ type: 'hello', data: { heartbeatMs: 20_000, feedConnected: odds.isStreamConnected() } }));

    ws.on('pong', () => (c.alive = true));
    ws.on('message', async (raw) => {
      c.alive = true;
      let msg: z.infer<typeof inbound>;
      try {
        msg = inbound.parse(JSON.parse(raw.toString()));
      } catch {
        return send(c, JSON.stringify({ type: 'error', data: { code: 'BAD_MESSAGE' } }));
      }
      switch (msg.type) {
        case 'ping':
          return send(c, JSON.stringify({ type: 'pong', ts: msg.ts ?? Date.now() }));
        case 'auth':
          try {
            const claims = verifyAccess(msg.token, 'user');
            if (c.userId !== null) index(byUser, c.userId, c, false);
            c.userId = Number(claims.sub);
            index(byUser, c.userId, c, true);
            send(c, JSON.stringify({ type: 'auth', data: { ok: true } }));
          } catch {
            send(c, JSON.stringify({ type: 'auth', data: { ok: false } }));
          }
          return;
        case 'logout':
          if (c.userId !== null) index(byUser, c.userId, c, false);
          c.userId = null;
          return;
        case 'subscribe': {
          const newMarkets = (msg.markets ?? []).filter((m) => !c.markets.has(m)).slice(0, MAX_SUBS - c.markets.size);
          newMarkets.forEach((m) => { c.markets.add(m); index(byMarket, m, c, true); });
          (msg.events ?? []).slice(0, MAX_SUBS - c.events.size).forEach((e) => { c.events.add(e); index(byEvent, e, c, true); });
          // Send current state immediately so the UI never waits for the next tick.
          if (newMarkets.length) {
            for (const s of await odds.getMany(newMarkets)) send(c, JSON.stringify({ type: 'market', data: s }));
          }
          return;
        }
        case 'unsubscribe':
          (msg.markets ?? []).forEach((m) => { c.markets.delete(m); index(byMarket, m, c, false); });
          (msg.events ?? []).forEach((e) => { c.events.delete(e); index(byEvent, e, c, false); });
          return;
      }
    });
    ws.on('close', () => {
      clients.delete(c);
      c.markets.forEach((m) => index(byMarket, m, c, false));
      c.events.forEach((e) => index(byEvent, e, c, false));
      if (c.userId !== null) index(byUser, c.userId, c, false);
      logger.debug({ ws: 'disconnect', clients: clients.size }, 'ws disconnected');
    });
    ws.on('error', (err) => logger.warn({ ws: 'error', err: err.message }, 'ws error'));
  });

  // Heartbeat: terminate sockets that didn't answer the previous ping.
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, 20_000);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  return { wss, stats: () => ({ clients: clients.size, marketsWatched: byMarket.size, users: byUser.size }) };
}
