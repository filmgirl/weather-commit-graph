import { describe, it, expect } from 'vitest';
import { CommitLogParser, resolveRenamePath, windowStart } from './log.ts';

const RS = '\x1e';
const FS = '\x1f';

function header(
  sha: string,
  name = 'Ada Okonjo',
  email = 'ada@example.invalid',
  iso = '2026-07-01T12:00:00+00:00',
  subject = 'feat: something',
): string {
  return `${RS}${sha}${FS}${name}${FS}${email}${FS}${iso}${FS}${subject}`;
}

function parse(lines: string[]) {
  const parser = new CommitLogParser();
  for (const line of lines) parser.push(line);
  return parser.finish();
}

describe('CommitLogParser', () => {
  it('parses a commit with its numstat entries', () => {
    const commits = parse([
      header('abc123'),
      '',
      '10\t4\tsrc/index.ts',
      '3\t0\tREADME.md',
    ]);

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      sha: 'abc123',
      authorName: 'Ada Okonjo',
      authorEmail: 'ada@example.invalid',
      subject: 'feat: something',
    });
    expect(commits[0]!.date.toISOString()).toBe('2026-07-01T12:00:00.000Z');
    expect(commits[0]!.files).toEqual([
      { path: 'src/index.ts', added: 10, deleted: 4, binary: false },
      { path: 'README.md', added: 3, deleted: 0, binary: false },
    ]);
  });

  it('separates consecutive commits', () => {
    const commits = parse([
      header('aaa'),
      '',
      '1\t1\ta.ts',
      header('bbb'),
      '',
      '2\t2\tb.ts',
      '5\t0\tc.ts',
    ]);

    expect(commits.map((c) => c.sha)).toEqual(['aaa', 'bbb']);
    expect(commits[0]!.files).toHaveLength(1);
    expect(commits[1]!.files).toHaveLength(2);
  });

  it('records binary files as touched but with no line churn', () => {
    const commits = parse([header('aaa'), '', '-\t-\tassets/logo.png']);

    expect(commits[0]!.files).toEqual([
      { path: 'assets/logo.png', added: 0, deleted: 0, binary: true },
    ]);
  });

  it('keeps commits that touch no files', () => {
    const commits = parse([header('empty'), '']);

    expect(commits).toHaveLength(1);
    expect(commits[0]!.files).toEqual([]);
  });

  it('preserves subjects containing the field separator', () => {
    const commits = parse([header('aaa', 'Ada', 'a@b.c', '2026-07-01T12:00:00+00:00', `odd${FS}subject`)]);

    expect(commits[0]!.subject).toBe(`odd${FS}subject`);
  });

  it('preserves paths containing tabs', () => {
    const commits = parse([header('aaa'), '', '1\t2\tsrc/we\tird.ts']);

    expect(commits[0]!.files[0]!.path).toBe('src/we\tird.ts');
  });

  it('skips malformed numstat lines', () => {
    const commits = parse([header('aaa'), '', 'garbage', 'x\ty\tsrc/a.ts', '1\t1\tsrc/b.ts']);

    expect(commits[0]!.files.map((f) => f.path)).toEqual(['src/b.ts']);
  });

  it('drops a commit whose header cannot be parsed', () => {
    const commits = parse([`${RS}onlysha`, '', '1\t1\ta.ts', header('good'), '', '2\t2\tb.ts']);

    expect(commits.map((c) => c.sha)).toEqual(['good']);
  });

  it('returns nothing for empty output', () => {
    expect(parse([])).toEqual([]);
  });
});

describe('resolveRenamePath', () => {
  it('attributes a plain rename to the destination', () => {
    expect(resolveRenamePath('src/old.ts => src/new.ts')).toBe('src/new.ts');
  });

  it('rebuilds a braced rename with shared prefix and suffix', () => {
    expect(resolveRenamePath('src/{old => new}/file.ts')).toBe('src/new/file.ts');
  });

  it('handles a braced rename that adds a directory', () => {
    expect(resolveRenamePath('src/{ => nested}/file.ts')).toBe('src/nested/file.ts');
  });

  it('handles a braced rename that removes a directory', () => {
    expect(resolveRenamePath('src/{nested => }/file.ts')).toBe('src/file.ts');
  });

  it('leaves ordinary paths untouched', () => {
    expect(resolveRenamePath('src/index.ts')).toBe('src/index.ts');
  });
});

describe('windowStart', () => {
  it('spans the requested number of calendar days including today', () => {
    const now = new Date('2026-07-20T15:30:00');
    const start = windowStart(30, now);

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(5); // June
    expect(start.getDate()).toBe(21);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it('starts today for a single-day window', () => {
    const now = new Date('2026-07-20T15:30:00');
    const start = windowStart(1, now);

    expect(start.getDate()).toBe(20);
    expect(start.getHours()).toBe(0);
  });
});
