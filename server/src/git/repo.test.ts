import { describe, it, expect, beforeAll } from 'vitest';
import { access } from 'node:fs/promises';
import { resolveRepo, resolveGitDir } from './repo.ts';
import { readCommits } from './log.ts';
import { readFileSizes } from './tree.ts';
import { GitError } from './exec.ts';
import { demoRepoPath } from '../../../scripts/seed-demo.ts';

const sunny = demoRepoPath('demo-sunny');
const stormy = demoRepoPath('demo-stormy');
const dormant = demoRepoPath('demo-dormant');

beforeAll(async () => {
  try {
    await access(sunny);
  } catch {
    throw new Error('demo repos are missing — run "npm run seed:demo" first');
  }
});

describe('resolveRepo', () => {
  it('resolves a demo repo to a canonical identity', async () => {
    const repo = await resolveRepo(sunny);

    expect(repo.name).toBe('demo-sunny');
    expect(repo.path).toContain('demo-sunny');
    expect(repo.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(repo.branch).toBe('main');
  });

  it('resolves a path inside the repo up to the work tree root', async () => {
    const repo = await resolveRepo(`${sunny}/src`);

    expect(repo.path).toBe((await resolveRepo(sunny)).path);
  });

  it('rejects a directory that is not a git repository', async () => {
    await expect(resolveRepo('/tmp')).rejects.toThrow(GitError);
  });

  it('rejects a path that does not exist', async () => {
    await expect(resolveRepo('/definitely/not/here/at/all')).rejects.toThrow(/no such directory/);
  });

  it('rejects a relative path', async () => {
    await expect(resolveRepo('./somewhere')).rejects.toThrow(/must be absolute/);
  });

  it('rejects an empty path', async () => {
    await expect(resolveRepo('   ')).rejects.toThrow(/required/);
  });

  it('finds the git dir for watching', async () => {
    const gitDir = await resolveGitDir(sunny);

    expect(gitDir.endsWith('/.git')).toBe(true);
  });
});

describe('readCommits against generated repos', () => {
  it('reads the sunny repo as steady low-churn work by several authors', async () => {
    const commits = await readCommits(sunny, { windowDays: 30 });

    expect(commits.length).toBeGreaterThan(60);
    const authors = new Set(commits.map((c) => c.authorEmail));
    expect(authors.size).toBe(4);

    const churn = commits.reduce(
      (sum, c) => sum + c.files.reduce((s, f) => s + f.added + f.deleted, 0),
      0,
    );
    // Small, contained commits: well under a hundred lines each on average.
    expect(churn / commits.length).toBeLessThan(100);
  });

  it('returns commits newest first', async () => {
    const commits = await readCommits(sunny, { windowDays: 30 });
    const times = commits.map((c) => c.date.getTime());

    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('reads the stormy repo as one dominant hotspot file', async () => {
    const commits = await readCommits(stormy, { windowDays: 30 });

    const churnByFile = new Map<string, number>();
    for (const commit of commits) {
      for (const file of commit.files) {
        churnByFile.set(file.path, (churnByFile.get(file.path) ?? 0) + file.added + file.deleted);
      }
    }

    const ranked = [...churnByFile].sort((a, b) => b[1] - a[1]);
    const total = [...churnByFile.values()].reduce((a, b) => a + b, 0);

    expect(ranked[0]![0]).toBe('src/payments/reconciler.ts');
    expect(ranked[0]![1] / total).toBeGreaterThan(0.7);
  });

  it('sees a single author across the stormy repo', async () => {
    const commits = await readCommits(stormy, { windowDays: 30 });

    expect(new Set(commits.map((c) => c.authorEmail)).size).toBe(1);
  });

  it('finds fix commits in the stormy repo and few in the sunny one', async () => {
    const isFix = (subject: string) => /^(fix|revert|hotfix)/i.test(subject);

    const stormCommits = await readCommits(stormy, { windowDays: 30 });
    const sunnyCommits = await readCommits(sunny, { windowDays: 30 });

    const stormFixRatio = stormCommits.filter((c) => isFix(c.subject)).length / stormCommits.length;
    const sunnyFixRatio = sunnyCommits.filter((c) => isFix(c.subject)).length / sunnyCommits.length;

    expect(stormFixRatio).toBeGreaterThan(0.35);
    expect(sunnyFixRatio).toBeLessThan(0.1);
  });

  it('returns nothing for a dormant repo inside the default window', async () => {
    const commits = await readCommits(dormant, { windowDays: 30 });

    expect(commits).toEqual([]);
  });

  it('finds the dormant history with a wide enough window', async () => {
    const commits = await readCommits(dormant, { windowDays: 400 });

    expect(commits.length).toBeGreaterThan(50);
  });

  it('respects the max commit ceiling', async () => {
    const commits = await readCommits(stormy, { windowDays: 30, maxCommits: 5 });

    expect(commits).toHaveLength(5);
  });
});

describe('readFileSizes', () => {
  it('reports the hotspot file as the largest tracked file', async () => {
    const sizes = await readFileSizes(stormy);

    expect(sizes.size).toBeGreaterThan(3);
    const ranked = [...sizes].sort((a, b) => b[1] - a[1]);
    expect(ranked[0]![0]).toBe('src/payments/reconciler.ts');
    expect(ranked[0]![1]).toBeGreaterThan(1000);
  });

  it('covers every file touched in the window', async () => {
    const sizes = await readFileSizes(sunny);
    const commits = await readCommits(sunny, { windowDays: 30 });
    const touched = new Set(commits.flatMap((c) => c.files.map((f) => f.path)));

    for (const path of touched) {
      expect(sizes.has(path)).toBe(true);
    }
  });
});
