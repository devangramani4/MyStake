import type { Side } from '../types';

/** Betfair price ladder (mirrors backend utils/exchange.ts). */
const LADDER: Array<[number, number, number]> = [
  [1.01, 2, 0.01], [2, 3, 0.02], [3, 4, 0.05], [4, 6, 0.1], [6, 10, 0.2],
  [10, 20, 0.5], [20, 30, 1], [30, 50, 2], [50, 100, 5], [100, 1000, 10],
];
const h = (n: number) => Math.round(n * 100);

export function isValidPrice(price: number): boolean {
  if (!Number.isFinite(price) || price < 1.01 || price > 1000) return false;
  const p = h(price);
  if (Math.abs(p - price * 100) > 1e-6) return false;
  return LADDER.some(([min, max, step]) => p >= h(min) && p <= h(max) && (p - h(min)) % h(step) === 0);
}

export function tick(price: number, dir: 1 | -1): number {
  const p = h(price);
  const band = LADDER.find(([min, max]) => (dir === 1 ? p >= h(min) && p < h(max) : p > h(min) && p <= h(max)));
  if (!band) return price;
  return Math.min(Math.max(p + dir * h(band[2]), 101), 100000) / 100;
}

const cents = (n: number) => Math.round(n * 100);

/** Amount at risk. BACK: stake. LAY: stake × (odds − 1). */
export const liability = (side: Side, stake: number, price: number) => (side === 'BACK' ? cents(stake) : Math.round(cents(stake) * (price - 1))) / 100;
/** Profit if the bet wins. BACK: stake × (odds − 1). LAY: backer's stake. */
export const profit = (side: Side, stake: number, price: number) => (side === 'BACK' ? Math.round(cents(stake) * (price - 1)) : cents(stake)) / 100;
/** Total returned on a win (risk returned + profit), before commission. */
export const potentialReturn = (side: Side, stake: number, price: number) => liability(side, stake, price) + profit(side, stake, price);
