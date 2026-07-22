import type { Forecast, ForecastPayload, RepoSummary } from '@wcg/shared';
import type { RepoAnalysis } from '../metrics/engine.ts';
import { classifyCondition } from './condition.ts';
import { buildGauges } from './gauges.ts';
import { buildHotspots, DEFAULT_HOTSPOT_LIMIT } from './hotspots.ts';
import { buildAdvisories, buildHeadline, buildSummary } from './narrative.ts';
import { fixRatioTrend, scoreRepo, type RepoScores } from './score.ts';
import { buildTimeline, PROJECTION_DAYS } from './timeline.ts';

export interface ForecastOptions {
  windowDays: number;
  now?: Date;
  hotspotLimit?: number;
  projectionDays?: number;
}

export interface ForecastResult {
  forecast: Forecast;
  hotspots: ForecastPayload['hotspots'];
  timeline: ForecastPayload['timeline'];
  /** Exposed for tests and debugging; not part of the wire contract. */
  scores: RepoScores;
}

/**
 * Turns a raw analysis into a full forecast. This is the single seam between
 * "what the git log says" and "what the dashboard shows", so every weather
 * decision is made here and nowhere downstream.
 */
export function buildForecast(analysis: RepoAnalysis, options: ForecastOptions): ForecastResult {
  const now = options.now ?? new Date();
  const { windowDays } = options;

  const scores = scoreRepo(analysis);
  const condition = classifyCondition(analysis.metrics, scores);
  const hotspots = buildHotspots(analysis.files, options.hotspotLimit ?? DEFAULT_HOTSPOT_LIMIT);
  const timeline = buildTimeline(
    analysis,
    windowDays,
    now,
    options.projectionDays ?? PROJECTION_DAYS,
  );

  const forecast: Forecast = {
    condition,
    headline: buildHeadline(condition),
    summary: buildSummary(analysis.metrics, condition),
    gauges: buildGauges(analysis.metrics, fixRatioTrend(analysis, windowDays, now)),
    advisories: buildAdvisories(analysis.metrics, scores, hotspots),
  };

  return { forecast, hotspots, timeline, scores };
}

export function buildForecastPayload(
  repo: RepoSummary,
  headSha: string,
  analysis: RepoAnalysis,
  options: ForecastOptions,
): ForecastPayload {
  const { forecast, hotspots, timeline } = buildForecast(analysis, options);
  return {
    repo,
    generatedAt: (options.now ?? new Date()).toISOString(),
    headSha,
    windowDays: options.windowDays,
    forecast,
    metrics: analysis.metrics,
    hotspots,
    timeline,
  };
}
