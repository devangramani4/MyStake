import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { NullScoreProvider, type ScoreProvider } from '../scores/types.js';
import { BetfairSession } from './auth.js';
import type { ApiCallObserver, BetfairClient, MarketStream } from './client.js';
import { createLiveClient } from './liveClient.js';
import { BetfairStream, PollingStream } from './stream.js';

export interface BetfairIntegration {
  client: BetfairClient;
  stream: MarketStream;
  scores: ScoreProvider;
  /** Only present in mock mode — exposes simulator controls for tests/dev tools. */
  mock?: import('./mock/mockExchange.js').MockExchange;
}

let instance: BetfairIntegration | null = null;
let observer: ApiCallObserver | undefined;

export function setApiCallObserver(o: ApiCallObserver) {
  observer = o;
}

/**
 * Builds the integration once per process based on BETFAIR_MODE.
 * Mock modules are imported dynamically so they are never loaded in live mode.
 */
export async function getBetfair(): Promise<BetfairIntegration> {
  if (instance) return instance;
  if (env.BETFAIR_MODE === 'mock') {
    const { MockExchange } = await import('./mock/mockExchange.js');
    const { MockScoreProvider } = await import('./mock/mockScores.js');
    const ex = new MockExchange({ autoSimulate: env.NODE_ENV !== 'test' });
    logger.warn({ integration: 'betfair' }, 'BETFAIR_MODE=mock — using simulated exchange data (development only)');
    instance = { client: ex.client(), stream: ex.stream(), scores: env.NODE_ENV === 'test' ? new NullScoreProvider() : new MockScoreProvider(ex), mock: ex };
    return instance;
  }
  const session = new BetfairSession({
    appKey: env.BETFAIR_APP_KEY!,
    username: env.BETFAIR_USERNAME!,
    password: env.BETFAIR_PASSWORD!,
    certPath: env.BETFAIR_CERT_PATH!,
    keyPath: env.BETFAIR_KEY_PATH,
    identityUrl: env.BETFAIR_IDENTITY_URL,
    timeoutMs: env.BETFAIR_TIMEOUT_MS,
  });
  let stream: MarketStream;
  const client = createLiveClient(session, env.BETFAIR_API_URL, env.BETFAIR_TIMEOUT_MS, (e) => observer?.(e), () => stream.isConnected());
  stream = env.BETFAIR_STREAMING ? new BetfairStream(session, env.BETFAIR_STREAM_HOST) : new PollingStream((ids) => client.listMarketBook(ids));
  instance = { client, stream, scores: new NullScoreProvider() };
  return instance;
}

/** Test helper: inject a custom integration (e.g. a fresh MockExchange). */
export function setBetfairForTests(i: BetfairIntegration | null) {
  instance = i;
}
