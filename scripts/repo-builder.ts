import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Rng } from './rng.ts';

const run = promisify(execFile);

export interface Author {
  name: string;
  email: string;
}

export interface EditSpec {
  /** Lines appended or spliced in. */
  add?: number;
  /** Existing lines removed. */
  remove?: number;
  /** Existing lines rewritten in place (counts as one add and one delete each). */
  modify?: number;
}

export interface CommitOptions {
  daysAgo: number;
  hour?: number;
  minute?: number;
  author: Author;
  message: string;
}

/**
 * Builds a throwaway git repository one commit at a time.
 *
 * Files are held in memory as line arrays so edits can be expressed as precise
 * add/remove/modify counts. That matters because the whole point of the demo
 * repos is to produce known `git log --numstat` output.
 */
export class RepoBuilder {
  private readonly files = new Map<string, string[]>();
  private readonly dirty = new Set<string>();
  private commitCount = 0;
  /** Monotonic clock: guarantees each commit is strictly newer than the last. */
  private lastEpochMs = 0;

  readonly dir: string;
  private readonly rng: Rng;

  constructor(dir: string, rng: Rng) {
    this.dir = dir;
    this.rng = rng;
  }

  async init(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
    await mkdir(this.dir, { recursive: true });
    await this.git(['init', '--quiet', '-b', 'main']);
    // Local config only, so the generator never depends on (or disturbs) global
    // git settings. Signing is force-disabled: a machine with commit.gpgsign on
    // globally would otherwise fail every scripted commit.
    await this.git(['config', 'user.name', 'Demo Seeder']);
    await this.git(['config', 'user.email', 'seeder@example.invalid']);
    await this.git(['config', 'commit.gpgsign', 'false']);
    await this.git(['config', 'tag.gpgsign', 'false']);
    await this.git(['config', 'core.hooksPath', '/dev/null']);
  }

  /** Loads tracked files from disk so an existing repo can be appended to. */
  async loadFromDisk(): Promise<void> {
    const { stdout } = await this.git(['ls-files']);
    const tracked = stdout.split('\n').filter(Boolean);
    for (const file of tracked) {
      const content = await readFile(path.join(this.dir, file), 'utf8');
      this.files.set(file, content.split('\n'));
    }

    // Anchor the monotonic clock past the newest existing commit so appended
    // commits are strictly newer than the seeded history.
    const { stdout: headDate } = await this.git(['log', '-1', '--format=%cI']);
    const head = new Date(headDate.trim());
    if (!Number.isNaN(head.getTime())) this.lastEpochMs = head.getTime();
  }

  async lastCommitCount(): Promise<number> {
    const { stdout } = await this.git(['rev-list', '--count', 'HEAD']);
    return Number(stdout.trim());
  }

  seedFile(file: string, lineCount: number): void {
    const lines: string[] = [];
    for (let i = 0; i < lineCount; i += 1) {
      lines.push(this.generateLine(file, i));
    }
    this.files.set(file, lines);
    this.dirty.add(file);
  }

  hasFile(file: string): boolean {
    return this.files.has(file);
  }

  fileNames(): string[] {
    return [...this.files.keys()];
  }

  edit(file: string, spec: EditSpec): void {
    let lines = this.files.get(file);
    if (!lines) {
      lines = [];
      this.files.set(file, lines);
    }

    const modify = Math.min(spec.modify ?? 0, lines.length);
    for (let i = 0; i < modify; i += 1) {
      const index = this.rng.int(0, lines.length - 1);
      lines[index] = this.generateLine(file, index);
    }

    const remove = Math.min(spec.remove ?? 0, Math.max(0, lines.length - 4));
    for (let i = 0; i < remove; i += 1) {
      lines.splice(this.rng.int(0, lines.length - 1), 1);
    }

    const add = spec.add ?? 0;
    for (let i = 0; i < add; i += 1) {
      const index = lines.length === 0 ? 0 : this.rng.int(0, lines.length);
      lines.splice(index, 0, this.generateLine(file, index));
    }

    this.dirty.add(file);
  }

  async commit(options: CommitOptions): Promise<void> {
    for (const file of this.dirty) {
      const target = path.join(this.dir, file);
      await mkdir(path.dirname(target), { recursive: true });
      const lines = this.files.get(file) ?? [];
      await writeFile(target, `${lines.join('\n')}\n`, 'utf8');
    }
    this.dirty.clear();

    const when = this.nextTimestamp(options.daysAgo, options.hour ?? 10, options.minute ?? 0);
    await this.git(['add', '-A']);
    await this.git(['commit', '--quiet', '--no-verify', '-m', options.message], {
      GIT_AUTHOR_NAME: options.author.name,
      GIT_AUTHOR_EMAIL: options.author.email,
      GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_NAME: options.author.name,
      GIT_COMMITTER_EMAIL: options.author.email,
      GIT_COMMITTER_DATE: when,
    });
    this.commitCount += 1;
  }

  get commits(): number {
    return this.commitCount;
  }

  /**
   * Produces an ISO timestamp for a commit that is always strictly newer than
   * the previous one. Real histories have parents older than children, and the
   * adapter and metrics both assume commits can be read newest-first, so the
   * generator must not emit out-of-order intra-day times.
   */
  private nextTimestamp(daysAgo: number, hour: number, minute: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - daysAgo);
    date.setUTCHours(hour, minute, 0, 0);
    let epoch = date.getTime();
    if (epoch <= this.lastEpochMs) epoch = this.lastEpochMs + 60_000;
    this.lastEpochMs = epoch;
    return new Date(epoch).toISOString();
  }

  private generateLine(file: string, index: number): string {
    const token = this.rng.int(0, 0xffff).toString(16).padStart(4, '0');
    if (file.endsWith('.md')) {
      return `- ${this.rng.pick(PROSE)} (${token})`;
    }
    const template = this.rng.pick(CODE_LINES);
    return template.replace('$N', String(index)).replace('$T', token);
  }

  private git(
    args: string[],
    env?: Record<string, string>,
  ): Promise<{ stdout: string; stderr: string }> {
    // execFile with an argument array: never build a shell string from data.
    return run('git', args, {
      cwd: this.dir,
      env: { ...process.env, ...env },
      maxBuffer: 32 * 1024 * 1024,
    });
  }
}

const CODE_LINES = [
  '  const value$N = resolve("$T");',
  '  if (!ctx.ready) return fallback($N);',
  '  logger.debug("step $N", { id: "$T" });',
  '  total += weightFor($N) * scale;',
  '  await queue.push({ key: "$T", attempt: $N });',
  '  return items.filter((item) => item.kind === "$T");',
  '  // handles the $T edge case discovered in $N',
  '  cache.set("$T", computeSlowPath($N));',
  '  invariant(state !== undefined, "missing state $N");',
  '  const [head, ...rest] = partition($N, "$T");',
];

const PROSE = [
  'Document the retry semantics',
  'Note the migration ordering',
  'Clarify the rollout plan',
  'Record the on-call handoff',
  'Explain the cache invalidation rule',
];
