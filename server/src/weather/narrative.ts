import type { Advisory, HotspotFile, RepoMetrics, WeatherCondition } from '@wcg/shared';
import type { RepoScores } from './score.ts';
import { DORMANT_DAYS } from './condition.ts';

const HEADLINES: Record<WeatherCondition, string> = {
  sunny: 'Clear skies over the codebase',
  'partly-cloudy': 'Mostly clear with passing clouds',
  overcast: 'Overcast and closing in',
  rain: 'Steady rain across the tree',
  storm: 'Storm warning in effect',
  fog: 'Fog bank — visibility low',
  snow: 'Frozen over',
};

export function buildHeadline(condition: WeatherCondition): string {
  return HEADLINES[condition];
}

export function buildSummary(metrics: RepoMetrics, condition: WeatherCondition): string {
  if (condition === 'snow') {
    if (metrics.totalCommits === 0) {
      return `No commits in the last ${metrics.windowDays} days. Nothing to forecast yet.`;
    }
    return `Last commit was ${formatDays(metrics.daysSinceLastCommit)} ago. This repo has gone quiet.`;
  }

  const commits = `${metrics.totalCommits} ${plural(metrics.totalCommits, 'commit')}`;
  const authors = `${metrics.authors} ${plural(metrics.authors, 'author')}`;
  const activity = `${commits} from ${authors} across ${metrics.activeDays} of ${metrics.windowDays} days`;

  if (condition === 'fog') {
    return `${activity}. Too sparse to read a clear direction.`;
  }

  const churn = `${formatCount(metrics.linesAdded + metrics.linesDeleted)} lines changed`;
  const fixes = `${Math.round(metrics.fixRatio * 100)}% of commits look corrective`;
  return `${activity}, ${churn}. ${capitalize(fixes)}.`;
}

/**
 * Advisories are the actionable part of the forecast: each one names the specific
 * signal that pushed the weather, so the dashboard is diagnostic rather than just
 * decorative. Ordered most severe first.
 */
export function buildAdvisories(
  metrics: RepoMetrics,
  scores: RepoScores,
  hotspots: HotspotFile[],
): Advisory[] {
  const advisories: Advisory[] = [];

  if (metrics.totalCommits === 0) {
    advisories.push({
      level: 'info',
      title: 'No activity in window',
      detail: `Nothing has landed in the last ${metrics.windowDays} days. Widen the window or pick another repo.`,
    });
    return advisories;
  }

  if (metrics.daysSinceLastCommit >= DORMANT_DAYS) {
    advisories.push({
      level: 'watch',
      title: 'Repository is dormant',
      detail: `No commits for ${formatDays(metrics.daysSinceLastCommit)}. Recent-activity signals are stale.`,
    });
  }

  if (scores.fixPressure >= 0.6) {
    advisories.push({
      level: scores.fixPressure >= 0.85 ? 'warning' : 'watch',
      title: 'Heavy corrective churn',
      detail: `${Math.round(metrics.fixRatio * 100)}% of commits read as fixes or reverts. A high share of the work is undoing earlier work.`,
    });
  }

  const top = hotspots[0];
  if (top && scores.hotspotConcentration >= 0.5) {
    advisories.push({
      level: scores.hotspotConcentration >= 0.75 ? 'warning' : 'watch',
      title: 'Churn concentrated in one file',
      detail: `${top.path} absorbed ${formatCount(top.churn)} changed lines across ${top.commits} ${plural(top.commits, 'commit')}. Consider splitting it up.`,
    });
  }

  if (scores.concentration >= 0.7 && metrics.authors <= 2) {
    advisories.push({
      level: 'watch',
      title: 'Low bus factor',
      detail:
        metrics.authors === 1
          ? 'A single author wrote everything in this window. Knowledge is not being shared.'
          : `Just ${metrics.authors} authors carried this window, and the split is lopsided.`,
    });
  }

  if (scores.churnPressure >= 0.65) {
    advisories.push({
      level: 'watch',
      title: 'Very large commits',
      detail: `Averaging ${formatCount(Math.round((metrics.linesAdded + metrics.linesDeleted) / metrics.totalCommits))} changed lines per commit. Large commits are harder to review and to revert.`,
    });
  }

  if (scores.variance >= 0.7) {
    advisories.push({
      level: 'info',
      title: 'Erratic commit sizes',
      detail: 'Commit sizes swing widely, which usually means batched work landing in bursts.',
    });
  }

  if (metrics.velocityTrend <= -0.35) {
    advisories.push({
      level: 'info',
      title: 'Velocity cooling',
      detail: 'Commit rate has been trending down across the window.',
    });
  } else if (metrics.velocityTrend >= 0.35) {
    advisories.push({
      level: 'info',
      title: 'Velocity warming',
      detail: 'Commit rate has been trending up across the window.',
    });
  }

  if (advisories.length === 0) {
    advisories.push({
      level: 'info',
      title: 'Nothing to flag',
      detail: 'Velocity, churn, fix rate, and ownership all sit in healthy ranges.',
    });
  }

  const order = { warning: 0, watch: 1, info: 2 } as const;
  return advisories.sort((a, b) => order[a.level] - order[b.level]);
}

function formatDays(days: number): string {
  if (!Number.isFinite(days)) return 'an unknown time';
  const rounded = Math.round(days);
  return `${rounded} ${plural(rounded, 'day')}`;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
