// Runs before any test module is imported, so config/env.ts sees test values.
process.env.NODE_ENV = 'test';
process.env.DATABASE_NAME = process.env.TEST_DATABASE_NAME ?? 'betx_test';
process.env.BETFAIR_MODE = 'mock';
// Existing suites cover exchange mode; tests/integration/house.test.ts switches to house mode.
process.env.BET_EXECUTION_MODE = 'exchange';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789abcdef0123456789';
process.env.JWT_ADMIN_ACCESS_SECRET ??= 'test-admin-secret-0123456789abcdef0123456789';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.LOG_LEVEL = 'silent';
process.env.JOBS_ENABLED = 'false';
process.env.CORS_ORIGINS = 'http://localhost:5173';
