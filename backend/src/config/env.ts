import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const list = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : []));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_NAME: z.string().default('BetX'),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
  TRUST_PROXY: z.coerce.number().int().default(0),

  DATABASE_HOST: z.string().default('127.0.0.1'),
  DATABASE_PORT: z.coerce.number().int().default(3306),
  DATABASE_USER: z.string().default('betx'),
  DATABASE_PASSWORD: z.string().default(''),
  DATABASE_NAME: z.string().default('betx'),
  DATABASE_POOL_SIZE: z.coerce.number().int().default(20),
  DATABASE_SSL: bool,

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_ADMIN_ACCESS_SECRET: z.string().min(32, 'JWT_ADMIN_ACCESS_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  ADMIN_REFRESH_TOKEN_TTL_HOURS: z.coerce.number().int().default(12),
  COOKIE_SECURE: bool,
  COOKIE_DOMAIN: z.string().optional(),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be 32 bytes hex'),

  BETFAIR_MODE: z.enum(['mock', 'live']).default('mock'),
  BETFAIR_APP_KEY: z.string().optional(),
  BETFAIR_USERNAME: z.string().optional(),
  BETFAIR_PASSWORD: z.string().optional(),
  BETFAIR_CERT_PATH: z.string().optional(),
  BETFAIR_KEY_PATH: z.string().optional(),
  BETFAIR_API_URL: z.string().url().default('https://api.betfair.com/exchange'),
  BETFAIR_IDENTITY_URL: z.string().url().default('https://identitysso-cert.betfair.com/api'),
  BETFAIR_STREAM_HOST: z.string().default('stream-api.betfair.com'),
  BETFAIR_STREAMING: bool,
  BETFAIR_TIMEOUT_MS: z.coerce.number().int().default(8000),
  BETFAIR_EVENT_TYPE_IDS: z.string().default('4,1,2,7522,7511,7524,998917,5,3,6,26420387,7,27454571'),
  BETFAIR_PLACE_ORDERS: bool,
  ALLOW_MOCK_IN_PRODUCTION: bool,

  COMMISSION_RATE: z.coerce.number().min(0).max(0.2).default(0.02),
  MIN_STAKE: z.coerce.number().positive().default(10),
  MIN_AGE: z.coerce.number().int().default(18),
  TERMS_VERSION: z.string().default('1.0'),
  GEO_COUNTRY_HEADER: z.string().default('cf-ipcountry'),
  GEO_BLOCKED_COUNTRIES: list,
  GEO_ALLOWED_COUNTRIES: list,
  PAYMENT_PROVIDER: z.enum(['manual', 'mock']).default('mock'),
  DEFAULT_CURRENCY: z.string().length(3).default('INR'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('no-reply@example.com'),

  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  JOBS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Print field names only — never values, which may be secrets.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

if (env.NODE_ENV === 'production') {
  if (env.BETFAIR_MODE === 'mock' && !env.ALLOW_MOCK_IN_PRODUCTION) {
    throw new Error('BETFAIR_MODE=mock is not allowed in production. Set BETFAIR_MODE=live.');
  }
  if (env.PAYMENT_PROVIDER === 'mock' && !env.ALLOW_MOCK_IN_PRODUCTION) {
    throw new Error('PAYMENT_PROVIDER=mock is not allowed in production.');
  }
  if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production.');
}

if (env.BETFAIR_MODE === 'live') {
  for (const key of ['BETFAIR_APP_KEY', 'BETFAIR_USERNAME', 'BETFAIR_PASSWORD', 'BETFAIR_CERT_PATH'] as const) {
    if (!env[key]) throw new Error(`${key} is required when BETFAIR_MODE=live`);
  }
}

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
