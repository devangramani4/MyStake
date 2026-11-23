import type { BetItem, Notification, Page, Transaction, User, Wallet } from '../../types';
import { newIdempotencyKey } from '../../utils/id';
import { http } from './http';

export interface Limits {
  maxStake: string | null; maxExposure: string | null; dailyDepositLimit: string | null; weeklyDepositLimit: string | null; monthlyDepositLimit: string | null;
  dailyLossLimit: string | null; selfExcludedUntil: string | null; coolingOffUntil: string | null; pendingChanges: Record<string, string | null> | null; pendingEffectiveAt: string | null;
}
export interface Session { id: string; userAgent: string | null; ip: string | null; signedInAt: string; lastActiveAt: string; current: boolean }
export interface Deposit { id: string; amount: string; currency: string; status: string; createdAt: string; instructions?: string }
export interface Withdrawal { id: string; amount: string; currency: string; method: string; destination: string | null; status: string; reviewNote: string | null; createdAt: string }

export const walletApi = {
  summary: () => http.get<Wallet>('/wallet').then((r) => r.data),
  transactions: (params: Record<string, unknown>) => http.get<Page<Transaction>>('/wallet/transactions', { params }).then((r) => r.data),
  deposit: (amount: number, key = newIdempotencyKey()) => http.post<{ deposit: Deposit }>('/wallet/deposits', { amount }, { headers: { 'Idempotency-Key': key } }).then((r) => r.data.deposit),
  deposits: (page = 1) => http.get<Page<Deposit>>('/wallet/deposits', { params: { page } }).then((r) => r.data),
  withdraw: (body: { amount: number; method: string; destination?: string }, key = newIdempotencyKey()) =>
    http.post<{ withdrawal: Withdrawal }>('/wallet/withdrawals', body, { headers: { 'Idempotency-Key': key } }).then((r) => r.data.withdrawal),
  withdrawals: (page = 1) => http.get<Page<Withdrawal>>('/wallet/withdrawals', { params: { page } }).then((r) => r.data),
  cancelWithdrawal: (id: string) => http.post(`/wallet/withdrawals/${id}/cancel`),
};

export const userApi = {
  update: (body: { firstName?: string; lastName?: string }) => http.patch<{ user: User }>('/me', body).then((r) => r.data.user),
  acceptTerms: () => http.post<{ user: User }>('/me/accept-terms').then((r) => r.data.user),
  changePassword: (currentPassword: string, newPassword: string) => http.post('/me/password', { currentPassword, newPassword }),
  sessions: () => http.get<{ items: Session[] }>('/me/sessions').then((r) => r.data.items),
  revokeSession: (id: string) => http.delete(`/me/sessions/${id}`),
  setup2fa: () => http.post<{ otpauthUrl: string; secret: string }>('/me/2fa/setup').then((r) => r.data),
  enable2fa: (code: string) => http.post('/me/2fa/enable', { code }),
  disable2fa: (password: string, code: string) => http.post('/me/2fa/disable', { password, code }),
  limits: () => http.get<Limits>('/me/limits').then((r) => r.data),
  setLimits: (body: Record<string, number | null>) => http.put<{ applied: Record<string, unknown>; pending: Record<string, unknown> }>('/me/limits', body).then((r) => r.data),
  selfExclude: (period: string, password: string) => http.post('/me/self-exclusion', { period, password }),
  coolOff: (hours: number) => http.post('/me/cool-off', { hours }),
  notifications: (page = 1) => http.get<Page<Notification> & { unread: number }>('/me/notifications', { params: { page } }).then((r) => r.data),
  markRead: (ids: number[] | 'all') => http.post('/me/notifications/read', { ids }),
};

export const betsApi = {
  list: (params: Record<string, unknown>) => http.get<Page<BetItem>>('/bets', { params }).then((r) => r.data),
  cancel: (id: string) => http.post<BetItem>(`/bets/${id}/cancel`).then((r) => r.data),
  replace: (id: string, price: number) => http.post<BetItem>(`/bets/${id}/replace`, { price }).then((r) => r.data),
};
