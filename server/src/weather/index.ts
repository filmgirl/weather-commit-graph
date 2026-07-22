export { classifyCondition, DORMANT_DAYS, RAMP_THRESHOLDS } from './condition.ts';
export { buildGauges, pressureHpa, pressureTrend, temperatureF, windMph } from './gauges.ts';
export { buildHotspots, DEFAULT_HOTSPOT_LIMIT } from './hotspots.ts';
export { buildAdvisories, buildHeadline, buildSummary } from './narrative.ts';
export { fixRatioTrend, scoreRepo, type RepoScores } from './score.ts';
export { buildTimeline, PROJECTION_DAYS } from './timeline.ts';
export {
  buildForecast,
  buildForecastPayload,
  type ForecastOptions,
  type ForecastResult,
} from './forecast.ts';
