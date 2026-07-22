import type { Gauges, RepoMetrics } from '@wcg/shared';
import { clamp } from '../metrics/math.ts';

/**
 * Velocity as temperature. The curve is logarithmic so that going from 0 to 1
 * commit/day feels like a real warm-up while 20 vs 30 commits/day both just read
 * "hot" — which matches how differently sized repos actually feel.
 */
const TEMP_FLOOR_F = 24;
const TEMP_CEILING_F = 96;

export function temperatureF(commitsPerDay: number): number {
  const warmth = Math.log10(1 + Math.max(0, commitsPerDay) * 4) / Math.log10(1 + 8 * 4);
  return round(TEMP_FLOOR_F + clamp(warmth, 0, 1.15) * (TEMP_CEILING_F - TEMP_FLOOR_F));
}

/** Churn as wind speed. Also logarithmic; 2000 lines/day is a gale, not 20x a breeze. */
export function windMph(churnPerDay: number): number {
  const gust = Math.log10(1 + Math.max(0, churnPerDay)) / Math.log10(1 + 1200);
  return round(clamp(gust, 0, 1.25) * 74, 1);
}

/**
 * Fix ratio as barometric pressure, inverted: lots of corrective work means the
 * barometer is dropping. 1013 hPa is standard sea-level pressure — a calm repo.
 */
const PRESSURE_STANDARD = 1013;
const PRESSURE_MIN = 968;

export function pressureHpa(fixRatio: number): number {
  const drop = clamp(fixRatio / 0.5, 0, 1) * (PRESSURE_STANDARD - PRESSURE_MIN);
  return round(PRESSURE_STANDARD - drop);
}

const TREND_DEADBAND = 0.004;

export function pressureTrend(fixRatioSlope: number): Gauges['pressureTrend'] {
  // Rising fix ratio means falling pressure, hence the inversion.
  if (fixRatioSlope > TREND_DEADBAND) return 'falling';
  if (fixRatioSlope < -TREND_DEADBAND) return 'rising';
  return 'steady';
}

export function buildGauges(metrics: RepoMetrics, fixRatioSlope: number): Gauges {
  return {
    temperatureF: temperatureF(metrics.commitsPerDay),
    windMph: windMph(metrics.churnPerDay),
    pressureHpa: pressureHpa(metrics.fixRatio),
    pressureTrend: pressureTrend(fixRatioSlope),
    humidityPct: Math.round(clamp(metrics.ownershipConcentration, 0, 1) * 100),
  };
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
