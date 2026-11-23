import axios from 'axios';
import type { ApiErrorBody } from '../types';

/** User-facing copy per backend error code. Internal details are never shown. */
const MESSAGES: Record<string, string> = {
  NETWORK_ERROR: 'Network problem — check your connection and try again.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
  RATE_LIMITED: "You're going a bit fast. Please wait a moment.",
  UNAUTHORIZED: 'Please log in to continue.',
  TOKEN_EXPIRED: 'Your session expired. Please log in again.',
  INSUFFICIENT_FUNDS: 'Insufficient balance for this bet.',
  MARKET_SUSPENDED: 'This market is suspended. Please try again shortly.',
  MARKET_CLOSED: 'This market is closed for betting.',
  ODDS_CHANGED: 'The odds have changed. Review the new price and try again.',
  INSUFFICIENT_LIQUIDITY: 'Not enough money is available at these odds.',
  DUPLICATE_REQUEST: 'This bet has already been submitted.',
  EXCHANGE_TIMEOUT: "The exchange didn't respond in time. Check My Bets before retrying.",
  EXCHANGE_UNAVAILABLE: 'The exchange is temporarily unavailable.',
  EXCHANGE_REJECTED: 'The exchange rejected this bet. Please try again.',
};

export interface AppErrorInfo { code: string; message: string; details?: Record<string, unknown>; status?: number }

export function toAppError(err: unknown): AppErrorInfo {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data?.error as ApiErrorBody | undefined;
    if (body) return { code: body.code, message: body.message || MESSAGES[body.code] || MESSAGES.INTERNAL_ERROR, details: body.details, status: err.response?.status };
    if (!err.response) return { code: 'NETWORK_ERROR', message: MESSAGES.NETWORK_ERROR };
    return { code: 'INTERNAL_ERROR', message: MESSAGES.INTERNAL_ERROR, status: err.response.status };
  }
  return { code: 'INTERNAL_ERROR', message: MESSAGES.INTERNAL_ERROR };
}

export const errorMessage = (err: unknown) => toAppError(err).message;

export function fieldErrors(err: unknown): Record<string, string> {
  const e = toAppError(err);
  const fields = (e.details?.fields as Array<{ path: string; message: string }>) ?? [];
  return Object.fromEntries(fields.map((f) => [f.path, f.message]));
}
