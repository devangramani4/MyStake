import { AppError, type ErrorCode } from '../../utils/errors.js';

/**
 * Internal error carrying the raw Betfair error code. Never sent to clients;
 * `toAppError` maps it to a safe, user-facing code.
 */
export class BetfairError extends Error {
  constructor(
    readonly betfairCode: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

const MAP: Record<string, ErrorCode> = {
  // Session / auth
  INVALID_SESSION_INFORMATION: 'EXCHANGE_UNAVAILABLE',
  NO_SESSION: 'EXCHANGE_UNAVAILABLE',
  INVALID_APP_KEY: 'EXCHANGE_UNAVAILABLE',
  // Order instruction errors
  MARKET_SUSPENDED: 'MARKET_SUSPENDED',
  MARKET_NOT_OPEN_FOR_BETTING: 'MARKET_CLOSED',
  MARKET_NOT_OPEN_FOR_BSP_BETTING: 'MARKET_CLOSED',
  RUNNER_REMOVED: 'RUNNER_NOT_ACTIVE',
  INVALID_RUNNER: 'RUNNER_NOT_ACTIVE',
  INVALID_ODDS: 'INVALID_PRICE',
  INVALID_BET_SIZE: 'INVALID_STAKE',
  BET_TAKEN_OR_LAPSED: 'ODDS_CHANGED',
  INSUFFICIENT_FUNDS: 'EXCHANGE_REJECTED',
  LOSS_LIMIT_EXCEEDED: 'EXCHANGE_REJECTED',
  DUPLICATE_TRANSACTION: 'DUPLICATE_REQUEST',
  DUPLICATE_BETIDS: 'DUPLICATE_REQUEST',
  ERROR_IN_ORDER: 'EXCHANGE_REJECTED',
  TIMEOUT_ERROR: 'EXCHANGE_TIMEOUT',
  TIMEOUT: 'EXCHANGE_TIMEOUT',
  TOO_MANY_REQUESTS: 'EXCHANGE_UNAVAILABLE',
  SERVICE_UNAVAILABLE: 'EXCHANGE_UNAVAILABLE',
  NETWORK_ERROR: 'EXCHANGE_UNAVAILABLE',
};

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  MARKET_SUSPENDED: 'This market is suspended. Please try again shortly.',
  MARKET_CLOSED: 'This market is closed for betting.',
  RUNNER_NOT_ACTIVE: 'This selection is no longer available.',
  INVALID_PRICE: 'The odds entered are not valid.',
  INVALID_STAKE: 'The stake entered is not valid.',
  ODDS_CHANGED: 'The odds have changed. Please review your bet.',
  DUPLICATE_REQUEST: 'This bet has already been submitted.',
  EXCHANGE_TIMEOUT: 'The exchange did not respond in time. Check My Bets before retrying.',
  EXCHANGE_UNAVAILABLE: 'The exchange is temporarily unavailable. Please try again shortly.',
  EXCHANGE_REJECTED: 'The exchange rejected this bet. Please try again.',
};

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const code: ErrorCode = err instanceof BetfairError ? (MAP[err.betfairCode] ?? 'EXCHANGE_UNAVAILABLE') : 'EXCHANGE_UNAVAILABLE';
  return new AppError(code, MESSAGES[code] ?? 'The exchange is temporarily unavailable.');
}
