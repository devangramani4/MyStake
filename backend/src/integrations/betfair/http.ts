import { randomUUID } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import type { BetfairSession } from './auth.js';
import type { ApiCallObserver } from './client.js';
import { BetfairError } from './errors.js';

const SESSION_ERRORS = new Set(['INVALID_SESSION_INFORMATION', 'NO_SESSION', 'NO_APP_KEY']);

/**
 * JSON-RPC transport for API-NG. Handles timeouts, maps APINGException codes,
 * transparently re-authenticates once on an expired session, and reports
 * call metadata (never payloads/credentials) to an observer for api_logs.
 */
export class BetfairRpc {
  private lastError: string | null = null;
  private lastSuccessAt: number | null = null;

  constructor(
    private readonly session: BetfairSession,
    private readonly apiUrl: string,
    private readonly timeoutMs: number,
    private readonly observer?: ApiCallObserver,
  ) {}

  health() {
    return { lastError: this.lastError, lastSuccessAt: this.lastSuccessAt };
  }

  betting<T>(method: string, params: Record<string, unknown>) {
    return this.call<T>('betting', `SportsAPING/v1.0/${method}`, params);
  }

  account<T>(method: string, params: Record<string, unknown> = {}) {
    return this.call<T>('account', `AccountAPING/v1.0/${method}`, params);
  }

  private async call<T>(api: 'betting' | 'account', method: string, params: Record<string, unknown>, retried = false): Promise<T> {
    const started = Date.now();
    const op = method.split('/').pop()!;
    try {
      const token = await this.session.getToken();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${this.apiUrl}/${api}/json-rpc/v1`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'X-Application': this.session.appKey,
            'X-Authentication': token,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ jsonrpc: '2.0', method, params, id: randomUUID() }),
        });
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw new BetfairError('TIMEOUT', `${op} timed out`, true);
        throw new BetfairError('NETWORK_ERROR', (e as Error).message, true);
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429) throw new BetfairError('TOO_MANY_REQUESTS', 'Rate limited', true);
      if (res.status >= 500) throw new BetfairError('SERVICE_UNAVAILABLE', `HTTP ${res.status}`, true);

      const body = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: { APINGException?: { errorCode: string }; AccountAPINGException?: { errorCode: string } } } };
      if (body.error) {
        const code = body.error.data?.APINGException?.errorCode ?? body.error.data?.AccountAPINGException?.errorCode ?? `RPC_${body.error.code}`;
        if (SESSION_ERRORS.has(code) && !retried) {
          this.session.invalidate();
          return this.call<T>(api, method, params, true);
        }
        throw new BetfairError(code, body.error.message);
      }
      this.lastSuccessAt = Date.now();
      this.observer?.({ operation: op, status: 'OK', durationMs: Date.now() - started });
      return body.result as T;
    } catch (err) {
      const code = err instanceof BetfairError ? err.betfairCode : 'UNKNOWN';
      this.lastError = code;
      this.observer?.({ operation: op, status: code === 'TIMEOUT' ? 'TIMEOUT' : 'ERROR', durationMs: Date.now() - started, errorCode: code });
      logger.warn({ integration: 'betfair', operation: op, errorCode: code }, 'betfair call failed');
      throw err;
    }
  }
}
