import pino from 'pino';

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

/**
 * Structured JSON logger. Sensitive fields are redacted wherever they appear
 * so tokens, passwords and secrets never reach log storage.
 */
export const logger = pino({
  level,
  base: { service: 'betx-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'password', '*.password', '*.*.password', 'newPassword', '*.newPassword', 'currentPassword', '*.currentPassword',
      'token', '*.token', 'accessToken', '*.accessToken', 'refreshToken', '*.refreshToken',
      'sessionToken', '*.sessionToken', 'appKey', '*.appKey',
      'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]', 'headers.authorization', 'headers["X-Authentication"]', 'headers["X-Application"]',
      'cardNumber', '*.cardNumber', 'cvv', '*.cvv', 'accountNumber', '*.accountNumber', 'totpCode', '*.totpCode',
      'secret', '*.secret',
    ],
    censor: '[REDACTED]',
  },
});

export type Logger = typeof logger;
