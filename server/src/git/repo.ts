import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { git, GitError } from './exec.ts';
import type { RepoIdentity } from './types.ts';

/**
 * Resolves and validates a user-supplied repository path.
 *
 * Every path arriving from the API goes through here first: it is resolved
 * through symlinks to a canonical absolute path, confirmed to be a directory,
 * and confirmed by git itself to be a work tree. Callers only ever hand the
 * canonical result to later git invocations.
 */
export async function resolveRepo(inputPath: string): Promise<RepoIdentity> {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new GitError('a repository path is required', 'not_a_repo');
  }

  const expanded = expandHome(inputPath.trim());
  if (!path.isAbsolute(expanded)) {
    throw new GitError('repository path must be absolute', 'not_a_repo');
  }

  let canonical: string;
  try {
    canonical = await realpath(expanded);
  } catch {
    throw new GitError(`no such directory: ${expanded}`, 'not_a_repo');
  }

  const stats = await stat(canonical);
  if (!stats.isDirectory()) {
    throw new GitError(`not a directory: ${canonical}`, 'not_a_repo');
  }

  // Ask git rather than looking for a `.git` entry ourselves, so worktrees and
  // submodules are handled the way git handles them.
  let topLevel: string;
  try {
    topLevel = (await git(canonical, ['rev-parse', '--show-toplevel'])).trim();
  } catch (error) {
    // A readable directory that git rejects is simply not a repository. Say that
    // plainly instead of forwarding git's own stderr to the user. A missing git
    // binary is a different problem and must keep its own message.
    if (error instanceof GitError && error.code !== 'git_missing') {
      throw new GitError(`not a git repository: ${canonical}`, 'not_a_repo');
    }
    throw error;
  }
  if (!topLevel) {
    throw new GitError(`not a git repository: ${canonical}`, 'not_a_repo');
  }
  const root = await realpath(topLevel);

  return {
    path: root,
    name: path.basename(root),
    headSha: await readHeadSha(root),
    branch: await readBranch(root),
  };
}

export async function readHeadSha(repoPath: string): Promise<string> {
  try {
    return (await git(repoPath, ['rev-parse', 'HEAD'])).trim();
  } catch (error) {
    // A repository with no commits yet is valid, just empty.
    if (error instanceof GitError && error.code === 'not_a_repo') return '';
    throw error;
  }
}

async function readBranch(repoPath: string): Promise<string | null> {
  try {
    const branch = (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    return branch === 'HEAD' || branch === '' ? null : branch;
  } catch {
    return null;
  }
}

/** Resolves a leading `~` so paths pasted from a shell work as typed. */
function expandHome(input: string): string {
  if (input === '~') return process.env.HOME ?? input;
  if (input.startsWith('~/')) return path.join(process.env.HOME ?? '~', input.slice(2));
  return input;
}

/** Absolute path to the `.git` directory or file, used to watch for new commits. */
export async function resolveGitDir(repoPath: string): Promise<string> {
  const gitDir = (await git(repoPath, ['rev-parse', '--absolute-git-dir'])).trim();
  return gitDir;
}
