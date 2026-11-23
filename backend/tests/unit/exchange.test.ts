import { describe, expect, it } from 'vitest';
import { commissionOn, isValidPrice, liability, potentialProfit, potentialReturn, settlePnl, snapPrice, tick } from '../../src/utils/exchange.js';
import { fromCents, toCents } from '../../src/utils/money.js';

describe('price ladder', () => {
  it.each([1.01, 1.5, 1.99, 2, 2.02, 3.05, 4.1, 6.2, 10.5, 25, 32, 55, 110, 1000])('accepts %s', (p) => expect(isValidPrice(p)).toBe(true));
  it.each([1, 1.005, 2.01, 3.01, 4.05, 6.1, 10.2, 21.5, 31, 52, 105, 1001, NaN])('rejects %s', (p) => expect(isValidPrice(p)).toBe(false));
  it('ticks across band boundaries', () => {
    expect(tick(1.99, 1)).toBe(2);
    expect(tick(2, 1)).toBe(2.02);
    expect(tick(2, -1)).toBe(1.99);
    expect(tick(3, -1)).toBe(2.98);
    expect(tick(1000, 1)).toBe(1000);
  });
  it('snaps arbitrary prices to the ladder', () => {
    expect(snapPrice(2.013)).toBe(2.02);
    expect(snapPrice(7.33)).toBe(7.4);
    expect(isValidPrice(snapPrice(123.4))).toBe(true);
  });
});

describe('exchange maths (cents)', () => {
  it('back bet: liability = stake, profit = stake × (odds − 1)', () => {
    expect(liability('BACK', 10000, 1.85)).toBe(10000);
    expect(potentialProfit('BACK', 10000, 1.85)).toBe(8500);
    expect(potentialReturn('BACK', 10000, 1.85)).toBe(18500);
  });
  it('lay bet: liability = stake × (odds − 1), profit = stake', () => {
    expect(liability('LAY', 10000, 1.9)).toBe(9000);
    expect(potentialProfit('LAY', 10000, 1.9)).toBe(10000);
    expect(liability('LAY', 3333, 2.02)).toBe(3400);
  });
  it('settles P&L for each side/outcome', () => {
    expect(settlePnl('BACK', 10000, 2.5, true)).toBe(15000);
    expect(settlePnl('BACK', 10000, 2.5, false)).toBe(-10000);
    expect(settlePnl('LAY', 10000, 2.5, true)).toBe(-15000);
    expect(settlePnl('LAY', 10000, 2.5, false)).toBe(10000);
  });
  it('charges commission only on net winnings', () => {
    expect(commissionOn(10000, 0.02)).toBe(200);
    expect(commissionOn(-5000, 0.02)).toBe(0);
  });
});

describe('money', () => {
  it('round-trips decimals without float drift', () => {
    expect(toCents('0.10') + toCents('0.20')).toBe(30);
    expect(fromCents(toCents('1234.56'))).toBe('1234.56');
    expect(fromCents(-5)).toBe('-0.05');
    expect(toCents(19.99)).toBe(1999);
  });
});
