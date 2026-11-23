import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { pool } from './config/db.js';
import { env, isProd } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { requestContext } from './middleware/requestContext.js';
import { api } from './routes/index.js';
import { getBetfair } from './integrations/betfair/index.js';
import { odds } from './services/oddsService.js';
import { logger } from './utils/logger.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      autoLogging: { ignore: (req) => req.url === '/health' },
      customProps: (req) => ({ userId: (req as express.Request).user?.id, adminId: (req as express.Request).admin?.id }),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-CSRF-Token', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/health', async (_req, res) => {
    const checks: Record<string, unknown> = {};
    try {
      await pool.query('SELECT 1');
      checks.database = 'ok';
    } catch {
      checks.database = 'down';
    }
    const { client } = await getBetfair();
    const s = client.status();
    checks.betfair = { mode: s.mode, sessionValid: s.sessionValid, streamConnected: odds.isStreamConnected() || s.streamConnected };
    res.status(checks.database === 'ok' ? 200 : 503).json({ status: checks.database === 'ok' ? 'ok' : 'degraded', checks });
  });

  app.use('/api', globalLimiter, api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
