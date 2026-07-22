/**
 * Heuristic for whether a commit is corrective work rather than new work.
 *
 * A high fix ratio is one of the strongest storm signals, so this leans toward
 * conventional-commit style prefixes and common bug language while trying not to
 * catch words like "prefix" or "affix" that merely contain "fix".
 */
const FIX_PATTERNS: RegExp[] = [
  /^\s*(fix|bugfix|hotfix|revert|rollback)\b/i,
  /^\s*fix(\([^)]*\))?!?:/i,
  /^\s*revert(\([^)]*\))?!?:/i,
  /\b(fixes|fixed|fixing|hotfix|regression|revert(s|ed)?)\b/i,
  /\b(bug|broken|crash|hotpatch|patch up)\b/i,
];

export function isFixCommit(subject: string): boolean {
  return FIX_PATTERNS.some((pattern) => pattern.test(subject));
}
