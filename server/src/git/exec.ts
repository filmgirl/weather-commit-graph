import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

const execFileAsync = promisify(execFile);

export class GitError extends Error {
  readonly code: 'not_a_repo' | 'git_failed' | 'git_missing';

  constructor(message: string, code: 'not_a_repo' | 'git_failed' | 'git_missing') {
    super(message);
    this.name = 'GitError';
    this.code = code;
  }
}

/**
 * Environment for every git invocation.
 *
 * Locale is pinned so parsing never depends on the user's language, and
 * interactive prompts are disabled so a repo with credential issues fails fast
 * instead of hanging the request.
 */
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LC_ALL: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: 'cat',
  };
}

/**
 * Runs git and buffers the result. Always called with an argument array, never a
 * shell string, so a repository path can never be interpreted as shell syntax.
 */
export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: gitEnv(),
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    throw toGitError(error, args);
  }
}

/**
 * Streams git output line by line.
 *
 * `git log --numstat` over a large monorepo can be tens of megabytes, so it is
 * consumed incrementally rather than buffered into a single string.
 */
export async function gitLines(
  cwd: string,
  args: string[],
  onLine: (line: string) => void,
): Promise<void> {
  const child = spawn('git', args, { cwd, env: gitEnv(), windowsHide: true });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    // Keep only the tail; a broken invocation can be very chatty.
    stderr = (stderr + chunk).slice(-4096);
  });

  const spawnFailure = new Promise<never>((_resolve, reject) => {
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT'
          ? new GitError('git is not installed or not on PATH', 'git_missing')
          : new GitError(`failed to run git: ${error.message}`, 'git_failed'),
      );
    });
  });

  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  reader.on('line', onLine);

  // Wait for stdout to drain *and* the process to exit, so every line is
  // delivered before a non-zero exit is reported.
  const drained = once(reader, 'close');
  const exited = once(child, 'close') as Promise<[number | null]>;
  const [, [exitCode]] = await Promise.race([
    Promise.all([drained, exited]),
    spawnFailure,
  ]);

  if (exitCode !== 0) {
    throw new GitError(gitFailureMessage(stderr, args), classify(stderr));
  }
}

function toGitError(error: unknown, args: string[]): GitError {
  const err = error as NodeJS.ErrnoException & { stderr?: string };
  if (err.code === 'ENOENT') {
    return new GitError('git is not installed or not on PATH', 'git_missing');
  }
  const stderr = err.stderr ?? err.message ?? '';
  return new GitError(gitFailureMessage(stderr, args), classify(stderr));
}

function classify(stderr: string): 'not_a_repo' | 'git_failed' {
  return /not a git repository|does not have any commits|unknown revision/i.test(stderr)
    ? 'not_a_repo'
    : 'git_failed';
}

function gitFailureMessage(stderr: string, args: string[]): string {
  const detail = stderr.trim().split('\n')[0] ?? 'unknown error';
  return `git ${args[0] ?? ''} failed: ${detail}`;
}
