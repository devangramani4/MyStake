import { createServer } from 'node:http';
import { createApp } from './src/app.js';
import { pool } from './src/config/db.js';
import { env } from './src/config/env.js';
import { startJobs, stopJobs } from './src/jobs/index.js';
import { odds } from './src/services/oddsService.js';
import { logger } from './src/utils/logger.js';
import { attachWebSocket } from './src/websocket/wsServer.js';

async function main() {
  const app = createApp();
  const server = createServer(app);
  attachWebSocket(server);
  if (env.JOBS_ENABLED) await startJobs();
  else await odds.start();

  server.listen(env.PORT, () => logger.info({ port: env.PORT, betfairMode: env.BETFAIR_MODE, env: env.NODE_ENV }, 'API listening'));

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopJobs();
    server.close(() => void pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
