import { describe, expect, it } from 'vitest';
import { pressureHpa, pressureTrend, temperatureF, windMph, buildGauges } from './gauges.ts';
import type { RepoMetrics } from '@wcg/shared';

describe('temperatureF', () => {
  it('is coldest at zero velocity and rises monotonically', () => {
    expect(temperatureF(0)).toBe(24);
    const readings = [0, 0.5, 1, 3, 8, 20].map(temperatureF);
    for (let i = 1; i < readings.length; i += 1) {
      expect(readings[i]!).toBeGreaterThan(readings[i - 1]!);
    }
  });

  it('compresses the top end so huge repos do not run away', () => {
    // Going 8 → 40 commits/day should add less warmth than 0 → 8 did.
    const lowSpan = temperatureF(8) - temperatureF(0);
    const highSpan = temperatureF(40) - temperatureF(8);
    expect(highSpan).toBeLessThan(lowSpan);
  });

  it('stays within a plausible temperature range', () => {
    for (const rate of [0, 1, 10, 100, 5000]) {
      expect(temperatureF(rate)).toBeGreaterThanOrEqual(24);
      expect(temperatureF(rate)).toBeLessThanOrEqual(110);
    }
  });

  it('treats negative input as calm rather than producing nonsense', () => {
    expect(temperatureF(-5)).toBe(24);
  });
});

describe('windMph', () => {
  it('is still air at zero churn and rises with churn', () => {
    expect(windMph(0)).toBe(0);
    expect(windMph(500)).toBeGreaterThan(windMph(50));
  });

  it('caps out rather than reporting absurd gusts', () => {
    expect(windMph(1_000_000)).toBeLessThanOrEqual(93);
  });
});

describe('pressureHpa', () => {
  it('reads standard pressure when nothing is being fixed', () => {
    expect(pressureHpa(0)).toBe(1013);
  });

  it('drops as the fix ratio climbs', () => {
    expect(pressureHpa(0.5)).toBeLessThan(pressureHpa(0.2));
    expect(pressureHpa(0.2)).toBeLessThan(pressureHpa(0));
  });

  it('floors out instead of going implausibly low', () => {
    expect(pressureHpa(1)).toBe(968);
  });
});

describe('pressureTrend', () => {
  it('reads a rising fix ratio as falling pressure', () => {
    expect(pressureTrend(0.02)).toBe('falling');
  });

  it('reads a shrinking fix ratio as rising pressure', () => {
    expect(pressureTrend(-0.02)).toBe('rising');
  });

  it('has a deadband so noise does not flip the barometer', () => {
    expect(pressureTrend(0)).toBe('steady');
    expect(pressureTrend(0.001)).toBe('steady');
    expect(pressureTrend(-0.001)).toBe('steady');
  });
});

describe('buildGauges', () => {
  it('maps ownership concentration onto humidity as a whole percentage', () => {
    const metrics = {
      windowDays: 30,
      totalCommits: 30,
      activeDays: 15,
      authors: 2,
      filesTouched: 10,
      commitsPerDay: 1,
      velocityTrend: 0,
      linesAdded: 300,
      linesDeleted: 100,
      churnPerDay: 13,
      rewriteChurn: 400,
      fixRatio: 0.1,
      ownershipConcentration: 0.625,
      commitSizeVariance: 0.3,
      daysSinceLastCommit: 1,
    } satisfies RepoMetrics;

    const gauges = buildGauges(metrics, 0);
    expect(gauges.humidityPct).toBe(63);
    expect(gauges.pressureTrend).toBe('steady');
    expect(Number.isFinite(gauges.temperatureF)).toBe(true);
    expect(Number.isFinite(gauges.windMph)).toBe(true);
  });
});
