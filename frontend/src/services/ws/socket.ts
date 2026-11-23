import { config } from '../../config';

type Listener = (msg: { type: string; data?: unknown; ts?: number }) => void;
type StatusListener = (s: 'connecting' | 'open' | 'closed') => void;

/**
 * Resilient WebSocket client:
 *  - exponential back-off reconnect with jitter
 *  - application heartbeat (ping/pong) to detect half-open connections
 *  - queues messages while disconnected; listeners re-subscribe on 'open'
 */
class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private queue: string[] = [];
  private attempt = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  private token: string | null = null;
  private started = false;

  start() {
    if (this.started || !config.wsUrl) return;
    this.started = true;
    this.connect();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) this.connect();
    });
  }

  private connect() {
    this.emitStatus('connecting');
    const ws = new WebSocket(config.wsUrl);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.lastPong = Date.now();
      if (this.token) ws.send(JSON.stringify({ type: 'auth', token: this.token }));
      this.queue.splice(0).forEach((m) => ws.send(m));
      this.emitStatus('open');
      this.heartbeat && clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastPong > 45_000) {
          ws.close(); // stale — triggers reconnect
          return;
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      }, 15_000);
    };
    ws.onmessage = (e) => {
      this.lastPong = Date.now();
      let msg;
      try {
        msg = JSON.parse(e.data as string);
      } catch {
        return;
      }
      this.listeners.forEach((l) => l(msg));
    };
    ws.onclose = () => {
      this.heartbeat && clearInterval(this.heartbeat);
      this.emitStatus('closed');
      const delay = Math.min(30_000, 500 * 2 ** this.attempt++) * (0.8 + Math.random() * 0.4);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  send(msg: Record<string, unknown>) {
    const s = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(s);
    else if (msg.type !== 'ping') this.queue.push(s);
  }

  /** Authenticate the socket for wallet/bet/notification pushes. */
  setToken(token: string | null) {
    this.token = token;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(token ? { type: 'auth', token } : { type: 'logout' }));
  }

  onMessage(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  onStatus(l: StatusListener) { this.statusListeners.add(l); return () => this.statusListeners.delete(l); }
  private emitStatus(s: 'connecting' | 'open' | 'closed') { this.statusListeners.forEach((l) => l(s)); }
}

export const socket = new Socket();
