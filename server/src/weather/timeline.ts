import type { TimelineDay } from '@wcg/shared';
import type { DayAggregate, RepoAnalysis } from '../metrics/engine.ts';
import { dayKeyOf } from '../metrics/engine.ts';
import { clamp, mean, unit } from '../metrics/math.ts';
import { temperatureF, windMph } from './gauges.ts';

/** How many days of forward projection the forecast strip shows. */
export const PROJECTION_DAYS = 3;

/**
 * Builds the day-by-day strip: observed days from the log, then a short forward
 * projection. The projection is deliberately humble — a weighted average of the
 * recent past nudged by the trend, with confidence decaying each day out. We are
 * forecasting mood, not pretending to predict commits.
 */
export function buildTimeline(
  analysis: RepoAnalysis,
  windowDays: number,
  now: Date,
  projectionDays = PROJECTION_DAYS,
): TimelineDay[] {
  const dayMap = new Map(analysis.days.map((day) => [day.date, day]));
  const observed: TimelineDay[] = [];

  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (windowDays - 1));

  for (let i = 0; i < windowDays; i += 1) {
    const key = dayKeyOf(cursor);
    observed.push(observedDay(key, dayMap.get(key)));
    cursor.setDate(cursor.getDate() + 1);
  }

  return [...observed, ...projectDays(observed, now, projectionDays, analysis.metrics.velocityTrend)];
}

function observedDay(date: string, day: DayAggregate | undefined): TimelineDay {
  const commits = day?.commits ?? 0;
  const churn = (day?.added ?? 0) + (day?.deleted ?? 0);
  const fixRatio = commits === 0 ? 0 : (day?.fixCommits ?? 0) / commits;

  return {
    date,
    kind: 'observed',
    commits,
    churn,
    condition: dayCondition(commits, churn, fixRatio),
    temperatureF: temperatureF(commits),
    windMph: windMph(churn),
  };
}

/**
 * Per-day condition. A single day is far too small a sample for the full trouble
 * model, so this reads only the three things a day can actually say: did anything
 * land, how violent was it, and how much of it was corrective.
 */
function dayCondition(commits: number, churn: number, fixRatio: number): TimelineDay['condition'] {
  if (commits === 0) return 'snow';

  const intensity = unit(churn / 900);
  const trouble = unit(intensity * 0.6 + fixRatio * 0.55);

  if (trouble >= 0.6) return 'storm';
  if (trouble >= 0.4) return 'rain';
  if (trouble >= 0.24) return 'overcast';
  if (trouble >= 0.1) return 'partly-cloudy';
  return 'sunny';
}

function projectDays(
  observed: TimelineDay[],
  now: Date,
  projectionDays: number,
  velocityTrend: number,
): TimelineDay[] {
  if (projectionDays <= 0) return [];

  // Weight the last week most heavily, but keep a little memory of the fortnight
  // before it so one loud day does not define the whole outlook.
  const recent = observed.slice(-7);
  const prior = observed.slice(-21, -7);
  const recentCommits = mean(recent.map((day) => day.commits));
  const priorCommits = prior.length > 0 ? mean(prior.map((day) => day.commits)) : recentCommits;
  const recentChurn = mean(recent.map((day) => day.churn));
  const priorChurn = prior.length > 0 ? mean(prior.map((day) => day.churn)) : recentChurn;

  const baseCommits = recentCommits * 0.75 + priorCommits * 0.25;
  const baseChurn = recentChurn * 0.75 + priorChurn * 0.25;
  const recentFixRatio = fixShare(recent);

  const projected: TimelineDay[] = [];
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  for (let step = 1; step <= projectionDays; step += 1) {
    cursor.setDate(cursor.getDate() + 1);
    // Let the trend carry forward, but damp it hard so it cannot run away.
    const drift = 1 + clamp(velocityTrend, -0.5, 0.5) * step * 0.15;
    const commits = Math.max(0, baseCommits * drift);
    const churn = Math.max(0, baseChurn * drift);

    projected.push({
      date: dayKeyOf(cursor),
      kind: 'projected',
      commits: round(commits, 1),
      churn: Math.round(churn),
      condition: dayCondition(commits, churn, recentFixRatio),
      temperatureF: temperatureF(commits),
      windMph: windMph(churn),
      confidence: round(Math.max(0.2, 0.75 - (step - 1) * 0.18), 2),
    });
  }

  return projected;
}

function fixShare(days: TimelineDay[]): number {
  const stormy = days.filter((day) => day.condition === 'storm' || day.condition === 'rain').length;
  const active = days.filter((day) => day.commits > 0).length;
  return active === 0 ? 0 : stormy / active;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
