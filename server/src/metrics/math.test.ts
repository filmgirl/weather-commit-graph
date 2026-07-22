import { describe, it, expect } from 'vitest';
import { clamp, unit, mean, stdDev, linearTrend, recencyWeight, gini } from './math.ts';

describe('clamp / unit', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('maps into 0..1 and treats non-finite as 0', () => {
    expect(unit(0.5)).toBe(0.5);
    expect(unit(2)).toBe(1);
    expect(unit(-2)).toBe(0);
    expect(unit(NaN)).toBe(0);
    expect(unit(Infinity)).toBe(1);
  });
});

describe('mean / stdDev', () => {
  it('averages', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([])).toBe(0);
  });

  it('computes population standard deviation', () => {
    expect(stdDev([2, 4, 6])).toBeCloseTo(1.632, 2);
    expect(stdDev([5, 5, 5])).toBe(0);
  });
});

describe('linearTrend', () => {
  it('is positive for a rising series', () => {
    expect(linearTrend([1, 2, 3, 4])).toBeCloseTo(1, 5);
  });

  it('is negative for a falling series', () => {
    expect(linearTrend([4, 3, 2, 1])).toBeCloseTo(-1, 5);
  });

  it('is zero for a flat series', () => {
    expect(linearTrend([3, 3, 3])).toBe(0);
  });

  it('is zero when there is too little data', () => {
    expect(linearTrend([7])).toBe(0);
    expect(linearTrend([])).toBe(0);
  });
});

describe('recencyWeight', () => {
  it('is 1 for something happening now', () => {
    expect(recencyWeight(0, 10)).toBe(1);
  });

  it('halves every half-life', () => {
    expect(recencyWeight(10, 10)).toBeCloseTo(0.5, 5);
    expect(recencyWeight(20, 10)).toBeCloseTo(0.25, 5);
  });

  it('decays monotonically', () => {
    expect(recencyWeight(5, 10)).toBeGreaterThan(recencyWeight(15, 10));
  });
});

describe('gini', () => {
  it('is 0 for a perfectly even split', () => {
    expect(gini([5, 5, 5, 5])).toBeCloseTo(0, 5);
  });

  it('approaches 1 as one holder dominates', () => {
    expect(gini([100, 1, 1, 1])).toBeGreaterThan(0.6);
  });

  it('is 1 for a single holder', () => {
    expect(gini([42])).toBe(1);
  });

  it('is 0 for nothing', () => {
    expect(gini([])).toBe(0);
    expect(gini([0, 0])).toBe(0);
  });

  it('ranks a concentrated split above an even one', () => {
    expect(gini([90, 5, 5])).toBeGreaterThan(gini([34, 33, 33]));
  });
});
