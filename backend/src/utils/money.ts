/**
 * Money is handled as integer minor units (cents/paise) in application code
 * to avoid floating-point drift. DB columns are DECIMAL(18,2).
 */
export type Cents = number;

export function toCents(value: string | number | null | undefined): Cents {
  if (value === null || value === undefined || value === '') return 0;
  const s = typeof value === 'number' ? value.toFixed(2) : value.trim();
  const neg = s.startsWith('-');
  const [whole, frac = ''] = (neg ? s.slice(1) : s).split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isFinite(cents)) throw new Error(`Invalid money value: ${value}`);
  return neg ? -cents : cents;
}

/** Cents → DECIMAL string for SQL parameters and API responses. */
export function fromCents(cents: Cents): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

export const centsToNumber = (c: Cents): number => Math.round(c) / 100;
