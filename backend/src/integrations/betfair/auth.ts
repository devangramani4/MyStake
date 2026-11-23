import { readFileSync } from 'node:fs';
import https from 'node:https';
import { URL } from 'node:url';
import { logger } from '../../utils/logger.js';
import { BetfairError } from './errors.js';

export interface BetfairAuthConfig {
  appKey: string;
  username: string;
  password: string;
  certPath: string;
  keyPath?: string;
  identityUrl: string; // e.g. https://identitysso-cert.betfair.com/api
  timeoutMs: number;
}

const KEEP_ALIVE_URL = 'https://identitysso.betfair.com/api/keepAlive';
const KEEP_ALIVE_EVERY_MS = 30 * 60 * 1000;

function post(url: string, body: string, headers: Record<string, string>, agent: https.Agent | undefined, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { method: 'POST', hostname: u.hostname, path: u.pathname, agent, headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      },
    );
    req.on('timeout', () => req.destroy(new BetfairError('TIMEOUT', 'Betfair identity timeout', true)));
    req.on('error', (e) => reject(e instanceof BetfairError ? e : new BetfairError('NETWORK_ERROR', e.message, true)));
    req.end(body);
  });
}

/**
 * Non-interactive (certificate) login with automatic keep-alive.
 * Credentials are read from server-side environment only and never logged.
 */
export class BetfairSession {
  private token: string | null = null;
  private loginPromise: Promise<string> | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private readonly agent: https.Agent;

  constructor(private readonly cfg: BetfairAuthConfig) {
    const cert = readFileSync(cfg.certPath);
    // A combined PEM may hold both cert and key; otherwise use BETFAIR_KEY_PATH.
    const key = cfg.keyPath ? readFileSync(cfg.keyPath) : cert;
    this.agent = new https.Agent({ cert, key, keepAlive: true });
  }

  get appKey() {
    return this.cfg.appKey;
  }

  isValid() {
    return this.token !== null;
  }

  async getToken(): Promise<string> {
    if (this.token) return this.token;
    return this.login();
  }

  /** De-duplicates concurrent logins. */
  login(): Promise<string> {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = (async () => {
      const body = new URLSearchParams({ username: this.cfg.username, password: this.cfg.password }).toString();
      const raw = await post(
        `${this.cfg.identityUrl}/certlogin`,
        body,
        { 'X-Application': this.cfg.appKey, 'Content-Type': 'application/x-www-form-urlencoded' },
        this.agent,
        this.cfg.timeoutMs,
      );
      const res = JSON.parse(raw) as { sessionToken?: string; loginStatus: string };
      if (res.loginStatus !== 'SUCCESS' || !res.sessionToken) {
        throw new BetfairError(`LOGIN_${res.loginStatus}`, 'Betfair login failed');
      }
      this.token = res.sessionToken;
      this.scheduleKeepAlive();
      logger.info({ integration: 'betfair' }, 'betfair session established');
      return this.token;
    })().finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  invalidate() {
    this.token = null;
  }

  private scheduleKeepAlive() {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = setInterval(() => void this.keepAlive(), KEEP_ALIVE_EVERY_MS);
    this.keepAliveTimer.unref();
  }

  async keepAlive() {
    if (!this.token) return;
    try {
      const raw = await post(KEEP_ALIVE_URL, '', { 'X-Application': this.cfg.appKey, 'X-Authentication': this.token, Accept: 'application/json' }, undefined, this.cfg.timeoutMs);
      const res = JSON.parse(raw) as { status: string; error?: string };
      if (res.status !== 'SUCCESS') {
        logger.warn({ integration: 'betfair', error: res.error }, 'betfair keepAlive failed; re-login on next call');
        this.invalidate();
      }
    } catch (err) {
      logger.warn({ integration: 'betfair', err: (err as Error).message }, 'betfair keepAlive error');
    }
  }

  stop() {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
  }
}
