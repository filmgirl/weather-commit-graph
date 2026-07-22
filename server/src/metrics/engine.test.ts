import { describe, it, expect } from 'vitest';
import { analyzeCommits, dayKeyOf } from './engine.ts';
import { readCommits } from '../git/log.ts';
import { readFileSizes } from '../git/tree.ts';
import type { CommitRecord, FileChange } from '../git/types.ts';
import { demoRepoPath } from '../../../scripts/seed-demo.ts';

const NOW = new Date('2026-07-20T12:00:00');

function daysAgo(n: number, hour = 12): Date {
  const date = new Date(NOW);
  date.setDate(date.getDate() - n);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function file(path: string, added: number, deleted: number): FileChange {
  return { path, added, deleted, binary: false };
}

let seq = 0;
function commit(
  date: Date,
  files: FileChange[],
  opts: { author?: string; subject?: string } = {},
): CommitRecord {
  seq += 1;
  return {
    sha: `sha${seq.toString(16).padStart(4, '0')}`,
    authorName: opts.author ?? 'Ada',
    authorEmail: `${opts.author ?? 'ada'}@example.invalid`,
    date,
    subject: opts.subject ?? 'feat: work',
    files,
  };
}

function analyze(commits: CommitRecord[], sizes: Record<string, number> = {}) {
  return analyzeCommits(commits, new Map(Object.entries(sizes)), {
    windowDays: 30,
    now: NOW,
  });
}

describe('analyzeCommits — synthetic control cases', () => {
  it('counts commits, authors, and files', () => {
    const { metrics } = analyze([
      commit(daysAgo(1), [file('a.ts', 10, 2)], { author: 'ada' }),
      commit(daysAgo(2), [file('b.ts', 5, 5)], { author: 'bo' }),
      commit(daysAgo(2), [file('a.ts', 3, 1)], { author: 'ada' }),
    ]);

    expect(metrics.totalCommits).toBe(3);
    expect(metrics.authors).toBe(2);
    expect(metrics.filesTouched).toBe(2);
    expect(metrics.activeDays).toBe(2);
    expect(metrics.linesAdded).toBe(18);
    expect(metrics.linesDeleted).toBe(8);
  });

  it('excludes vendored churn from the totals', () => {
    const { metrics, files } = analyze([
      commit(daysAgo(1), [file('src/a.ts', 10, 0), file('node_modules/x/index.js', 9999, 9999)]),
      commit(daysAgo(1), [file('package-lock.json', 5000, 4000)]),
    ]);

    expect(metrics.linesAdded).toBe(10);
    expect(metrics.linesDeleted).toBe(0);
    expect(files.map((f) => f.path)).toEqual(['src/a.ts']);
  });

  it('reports a rising commit trend as positive velocity', () => {
    const commits: CommitRecord[] = [];
    // Span the whole window so the slope is not confounded by empty leading days.
    for (let day = 29; day >= 0; day -= 1) {
      const perDay = day > 14 ? 1 : 4; // quiet early, busy recently
      for (let i = 0; i < perDay; i += 1) {
        commits.push(commit(daysAgo(day, 9 + i), [file('src/a.ts', 5, 1)]));
      }
    }

    expect(analyze(commits).metrics.velocityTrend).toBeGreaterThan(0);
  });

  it('reports a falling commit trend as negative velocity', () => {
    const commits: CommitRecord[] = [];
    for (let day = 29; day >= 0; day -= 1) {
      const perDay = day > 14 ? 4 : 1; // busy early, quiet recently
      for (let i = 0; i < perDay; i += 1) {
        commits.push(commit(daysAgo(day, 9 + i), [file('src/a.ts', 5, 1)]));
      }
    }

    expect(analyze(commits).metrics.velocityTrend).toBeLessThan(0);
  });

  it('computes fix ratio from commit subjects', () => {
    const { metrics } = analyze([
      commit(daysAgo(1), [file('a.ts', 1, 1)], { subject: 'feat: a' }),
      commit(daysAgo(1), [file('a.ts', 1, 1)], { subject: 'fix: b' }),
      commit(daysAgo(1), [file('a.ts', 1, 1)], { subject: 'fix: c' }),
      commit(daysAgo(1), [file('a.ts', 1, 1)], { subject: 'docs: d' }),
    ]);

    expect(metrics.fixRatio).toBeCloseTo(0.5, 5);
  });

  it('reads a single author as fully concentrated ownership', () => {
    const { metrics } = analyze([
      commit(daysAgo(1), [file('a.ts', 1, 1)], { author: 'solo' }),
      commit(daysAgo(2), [file('a.ts', 1, 1)], { author: 'solo' }),
    ]);

    expect(metrics.ownershipConcentration).toBe(1);
  });

  it('reads evenly shared work as low concentration', () => {
    const commits: CommitRecord[] = [];
    for (const author of ['ada', 'bo', 'chen', 'dara']) {
      for (let i = 0; i < 5; i += 1) {
        commits.push(commit(daysAgo(i + 1), [file('a.ts', 2, 1)], { author }));
      }
    }

    expect(analyze(commits).metrics.ownershipConcentration).toBeLessThan(0.2);
  });

  it('weights a repeatedly rewritten file above many once-touched files', () => {
    const hammered: CommitRecord[] = [];
    for (let i = 0; i < 10; i += 1) {
      hammered.push(commit(daysAgo(i + 1), [file('hot.ts', 40, 40)]));
    }
    const spread: CommitRecord[] = [];
    for (let i = 0; i < 10; i += 1) {
      spread.push(commit(daysAgo(i + 1), [file(`f${i}.ts`, 40, 40)]));
    }

    const hot = analyze(hammered).files.find((f) => f.path === 'hot.ts')!;
    const cold = analyze(spread).files.find((f) => f.path === 'f0.ts')!;
    // Same raw churn per touch, but the hammered file accrues far more weighted churn.
    expect(hot.weightedChurn).toBeGreaterThan(cold.weightedChurn * 3);
  });

  it('reports infinite days-since for an empty window', () => {
    const { metrics } = analyze([]);
    expect(metrics.totalCommits).toBe(0);
    expect(metrics.daysSinceLastCommit).toBe(Infinity);
    expect(metrics.fixRatio).toBe(0);
    expect(metrics.ownershipConcentration).toBe(0);
  });
});

describe('dayKeyOf', () => {
  it('formats a local date key', () => {
    expect(dayKeyOf(new Date('2026-07-05T23:00:00'))).toMatch(/^2026-07-0[56]$/);
  });
});

describe('analyzeCommits — against generated repos', () => {
  async function analyzeRepo(name: string, windowDays = 30) {
    const path = demoRepoPath(name);
    const commits = await readCommits(path, { windowDays });
    const sizes = await readFileSizes(path);
    return analyzeCommits(commits, sizes, { windowDays });
  }

  it('reads demo-sunny as healthy: low fix ratio, shared ownership', async () => {
    const { metrics } = await analyzeRepo('demo-sunny');
    expect(metrics.fixRatio).toBeLessThan(0.1);
    expect(metrics.ownershipConcentration).toBeLessThan(0.35);
    expect(metrics.commitsPerDay).toBeGreaterThan(1);
    expect(metrics.daysSinceLastCommit).toBeLessThan(3);
  });

  it('reads demo-stormy as troubled: high fix ratio, concentrated ownership', async () => {
    const { metrics, files } = await analyzeRepo('demo-stormy');
    expect(metrics.fixRatio).toBeGreaterThan(0.35);
    expect(metrics.ownershipConcentration).toBe(1);

    const ranked = [...files].sort((a, b) => b.weightedChurn - a.weightedChurn);
    expect(ranked[0]!.path).toBe('src/payments/reconciler.ts');
  });

  it('reads demo-rainy with a falling pressure signal (rising fix ratio)', async () => {
    const { metrics } = await analyzeRepo('demo-rainy');
    // Meaningful corrective work, but not the single-author storm.
    expect(metrics.fixRatio).toBeGreaterThan(0.15);
    expect(metrics.churnPerDay).toBeGreaterThan(0);
  });

  it('reads demo-dormant as empty inside the default window', async () => {
    const { metrics } = await analyzeRepo('demo-dormant');
    expect(metrics.totalCommits).toBe(0);
    expect(metrics.daysSinceLastCommit).toBe(Infinity);
  });

  it('sees demo-dormant history with a wide window, long since last commit', async () => {
    const { metrics } = await analyzeRepo('demo-dormant', 400);
    expect(metrics.totalCommits).toBeGreaterThan(50);
    expect(metrics.daysSinceLastCommit).toBeGreaterThan(120);
  });

  it('reads demo-foggy as sparse activity', async () => {
    const { metrics } = await analyzeRepo('demo-foggy');
    expect(metrics.totalCommits).toBeLessThan(20);
    expect(metrics.commitsPerDay).toBeLessThan(1);
  });
});
