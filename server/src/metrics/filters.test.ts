import { describe, it, expect } from 'vitest';
import { isVendoredPath } from './filters.ts';
import { isFixCommit } from './fix-detection.ts';

describe('isVendoredPath', () => {
  it('ignores dependency directories', () => {
    expect(isVendoredPath('node_modules/react/index.js')).toBe(true);
    expect(isVendoredPath('server/vendor/lib.go')).toBe(true);
    expect(isVendoredPath('web/dist/assets/app.js')).toBe(true);
  });

  it('ignores lockfiles', () => {
    expect(isVendoredPath('package-lock.json')).toBe(true);
    expect(isVendoredPath('apps/api/pnpm-lock.yaml')).toBe(true);
    expect(isVendoredPath('go.sum')).toBe(true);
  });

  it('ignores generated and minified artifacts', () => {
    expect(isVendoredPath('public/vendor.min.js')).toBe(true);
    expect(isVendoredPath('src/app.js.map')).toBe(true);
    expect(isVendoredPath('test/__snapshots__/x.snap')).toBe(true);
  });

  it('keeps ordinary source files', () => {
    expect(isVendoredPath('src/index.ts')).toBe(false);
    expect(isVendoredPath('server/src/metrics/engine.ts')).toBe(false);
    expect(isVendoredPath('README.md')).toBe(false);
  });

  it('does not confuse a substring with a path segment', () => {
    // "distribution" contains "dist" but is not the dist directory.
    expect(isVendoredPath('src/distribution/logic.ts')).toBe(false);
  });
});

describe('isFixCommit', () => {
  it('flags conventional fix and revert prefixes', () => {
    expect(isFixCommit('fix: correct the off-by-one')).toBe(true);
    expect(isFixCommit('fix(parser): handle empty input')).toBe(true);
    expect(isFixCommit('revert: back out the cache change')).toBe(true);
    expect(isFixCommit('hotfix: stop the crash')).toBe(true);
  });

  it('flags bug language mid-sentence', () => {
    expect(isFixCommit('resolve a nasty crash on startup')).toBe(true);
    expect(isFixCommit('this fixes the regression from last week')).toBe(true);
  });

  it('does not flag ordinary feature work', () => {
    expect(isFixCommit('feat: add the forecast endpoint')).toBe(false);
    expect(isFixCommit('refactor: split the parser')).toBe(false);
    expect(isFixCommit('docs: describe the metrics')).toBe(false);
  });

  it('does not flag words that merely contain "fix"', () => {
    expect(isFixCommit('add a configurable prefix option')).toBe(false);
    expect(isFixCommit('affix the label to the toolbar')).toBe(false);
  });
});
