/**
 * Weather conditions, ordered from healthiest to least healthy. `fog` and `snow`
 * sit outside that ramp: they describe *absence* of signal rather than trouble.
 */
export type WeatherCondition =
  | 'sunny'
  | 'partly-cloudy'
  | 'overcast'
  | 'rain'
  | 'storm'
  | 'fog'
  | 'snow';

/** A registered repository the dashboard can analyze. */
export interface RepoSummary {
  id: string;
  name: string;
  path: string;
  addedAt: string;
}

/** Raw signals derived from the commit log, before any weather interpretation. */
export interface RepoMetrics {
  windowDays: number;
  totalCommits: number;
  activeDays: number;
  authors: number;
  filesTouched: number;
  /** Commits per calendar day across the window. */
  commitsPerDay: number;
  /** Slope of commits/day over the window. Positive means accelerating. */
  velocityTrend: number;
  linesAdded: number;
  linesDeleted: number;
  /** Lines changed per calendar day. */
  churnPerDay: number;
  /** Churn weighted so files rewritten again and again count for more. */
  rewriteChurn: number;
  /** Share of commits that look like fixes, reverts, or hotfixes. 0..1 */
  fixRatio: number;
  /** How concentrated authorship is. 0 = evenly shared, 1 = one author owns it all. */
  ownershipConcentration: number;
  /** Normalized dispersion of commit sizes. High means erratic, lurching changes. */
  commitSizeVariance: number;
  daysSinceLastCommit: number;
}

/**
 * Weather instrument readings. These are the metrics translated into units a
 * forecast can speak in, which is what makes the dashboard legible at a glance.
 */
export interface Gauges {
  /** Velocity as temperature. Warmer means more shipping. */
  temperatureF: number;
  /** Churn rate as wind speed. Gusty means lots of code moving. */
  windMph: number;
  /** Fix ratio as barometric pressure. Low pressure means trouble brewing. */
  pressureHpa: number;
  /** Where pressure is heading, derived from the fix-ratio trend. */
  pressureTrend: 'rising' | 'steady' | 'falling';
  /** Ownership concentration as humidity. Muggy means knowledge is trapped. */
  humidityPct: number;
}

export interface Advisory {
  level: 'info' | 'watch' | 'warning';
  title: string;
  detail: string;
}

export interface Forecast {
  condition: WeatherCondition;
  headline: string;
  summary: string;
  /**
   * 0..1 blended trouble score behind the condition. Exposed so the UI can scale
   * how busy a scene looks without reimplementing the weather model.
   */
  intensity: number;
  gauges: Gauges;
  advisories: Advisory[];
}

/** A single file rendered as its own weather cell on the hotspot map. */
export interface HotspotFile {
  path: string;
  commits: number;
  fixCommits: number;
  linesAdded: number;
  linesDeleted: number;
  churn: number;
  authors: number;
  /** 0..1 blend of change frequency and file size. */
  hotspotScore: number;
  condition: WeatherCondition;
  lastTouchedAt: string;
}

export interface TimelineDay {
  date: string;
  kind: 'observed' | 'projected';
  commits: number;
  churn: number;
  condition: WeatherCondition;
  temperatureF: number;
  windMph: number;
  /** Only present on projected days. 0..1 */
  confidence?: number;
}

export interface ForecastPayload {
  repo: RepoSummary;
  generatedAt: string;
  headSha: string;
  windowDays: number;
  forecast: Forecast;
  metrics: RepoMetrics;
  hotspots: HotspotFile[];
  timeline: TimelineDay[];
}

export interface AddRepoRequest {
  path: string;
}

export interface ReposResponse {
  repos: RepoSummary[];
}

export interface ApiErrorBody {
  error: string;
  code: string;
}
