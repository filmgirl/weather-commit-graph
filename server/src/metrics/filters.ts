/**
 * Paths that should never count as hotspots or churn.
 *
 * Vendored code, lockfiles, and build output can dominate a repo's raw line
 * counts while telling you nothing about the health of the code people actually
 * write. Filtering them keeps the forecast honest.
 */
const IGNORED_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'vendor',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'target',
  '__pycache__',
  '.venv',
  'venv',
]);

const IGNORED_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'composer.lock',
  'cargo.lock',
  'poetry.lock',
  'gemfile.lock',
  'go.sum',
]);

const IGNORED_EXTENSIONS = new Set([
  '.min.js',
  '.min.css',
  '.map',
  '.snap',
  '.lock',
]);

export function isVendoredPath(filePath: string): boolean {
  const segments = filePath.split('/');
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) return true;

  const base = segments[segments.length - 1]?.toLowerCase() ?? '';
  if (IGNORED_FILES.has(base)) return true;

  for (const ext of IGNORED_EXTENSIONS) {
    if (base.endsWith(ext)) return true;
  }
  return false;
}
