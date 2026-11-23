import { execute } from '../config/db.js';
import { getBetfair, setApiCallObserver } from '../integrations/betfair/index.js';
import { reconcileOpenOrders } from '../services/betService.js';
import { syncCatalogue } from '../services/marketService.js';
import { odds } from '../services/oddsService.js';
import { settleFromSnapshot, settlePendingMarkets } from '../services/settlementService.js';
import { logger } from '../utils/logger.js';

/**
 * Background jobs. Run on exactly one instance in a multi-node deployment
 * (JOBS_ENABLED=true on the worker, false on web nodes).
 */
const timers: NodeJS.Timeout[] = [];

function every(name: string, ms: number, fn: () => Promise<unknown>, runNow = false) {
  let running = false;
  const run = async () => {
    if (running) return; // never overlap
    running = true;
    const t = Date.now();
    try {
      await fn();
    } catch (err) {
      logger.error({ job: name, err: (err as Error).message }, 'job failed');
    } finally {
      running = false;
      if (Date.now() - t > ms) logger.warn({ job: name, ms: Date.now() - t }, 'job slower than its interval');
    }
  };
  if (runNow) void run();
  const timer = setInterval(run, ms);
  timer.unref();
  timers.push(timer);
}

/** Batch API metadata into api_logs to avoid one INSERT per Betfair call. */
function installApiLogger() {
  let buffer: unknown[][] = [];
  setApiCallObserver((e) => {
    buffer.push(['betfair', e.operation, e.status, e.durationMs, e.errorCode ?? null]);
    if (buffer.length > 500) buffer = buffer.slice(-500);
  });
  every('apiLogFlush', 5_000, async () => {
    if (!buffer.length) return;
    const rows = buffer;
    buffer = [];
    await execute('INSERT INTO api_logs (provider, operation, status, duration_ms, error_code) VALUES ?', [rows]);
  });
}

export async function startJobs() {
  installApiLogger();
  await getBetfair();
  await syncCatalogue().catch((err) => logger.error({ err: (err as Error).message }, 'initial catalogue sync failed'));
  await odds.start();
  odds.onClosed((snap) => void settleFromSnapshot(snap).catch((err) => logger.error({ err: (err as Error).message, marketId: snap.marketId }, 'auto-settlement failed')));

  every('catalogueSync', 5 * 60_000, syncCatalogue);
  every('reconcileOrders', 5_000, reconcileOpenOrders);
  every('settlePending', 30_000, settlePendingMarkets);
  every('housekeeping', 60 * 60_000, async () => {
    await execute(`DELETE FROM user_sessions WHERE expires_at < NOW(3) - INTERVAL 7 DAY`);
    await execute(`DELETE FROM admin_sessions WHERE expires_at < NOW(3) - INTERVAL 7 DAY`);
    await execute(`DELETE FROM auth_tokens WHERE expires_at < NOW(3) - INTERVAL 7 DAY`);
    await execute(`DELETE FROM idempotency_keys WHERE created_at < NOW(3) - INTERVAL 7 DAY`);
    await execute(`DELETE FROM api_logs WHERE created_at < NOW(3) - INTERVAL 30 DAY`);
    await execute(`DELETE FROM odds_snapshots WHERE captured_at < NOW(3) - INTERVAL 30 DAY`);
  }, true);
  logger.info('background jobs started');
}

export function stopJobs() {
  timers.forEach(clearInterval);
  odds.stop();
}
