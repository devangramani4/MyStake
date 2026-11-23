import { config } from '../config';

const moneyFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFmt = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const symbol: Record<string, string> = { INR: '₹', GBP: '£', EUR: '€', USD: '$' };

export const money = (v: string | number | null | undefined, currency = config.currency) =>
  `${symbol[currency] ?? ''}${moneyFmt.format(Number(v ?? 0))}`;

export const signedMoney = (v: string | number | null | undefined, currency = config.currency) => {
  const n = Number(v ?? 0);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n), currency)}`;
};

export const compact = (v: number | string) => `${symbol[config.currency] ?? ''}${compactFmt.format(Number(v))}`;
export const odds = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '—' : Number(v).toFixed(2));

export function kickoff(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 86_400_000).toDateString() === d.toDateString();
  if (sameDay) return `Today ${time}`;
  if (tomorrow) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

export const dateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const statusLabel: Record<string, string> = {
  PENDING: 'Pending', UNMATCHED: 'Unmatched', PARTIALLY_MATCHED: 'Part matched', MATCHED: 'Matched', CANCELLED: 'Cancelled',
  LAPSED: 'Lapsed', FAILED: 'Failed', SETTLED: 'Settled', VOIDED: 'Void', WIN: 'Won', LOSS: 'Lost', VOID: 'Void', PARTIAL: 'Partial',
};
