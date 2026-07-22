import { gitLines } from './exec.ts';
import type { CommitRecord, FileChange } from './types.ts';

const RECORD_SEP = '\x1e';
const FIELD_SEP = '\x1f';

export interface ReadCommitsOptions {
  windowDays: number;
  /** Hard ceiling so a huge monorepo cannot exhaust memory on one request. */
  maxCommits?: number;
}

export const DEFAULT_MAX_COMMITS = 20_000;

/**
 * Incremental parser for `git log --numstat` output.
 *
 * Kept separate from the git invocation so it can be unit tested against
 * literal log text, including the awkward cases: binary files, renames, and
 * commits that touch nothing at all.
 */
export class CommitLogParser {
  private readonly commits: CommitRecord[] = [];
  private current: CommitRecord | null = null;

  push(line: string): void {
    if (line.startsWith(RECORD_SEP)) {
      this.flush();
      this.current = parseHeader(line.slice(RECORD_SEP.length));
      return;
    }

    if (line.trim() === '' || !this.current) return;

    const change = parseNumstat(line);
    if (change) this.current.files.push(change);
  }

  finish(): CommitRecord[] {
    this.flush();
    return this.commits;
  }

  private flush(): void {
    if (this.current) this.commits.push(this.current);
    this.current = null;
  }
}

function parseHeader(header: string): CommitRecord | null {
  const [sha, authorName, authorEmail, isoDate, ...rest] = header.split(FIELD_SEP);
  if (!sha || !isoDate) return null;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;

  return {
    sha,
    authorName: authorName ?? '',
    authorEmail: authorEmail ?? '',
    date,
    // A subject containing the field separator would have been split; rejoin it.
    subject: rest.join(FIELD_SEP),
    files: [],
  };
}

function parseNumstat(line: string): FileChange | null {
  const parts = line.split('\t');
  if (parts.length < 3) return null;

  const [addedRaw, deletedRaw, ...pathParts] = parts;
  const rawPath = pathParts.join('\t');
  if (!rawPath) return null;

  // Binary files report `-` for both counts. They are recorded so the file still
  // shows as touched, but they contribute no line churn.
  const binary = addedRaw === '-' || deletedRaw === '-';
  const added = binary ? 0 : Number(addedRaw);
  const deleted = binary ? 0 : Number(deletedRaw);
  if (!binary && (Number.isNaN(added) || Number.isNaN(deleted))) return null;

  return { path: resolveRenamePath(rawPath), added, deleted, binary };
}

/**
 * Normalizes git's rename notation down to the destination path.
 *
 * git writes renames as `old => new` or with a shared prefix and suffix factored
 * out, as in `src/{old => new}/file.ts`. Attributing churn to the destination
 * keeps a renamed file's history joined up instead of splitting it in two.
 */
export function resolveRenamePath(rawPath: string): string {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(rawPath);
  if (braced) {
    const [, prefix = '', , right = '', suffix = ''] = braced;
    return collapseSlashes(`${prefix}${right}${suffix}`);
  }
  const arrow = rawPath.split(' => ');
  if (arrow.length === 2) return arrow[1]!.trim();
  return rawPath;
}

function collapseSlashes(input: string): string {
  return input.replace(/\/{2,}/g, '/').replace(/^\//, '');
}

/**
 * Start of the window as a Date: midnight local time, `windowDays` calendar days
 * ago inclusive of today. Aligning to midnight keeps the window boundary
 * consistent with the per-day buckets the timeline uses.
 */
export function windowStart(windowDays: number, now = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (windowDays - 1));
  return start;
}

/** Reads the commits in the window, newest first. */
export async function readCommits(
  repoPath: string,
  options: ReadCommitsOptions,
): Promise<CommitRecord[]> {
  const since = windowStart(options.windowDays);
  const parser = new CommitLogParser();

  await gitLines(
    repoPath,
    [
      'log',
      // Merge commits repeat their parents' changes, which would double count churn.
      '--no-merges',
      '--numstat',
      '--find-renames',
      `--since=${since.toISOString()}`,
      `--max-count=${options.maxCommits ?? DEFAULT_MAX_COMMITS}`,
      `--format=${RECORD_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%s`,
    ],
    (line) => parser.push(line),
  );

  return parser.finish();
}
