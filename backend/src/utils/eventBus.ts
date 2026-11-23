import { EventEmitter } from 'node:events';

/**
 * In-process domain event bus. Services publish; the WebSocket layer and jobs
 * subscribe. For multi-instance deployments swap for Redis pub/sub with the
 * same API (see README → Scaling).
 */
export type UserEvent =
  | { type: 'wallet'; wallet: unknown }
  | { type: 'bet'; bet: unknown }
  | { type: 'notification'; notification: unknown };

class Bus extends EventEmitter {
  toUser(userId: number, event: UserEvent) {
    this.emit('user', userId, event);
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
