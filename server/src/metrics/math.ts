/** Small numeric helpers shared across the metrics engine. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamp into 0..1, treating NaN as 0 so downstream scoring never poisons. */
export function unit(value: number): number {
  if (Number.isNaN(value)) return 0;
  return clamp(value, 0, 1);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Population standard deviation. */
export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

/**
 * Slope of a best-fit line through evenly spaced points (ordinary least squares
 * with x = 0,1,2,...). Used for velocity and pressure trends. Returns 0 when
 * there are too few points to define a direction.
 */
export function linearTrend(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - xMean;
    numerator += dx * (values[i]! - yMean);
    denominator += dx * dx;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Exponential recency weight for an event `daysAgo` in the past.
 *
 * Half-life form: an event loses half its weight every `halfLifeDays`. Recent
 * work should dominate the forecast, which is what makes the dashboard feel like
 * a *current* reading rather than a lifetime average.
 */
export function recencyWeight(daysAgo: number, halfLifeDays: number): number {
  if (daysAgo <= 0) return 1;
  return Math.pow(0.5, daysAgo / halfLifeDays);
}

/**
 * Gini coefficient over non-negative amounts: 0 when perfectly even, approaching
 * 1 when one contributor holds everything. Drives ownership concentration.
 */
export function gini(amounts: number[]): number {
  const values = amounts.filter((value) => value > 0).sort((a, b) => a - b);
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return 1;

  let cumulative = 0;
  let weighted = 0;
  for (let i = 0; i < n; i += 1) {
    cumulative += values[i]!;
    weighted += cumulative;
  }
  const total = cumulative;
  if (total === 0) return 0;
  // Standard discrete Gini from the cumulative-share formulation.
  return (n + 1 - (2 * weighted) / total) / n;
}
