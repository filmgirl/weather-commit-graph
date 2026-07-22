import type { RepoAnalysis, FileAggregate } from '../metrics/engine.ts';
import { unit } from '../metrics/math.ts';
import { dailySeries } from '../metrics/engine.ts';
import { linearTrend } from '../metrics/math.ts';

/**
 * Normalized 0..1 pressure signals, each reading "how much does this push the
 * forecast toward trouble". Keeping them size-independent is what lets a tiny
 * repo and a monorepo be scored on the same scale.
 */
export interface RepoScores {
  /** Corrective churn: high fix/revert ratio. */
  fixPressure: number;
  /** Average commit size relative to a calm baseline. Big commits churn hard. */
  churnPressure: number;
  /** Bus-factor risk: work concentrated in one or two authors. */
  concentration: number;
  /** How much of the churn is trapped in a single hot file. */
  hotspotConcentration: number;
  /** Erratic, lurching commit sizes. */
  variance: number;
  /** Cooling velocity contributes a little gloom even without churn. */
  velocityDrag: number;
  /** Blended 0..1 trouble score the condition ramp is cut from. */
  trouble: number;
}

// Tuned against the generated demo repos; see weather model tests for the anchors.
const FIX_RATIO_FULL = 0.45;
const CALM_COMMIT_CHURN = 55;
const HOT_COMMIT_CHURN = 260;

// Fix rate and churn are the primary trouble signals, so they carry most of the
// weight; the structural signals (concentration, hotspots, variance) modulate.
const WEIGHTS = {
  fixPressure: 0.34,
  churnPressure: 0.28,
  concentration: 0.13,
  hotspotConcentration: 0.13,
  variance: 0.12,
} as const;

export function scoreRepo(analysis: RepoAnalysis): RepoScores {
  const { metrics, files } = analysis;

  const fixPressure = unit(metrics.fixRatio / FIX_RATIO_FULL);

  const avgCommitChurn =
    metrics.totalCommits === 0
      ? 0
      : (metrics.linesAdded + metrics.linesDeleted) / metrics.totalCommits;
  const churnPressure = unit((avgCommitChurn - CALM_COMMIT_CHURN) / (HOT_COMMIT_CHURN - CALM_COMMIT_CHURN));

  // Concentration only matters once there is enough work to speak of; a two-commit
  // repo being "single author" is noise, not a storm.
  const activityFactor = unit(metrics.totalCommits / 12);
  const concentration = metrics.ownershipConcentration * activityFactor;

  const hotspotConcentration = topChurnShare(files);

  const velocityDrag = unit(-metrics.velocityTrend);

  const trouble =
    WEIGHTS.fixPressure * fixPressure +
    WEIGHTS.churnPressure * churnPressure +
    WEIGHTS.concentration * concentration +
    WEIGHTS.hotspotConcentration * hotspotConcentration +
    WEIGHTS.variance * metrics.commitSizeVariance +
    // Velocity drag is a light seasoning on top, not part of the core blend.
    0.08 * velocityDrag;

  return {
    fixPressure,
    churnPressure,
    concentration,
    hotspotConcentration,
    variance: metrics.commitSizeVariance,
    velocityDrag,
    trouble: unit(trouble),
  };
}

/**
 * Share of weighted churn held by the single hottest file, but only counted once
 * there are enough files that concentration is a real signal. A repo that only
 * touched one file this week is not a storm just for that.
 */
function topChurnShare(files: FileAggregate[]): number {
  if (files.length < 3) return 0;
  const weights = files.map((file) => file.weightedChurn);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  const top = Math.max(...weights);
  // Rescale: an even spread across N files gives share 1/N, so subtract that floor.
  const share = top / total;
  const floor = 1 / files.length;
  return unit((share - floor) / (1 - floor));
}

/**
 * Trend of the daily fix ratio across the window. Rising corrective work is a
 * falling barometer — the classic "storm incoming" reading.
 */
export function fixRatioTrend(analysis: RepoAnalysis, windowDays: number, now: Date): number {
  const dayMap = new Map(analysis.days.map((day) => [day.date, day]));
  const ratios = dailySeries(
    dayMap,
    (day) => (day && day.commits > 0 ? day.fixCommits / day.commits : 0),
    windowDays,
    now,
  );
  return linearTrend(ratios);
}
