import type { Cents } from './money.js';

/**
 * Betfair exchange price ladder. Valid odds increments by band:
 * https://docs.developer.betfair.com/display/1smk3cen4v3lu3yomq5qye0ni/placeOrders#placeOrders-BetfairPriceIncrements
 */
const LADDER: Array<[min: number, max: number, step: number]> = [
  [1.01, 2, 0.01],
  [2, 3, 0.02],
  [3, 4, 0.05],
  [4, 6, 0.1],
  [6, 10, 0.2],
  [10, 20, 0.5],
  [20, 30, 1],
  [30, 50, 2],
  [50, 100, 5],
  [100, 1000, 10],
];

export const MIN_PRICE = 1.01;
export const MAX_PRICE = 1000;

/** Work in hundredths to avoid float error. */
const h = (n: number) => Math.round(n * 100);

export function isValidPrice(price: number): boolean {
  if (!Number.isFinite(price) || price < MIN_PRICE || price > MAX_PRICE) return false;
  const p = h(price);
  if (p !== price * 100 && Math.abs(p - price * 100) > 1e-6) return false;
  for (const [min, max, step] of LADDER) {
    if (p >= h(min) && p <= h(max)) {
      if ((p - h(min)) % h(step) === 0) return true;
    }
  }
  return false;
}

function bandFor(p: number, up: boolean) {
  return LADDER.find(([min, max]) => (up ? p >= h(min) && p < h(max) : p > h(min) && p <= h(max)));
}

/** Next valid tick above/below `price`. */
export function tick(price: number, direction: 1 | -1): number {
  const p = h(price);
  const band = bandFor(p, direction === 1);
  if (!band) return price;
  const next = p + direction * h(band[2]);
  return Math.min(Math.max(next, h(MIN_PRICE)), h(MAX_PRICE)) / 100;
}

/** Round an arbitrary price to the nearest valid ladder price. */
export function snapPrice(price: number): number {
  const p = Math.min(Math.max(h(price), h(MIN_PRICE)), h(MAX_PRICE));
  const band = LADDER.find(([min, max]) => p >= h(min) && p <= h(max))!;
  const step = h(band[2]);
  return (h(band[0]) + Math.round((p - h(band[0])) / step) * step) / 100;
}

export type Side = 'BACK' | 'LAY';

/**
 * Exchange bet maths (all money in cents):
 *  BACK: risk = stake;                   profit if selection wins  = stake × (odds − 1)
 *  LAY : risk = stake × (odds − 1);      profit if selection loses = stake (backer's stake)
 */
export function liability(side: Side, stake: Cents, price: number): Cents {
  return side === 'BACK' ? stake : Math.round((stake * h(price - 1)) / 100);
}

export function potentialProfit(side: Side, stake: Cents, price: number): Cents {
  return side === 'BACK' ? Math.round((stake * h(price - 1)) / 100) : stake;
}

/** Total returned to the customer on a winning outcome (risk returned + profit). */
export function potentialReturn(side: Side, stake: Cents, price: number): Cents {
  return liability(side, stake, price) + potentialProfit(side, stake, price);
}

/**
 * Outcome P&L for a matched amount at an average price.
 * `selectionWon` refers to the selection the bet was placed on.
 */
export function settlePnl(side: Side, matched: Cents, avgPrice: number, selectionWon: boolean): Cents {
  if (side === 'BACK') return selectionWon ? potentialProfit('BACK', matched, avgPrice) : -matched;
  return selectionWon ? -liability('LAY', matched, avgPrice) : matched;
}

/** Commission on net positive market winnings. */
export function commissionOn(netWinnings: Cents, rate: number): Cents {
  return netWinnings > 0 ? Math.round(netWinnings * rate) : 0;
}
