import type { ForecastPayload } from '@wcg/shared';
import { readCommits } from '../git/log.ts';
import { readHeadSha } from '../git/repo.ts';
import { readFileSizes } from '../git/tree.ts';
import { analyzeCommits } from '../metrics/engine.ts';
import { buildForecastPayload } from '../weather/index.ts';
import { RepoRegistry } from '../registry/registry.ts';

export const SUPPORTED_WINDOWS = [7, 30, 90] as const;
export const DEFAULT_WINDOW_DAYS = 30;

/**
 * Parses the `window` query parameter, which accepts either a bare number of days
 * or the `30d` shorthand. Unsupported windows are rejected rather than clamped so
 * a typo does not silently produce a different forecast than the caller asked for.
 */
export function parseWindow(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_WINDOW_DAYS;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new WindowError('window must be a number of days');
  }

  const text = String(raw).trim().toLowerCase();
  const days = Number(text.endsWith('d') ? text.slice(0, -1) : text);
  if (!Number.isInteger(days)) throw new WindowError(`invalid window: ${String(raw)}`);
  if (!SUPPORTED_WINDOWS.includes(days as (typeof SUPPORTED_WINDOWS)[number])) {
    throw new WindowError(`window must be one of ${SUPPORTED_WINDOWS.join(', ')} days`);
  }
  return days;
}

export class WindowError extends Error {
  readonly code = 'invalid_window';

  constructor(message: string) {
    super(message);
    this.name = 'WindowError';
  }
}

interface CacheEntry {
  headSha: string;
  payload: ForecastPayload;
  computedAt: number;
}

/** How long a forecast for an unchanged HEAD stays fresh. */
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 64;

/**
 * Computes forecasts, with a cache keyed on repo + window + HEAD sha.
 *
 * Analyzing a large repo means walking thousands of commits, so repeat requests
 * for an unchanged HEAD should not re-do that work. Keying on the sha means a new
 * commit invalidates the entry automatically, which is exactly what live updates
 * need — no manual busting, no stale forecasts.
 */
export class ForecastService {
  private readonly registry: RepoRegistry;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(registry: RepoRegistry) {
    this.registry = registry;
  }

  async getForecast(repoId: string, windowDays: number): Promise<ForecastPayload> {
    const { repo, path: repoPath } = await this.registry.resolve(repoId);
    const headSha = await readHeadSha(repoPath);
    const key = `${repoId}:${windowDays}`;

    const cached = this.cache.get(key);
    if (cached && cached.headSha === headSha && Date.now() - cached.computedAt < CACHE_TTL_MS) {
      return cached.payload;
    }

    const [commits, fileSizes] = await Promise.all([
      readCommits(repoPath, { windowDays }),
      readFileSizes(repoPath),
    ]);

    const now = new Date();
    const analysis = analyzeCommits(commits, fileSizes, { windowDays, now });
    const payload = buildForecastPayload(repo, headSha, analysis, { windowDays, now });

    this.cache.set(key, { headSha, payload, computedAt: Date.now() });
    this.evictOverflow();
    return payload;
  }

  /** Drops cached forecasts for one repo, or all of them when no id is given. */
  invalidate(repoId?: string): void {
    if (!repoId) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${repoId}:`)) this.cache.delete(key);
    }
  }

  private evictOverflow(): void {
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      // Map preserves insertion order, so the first key is the oldest.
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }
}
