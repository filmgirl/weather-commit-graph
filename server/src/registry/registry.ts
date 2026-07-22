import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { RepoSummary } from '@wcg/shared';
import { resolveRepo } from '../git/repo.ts';
import { GitError } from '../git/exec.ts';

/**
 * The set of repositories the dashboard is allowed to analyze.
 *
 * This is deliberately an allow-list rather than an "analyze any path" endpoint:
 * every entry was resolved and validated by git at the moment it was added, and
 * requests can only ever reference an entry by its opaque id. That keeps arbitrary
 * filesystem paths out of the request path entirely.
 */
export class RepoRegistry {
  private readonly filePath: string;
  private repos: RepoSummary[] = [];
  private loaded = false;
  /** Serializes writes so two concurrent adds cannot clobber each other. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath = defaultRegistryPath()) {
    this.filePath = filePath;
  }

  async list(): Promise<RepoSummary[]> {
    await this.load();
    return [...this.repos].sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<RepoSummary | undefined> {
    await this.load();
    return this.repos.find((repo) => repo.id === id);
  }

  /**
   * Validates a user-supplied path and records it. Adding the same repository
   * twice is a no-op that returns the existing entry, since the id is derived
   * from the canonical path.
   */
  async add(inputPath: string): Promise<RepoSummary> {
    const identity = await resolveRepo(inputPath);
    await this.load();

    const id = repoId(identity.path);
    const existing = this.repos.find((repo) => repo.id === id);
    if (existing) return existing;

    const summary: RepoSummary = {
      id,
      name: identity.name,
      path: identity.path,
      addedAt: new Date().toISOString(),
    };

    this.repos = [...this.repos, summary];
    await this.persist();
    return summary;
  }

  async remove(id: string): Promise<boolean> {
    await this.load();
    const next = this.repos.filter((repo) => repo.id !== id);
    if (next.length === this.repos.length) return false;
    this.repos = next;
    await this.persist();
    return true;
  }

  /**
   * Re-validates a stored entry at request time. A repo can be moved or deleted
   * after being added, so a stale registry entry must not become a git call
   * against a path that no longer means what it did.
   */
  async resolve(id: string): Promise<{ repo: RepoSummary; path: string }> {
    const repo = await this.get(id);
    if (!repo) throw new RegistryError(`no repository registered with id ${id}`, 'repo_not_found');

    try {
      const identity = await resolveRepo(repo.path);
      return { repo: { ...repo, name: identity.name }, path: identity.path };
    } catch (error) {
      const detail =
        error instanceof GitError ? error.message : 'path is no longer a git repository';
      throw new RegistryError(`${repo.path} is no longer readable: ${detail}`, 'repo_unavailable');
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.repos = await readRegistryFile(this.filePath);
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const snapshot = [...this.repos];
    this.writeQueue = this.writeQueue.then(() => writeRegistryFile(this.filePath, snapshot));
    await this.writeQueue;
  }
}

export class RegistryError extends Error {
  readonly code: 'repo_not_found' | 'repo_unavailable';

  constructor(message: string, code: 'repo_not_found' | 'repo_unavailable') {
    super(message);
    this.name = 'RegistryError';
    this.code = code;
  }
}

/** Stable, opaque id derived from the canonical path, so it survives restarts. */
export function repoId(canonicalPath: string): string {
  return createHash('sha256').update(canonicalPath).digest('hex').slice(0, 12);
}

export function defaultRegistryPath(): string {
  const base = process.env.WCG_CONFIG_DIR ?? path.join(os.homedir(), '.wcg');
  return path.join(base, 'repos.json');
}

async function readRegistryFile(filePath: string): Promise<RepoSummary[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    // No registry yet is the normal first-run state.
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const repos = Array.isArray(parsed) ? parsed : ((parsed as { repos?: unknown })?.repos ?? []);
    if (!Array.isArray(repos)) return [];
    return repos.filter(isRepoSummary);
  } catch {
    // A corrupt registry should not brick the dashboard; start clean instead.
    return [];
  }
}

async function writeRegistryFile(filePath: string, repos: RepoSummary[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  // Write-then-rename so a crash mid-write cannot leave a truncated registry.
  const tmp = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ version: 1, repos }, null, 2)}\n`, 'utf8');
  await rename(tmp, filePath);
}

function isRepoSummary(value: unknown): value is RepoSummary {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.path === 'string' &&
    typeof candidate.addedAt === 'string'
  );
}
