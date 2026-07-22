import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { resolveGitDir } from '../git/repo.ts';

export type HeadChangeListener = () => void;

/** Coalesce window: a single git command can touch these files several times. */
const DEBOUNCE_MS = 250;

/**
 * Watches a repository's git directory for anything that moves HEAD.
 *
 * Watches the git directory rather than the work tree, because the interesting
 * event is "a commit landed", not "a file was saved". That also keeps us out of
 * node_modules and build output, which would otherwise drown the watcher in
 * irrelevant events.
 */
export class RepoWatcher {
  private readonly repoPath: string;
  private readonly listeners = new Set<HeadChangeListener>();
  private watchers: FSWatcher[] = [];
  private debounce: NodeJS.Timeout | null = null;
  private starting: Promise<void> | null = null;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  async addListener(listener: HeadChangeListener): Promise<void> {
    this.listeners.add(listener);
    await this.ensureStarted();
  }

  removeListener(listener: HeadChangeListener): void {
    this.listeners.delete(listener);
    if (this.listeners.size === 0) this.stop();
  }

  private async ensureStarted(): Promise<void> {
    if (this.watchers.length > 0) return;
    // Concurrent subscribers must not each spin up their own watcher.
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    await this.starting;
  }

  private async start(): Promise<void> {
    if (this.watchers.length > 0) return;
    const gitDir = await resolveGitDir(this.repoPath);

    // The git dir itself covers commits and checkouts via HEAD; refs/ covers
    // branch updates that do not rewrite HEAD.
    for (const target of [gitDir, path.join(gitDir, 'refs')]) {
      try {
        const watcher = watch(target, { persistent: false, recursive: false }, (_event, file) => {
          if (target === gitDir && !isHeadFile(file)) return;
          this.schedule();
        });
        watcher.on('error', () => this.stop());
        this.watchers.push(watcher);
      } catch {
        // A missing refs/ directory or an unwatchable path should not be fatal:
        // the client also polls, so the watcher is an optimization.
      }
    }
  }

  private schedule(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      // Copy first: a listener may unsubscribe while being notified.
      for (const listener of [...this.listeners]) listener();
    }, DEBOUNCE_MS);
  }

  stop(): void {
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }
}

function isHeadFile(file: string | null): boolean {
  if (!file) return false;
  // `HEAD` plus the transient lock files git writes while committing.
  return file === 'HEAD' || file === 'HEAD.lock' || file.startsWith('ORIG_HEAD');
}

/**
 * Keeps one watcher per repository, shared by every subscriber, and disposes it
 * once the last subscriber goes away so an idle server holds no file handles.
 */
export class WatcherRegistry {
  private readonly watchers = new Map<string, RepoWatcher>();

  async subscribe(
    repoId: string,
    repoPath: string,
    listener: HeadChangeListener,
  ): Promise<() => void> {
    let watcher = this.watchers.get(repoId);
    if (!watcher) {
      watcher = new RepoWatcher(repoPath);
      this.watchers.set(repoId, watcher);
    }
    const target = watcher;
    await target.addListener(listener);

    return () => {
      target.removeListener(listener);
      if (target.listenerCount === 0) this.watchers.delete(repoId);
    };
  }

  stopAll(): void {
    for (const watcher of this.watchers.values()) watcher.stop();
    this.watchers.clear();
  }
}
