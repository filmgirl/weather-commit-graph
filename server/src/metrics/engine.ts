import type { RepoMetrics } from '@wcg/shared';
import type { CommitRecord } from '../git/types.ts';
import { isVendoredPath } from './filters.ts';
import { isFixCommit } from './fix-detection.ts';
import {
  gini,
  linearTrend,
  mean,
  recencyWeight,
  stdDev,
  unit,
} from './math.ts';

export interface FileAggregate {
  path: string;
  commits: number;
  fixCommits: number;
  added: number;
  deleted: number;
  churn: number;
  /** Churn scaled up each time the same file is rewritten again, then decayed. */
  weightedChurn: number;
  authors: Set<string>;
  sizeBytes: number;
  lastTouched: Date;
}

export interface DayAggregate {
  /** Local YYYY-MM-DD. */
  date: string;
  commits: number;
  added: number;
  deleted: number;
  fixCommits: number;
}

export interface AuthorAggregate {
  email: string;
  name: string;
  commits: number;
  churn: number;
}

/**
 * The full picture derived from a commit window: the headline metrics plus the
 * per-file and per-day breakdowns the weather model, hotspot map, and timeline
 * are built from. Computed once per request so nothing is parsed twice.
 */
export interface RepoAnalysis {
  metrics: RepoMetrics;
  files: FileAggregate[];
  days: DayAggregate[];
  authors: AuthorAggregate[];
}

export interface AnalyzeOptions {
  windowDays: number;
  /** Recency half-life in days. Recent work counts for more. */
  halfLifeDays?: number;
  now?: Date;
}

const DEFAULT_HALF_LIFE_DAYS = 10;

export function analyzeCommits(
  commits: CommitRecord[],
  fileSizes: Map<string, number>,
  options: AnalyzeOptions,
): RepoAnalysis {
  const { windowDays } = options;
  const now = options.now ?? new Date();
  const halfLife = options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;

  const files = new Map<string, FileAggregate>();
  const days = new Map<string, DayAggregate>();
  const authors = new Map<string, AuthorAggregate>();
  const commitSizes: number[] = [];

  let totalAdded = 0;
  let totalDeleted = 0;
  let fixCommits = 0;
  let lastCommitDate: Date | null = null;

  for (const commit of commits) {
    if (!lastCommitDate || commit.date > lastCommitDate) lastCommitDate = commit.date;

    const fix = isFixCommit(commit.subject);
    if (fix) fixCommits += 1;

    const daysAgo = daysBetween(commit.date, now);
    const weight = recencyWeight(daysAgo, halfLife);

    const dayKey = dayKeyOf(commit.date);
    const day = days.get(dayKey) ?? { date: dayKey, commits: 0, added: 0, deleted: 0, fixCommits: 0 };
    day.commits += 1;
    if (fix) day.fixCommits += 1;

    let commitChurn = 0;
    for (const change of commit.files) {
      if (change.binary || isVendoredPath(change.path)) continue;
      const churn = change.added + change.deleted;
      commitChurn += churn;

      const file = files.get(change.path) ?? newFileAggregate(change.path, fileSizes);
      file.commits += 1;
      if (fix) file.fixCommits += 1;
      file.added += change.added;
      file.deleted += change.deleted;
      file.churn += churn;
      // Each subsequent rewrite of the same file is weighted more heavily: a file
      // churned across N commits is more worrying than N files churned once.
      file.weightedChurn += churn * (1 + Math.log2(file.commits)) * weight;
      file.authors.add(commit.authorEmail);
      if (commit.date > file.lastTouched) file.lastTouched = commit.date;
      files.set(change.path, file);
    }

    day.added += sumAdded(commit);
    day.deleted += sumDeleted(commit);
    days.set(dayKey, day);

    totalAdded += sumAdded(commit);
    totalDeleted += sumDeleted(commit);
    commitSizes.push(commitChurn);

    const author = authors.get(commit.authorEmail) ?? {
      email: commit.authorEmail,
      name: commit.authorName,
      commits: 0,
      churn: 0,
    };
    author.commits += 1;
    author.churn += commitChurn;
    authors.set(commit.authorEmail, author);
  }

  const totalCommits = commits.length;
  const churn = totalAdded + totalDeleted;
  const rewriteChurn = [...files.values()].reduce((sum, file) => sum + file.weightedChurn, 0);

  const metrics: RepoMetrics = {
    windowDays,
    totalCommits,
    activeDays: days.size,
    authors: authors.size,
    filesTouched: files.size,
    commitsPerDay: totalCommits / windowDays,
    velocityTrend: velocityTrend(days, windowDays, now),
    linesAdded: totalAdded,
    linesDeleted: totalDeleted,
    churnPerDay: churn / windowDays,
    rewriteChurn,
    fixRatio: totalCommits === 0 ? 0 : fixCommits / totalCommits,
    ownershipConcentration: ownershipConcentration([...authors.values()]),
    commitSizeVariance: commitSizeVariance(commitSizes),
    daysSinceLastCommit: lastCommitDate ? daysBetween(lastCommitDate, now) : Infinity,
  };

  return {
    metrics,
    files: [...files.values()],
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    authors: [...authors.values()].sort((a, b) => b.commits - a.commits),
  };
}

function newFileAggregate(path: string, sizes: Map<string, number>): FileAggregate {
  return {
    path,
    commits: 0,
    fixCommits: 0,
    added: 0,
    deleted: 0,
    churn: 0,
    weightedChurn: 0,
    authors: new Set(),
    sizeBytes: sizes.get(path) ?? 0,
    lastTouched: new Date(0),
  };
}

function sumAdded(commit: CommitRecord): number {
  return commit.files.reduce(
    (sum, change) => (change.binary || isVendoredPath(change.path) ? sum : sum + change.added),
    0,
  );
}

function sumDeleted(commit: CommitRecord): number {
  return commit.files.reduce(
    (sum, change) => (change.binary || isVendoredPath(change.path) ? sum : sum + change.deleted),
    0,
  );
}

/**
 * Slope of daily commit counts across the window, normalized by the average
 * daily rate so the trend reads the same for a busy repo and a quiet one.
 * Positive means accelerating, negative means cooling off.
 */
function velocityTrend(days: Map<string, DayAggregate>, windowDays: number, now: Date): number {
  const series = dailySeries(days, (day) => day?.commits ?? 0, windowDays, now);
  const slope = linearTrend(series);
  const avg = mean(series);
  if (avg === 0) return 0;
  return slope / avg;
}

/** Normalized dispersion of commit sizes (coefficient of variation), capped at 1. */
function commitSizeVariance(sizes: number[]): number {
  if (sizes.length < 2) return 0;
  const avg = mean(sizes);
  if (avg === 0) return 0;
  return unit(stdDev(sizes) / avg / 2);
}

function ownershipConcentration(authors: AuthorAggregate[]): number {
  if (authors.length <= 1) return authors.length === 1 ? 1 : 0;
  return unit(gini(authors.map((author) => author.commits)));
}

/** Builds a dense day-by-day series across the window, filling gaps with zeros. */
export function dailySeries(
  days: Map<string, DayAggregate>,
  pick: (day: DayAggregate | undefined) => number,
  windowDays: number,
  now: Date,
): number[] {
  const series: number[] = [];
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (windowDays - 1));
  for (let i = 0; i < windowDays; i += 1) {
    series.push(pick(days.get(dayKeyOf(cursor))));
    cursor.setDate(cursor.getDate() + 1);
  }
  return series;
}

export function dayKeyOf(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysBetween(earlier: Date, later: Date): number {
  const ms = later.getTime() - earlier.getTime();
  return ms / 86_400_000;
}
