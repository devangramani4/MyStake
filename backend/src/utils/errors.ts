/**
 * Stable, client-safe error codes. The frontend maps these to friendly copy;
 * internal details (Betfair payloads, SQL errors) are logged but never sent.
 */
export const ErrorCodes = {
  VALIDATION_ERROR: 400,
  INVALID_STAKE: 400,
  INVALID_PRICE: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  TWO_FACTOR_REQUIRED: 401,
  INVALID_2FA_CODE: 401,
  FORBIDDEN: 403,
  ACCOUNT_SUSPENDED: 403,
  ACCOUNT_LOCKED: 403,
  SELF_EXCLUDED: 403,
  GEO_RESTRICTED: 403,
  BETTING_RESTRICTED: 403,
  KYC_REQUIRED: 403,
  EMAIL_NOT_VERIFIED: 403,
  TERMS_NOT_ACCEPTED: 403,
  CSRF_FAILED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_REQUEST: 409,
  REQUEST_IN_PROGRESS: 409,
  ODDS_CHANGED: 409,
  MARKET_SUSPENDED: 409,
  MARKET_CLOSED: 409,
  RUNNER_NOT_ACTIVE: 409,
  INSUFFICIENT_LIQUIDITY: 409,
  INSUFFICIENT_FUNDS: 422,
  LIMIT_EXCEEDED: 422,
  EXPOSURE_LIMIT_EXCEEDED: 422,
  DEPOSIT_LIMIT_EXCEEDED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  EXCHANGE_UNAVAILABLE: 502,
  EXCHANGE_TIMEOUT: 504,
  EXCHANGE_REJECTED: 502,
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = ErrorCodes[code];
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have permission to perform this action') => new AppError('FORBIDDEN', msg);
