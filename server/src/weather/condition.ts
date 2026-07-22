import type { RepoMetrics, WeatherCondition } from '@wcg/shared';
import type { RepoScores } from './score.ts';

/**
 * Dormancy and sparseness are checked *before* the trouble ramp, because they
 * describe an absence of signal rather than a degree of trouble. A repo nobody
 * has touched in a month is not "sunny" just because it has no churn.
 */
export const DORMANT_DAYS = 21;
/**
 * Below this daily commit rate there simply is not enough signal per day to read
 * a trend from, however many calendar days it is spread across.
 */
const SPARSE_COMMITS_PER_DAY = 0.45;
const SPARSE_ACTIVE_DAY_RATIO = 0.5;

/** Trouble-score cutoffs for the sunny → storm ramp. */
export const RAMP_THRESHOLDS = {
  partlyCloudy: 0.18,
  overcast: 0.33,
  rain: 0.47,
  storm: 0.62,
} as const;

export function classifyCondition(metrics: RepoMetrics, scores: RepoScores): WeatherCondition {
  // Nothing at all in the window: frozen over.
  if (metrics.totalCommits === 0) return 'snow';
  if (metrics.daysSinceLastCommit >= DORMANT_DAYS) return 'snow';

  // Active, but too thinly for any reading to mean much. Fog means "we cannot
  // see", not "things are bad", so it sits outside the trouble ramp.
  const activeRatio = metrics.activeDays / metrics.windowDays;
  if (
    metrics.commitsPerDay < SPARSE_COMMITS_PER_DAY &&
    activeRatio < SPARSE_ACTIVE_DAY_RATIO &&
    // A sparse repo that is also visibly on fire should still read as a storm.
    scores.trouble < RAMP_THRESHOLDS.rain
  ) {
    return 'fog';
  }

  const { trouble } = scores;
  if (trouble >= RAMP_THRESHOLDS.storm) return 'storm';
  if (trouble >= RAMP_THRESHOLDS.rain) return 'rain';
  if (trouble >= RAMP_THRESHOLDS.overcast) return 'overcast';
  if (trouble >= RAMP_THRESHOLDS.partlyCloudy) return 'partly-cloudy';
  return 'sunny';
}
