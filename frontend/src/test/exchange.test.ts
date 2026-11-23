import { isValidPrice, liability, potentialReturn, profit, tick } from '../utils/exchange';

describe('exchange maths', () => {
  it('computes back and lay liability/profit', () => {
    expect(liability('BACK', 100, 1.85)).toBe(100);
    expect(profit('BACK', 100, 1.85)).toBe(85);
    expect(liability('LAY', 100, 1.9)).toBe(90);
    expect(profit('LAY', 100, 1.9)).toBe(100);
    expect(potentialReturn('BACK', 100, 2.1)).toBe(210);
  });
  it('validates and ticks the ladder', () => {
    expect(isValidPrice(2.02)).toBe(true);
    expect(isValidPrice(2.01)).toBe(false);
    expect(tick(1.99, 1)).toBe(2);
    expect(tick(2, -1)).toBe(1.99);
  });
});
