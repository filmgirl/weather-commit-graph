import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RepoBuilder } from './repo-builder.ts';
import { createRng } from './rng.ts';
import { DEMO_PROFILES, findProfile, type DemoProfile } from './demo-profiles.ts';

export const DEMO_ROOT = fileURLToPath(new URL('../.demo-repos/', import.meta.url));

export function demoRepoPath(name: string): string {
  return path.join(DEMO_ROOT, name);
}

/** Generates one demo repository from scratch. */
export async function seedProfile(profile: DemoProfile): Promise<{ commits: number }> {
  const rng = createRng(profile.seed);
  const builder = new RepoBuilder(demoRepoPath(profile.name), rng);

  await builder.init();
  profile.scaffold(builder);

  const schedule = profile.schedule(rng);
  const first = schedule[0];
  if (!first) throw new Error(`profile ${profile.name} produced an empty schedule`);

  // The scaffold lands as a real initial commit so the repo has a sane root.
  await builder.commit({
    daysAgo: first.daysAgo + 1,
    hour: 9,
    minute: 0,
    author: { name: 'Ada Okonjo', email: 'ada@example.invalid' },
    message: 'chore: initial import',
  });

  for (const ctx of schedule) {
    await profile.writeCommit(builder, rng, ctx);
  }

  return { commits: builder.commits };
}

/** Adds fresh commits dated now to an already-seeded repository. */
export async function appendToProfile(
  profile: DemoProfile,
  count: number,
): Promise<{ commits: number }> {
  const dir = demoRepoPath(profile.name);
  // A distinct seed per append keeps successive appends from being identical.
  const rng = createRng(profile.seed + Date.now() % 100_000);
  const builder = new RepoBuilder(dir, rng);
  await builder.loadFromDisk();

  if (builder.fileNames().length === 0) {
    throw new Error(`${profile.name} is not seeded yet — run "npm run seed:demo" first`);
  }

  for (let i = 0; i < count; i += 1) {
    await profile.writeCommit(builder, rng, {
      daysAgo: 0,
      hour: new Date().getUTCHours(),
      minute: Math.min(59, new Date().getUTCMinutes() + i),
      progress: 1,
    });
  }

  return { commits: builder.commits };
}

interface Args {
  append?: string;
  only?: string;
  count: number;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { count: 3, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--append') args.append = argv[++i];
    else if (arg === '--only') args.only = argv[++i];
    else if (arg === '--count') args.count = Number(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  const names = DEMO_PROFILES.map((p) => `    ${p.name.padEnd(14)} ${p.description}`).join('\n');
  return [
    'Usage: npm run seed:demo [-- options]',
    '',
    'Options:',
    '  --only <name>      Regenerate a single demo repo',
    '  --append <name>    Add fresh commits dated now (for testing live updates)',
    '  --count <n>        How many commits to append (default 3)',
    '',
    'Repositories:',
    names,
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    return;
  }

  if (args.append) {
    const profile = findProfile(args.append);
    if (!profile) throw new Error(`unknown repo "${args.append}"\n\n${usage()}`);
    const { commits } = await appendToProfile(profile, args.count);
    console.log(`appended ${commits} commit(s) to ${profile.name}`);
    console.log(`  ${demoRepoPath(profile.name)}`);
    return;
  }

  const targets = args.only
    ? [findProfile(args.only)].filter((p): p is DemoProfile => {
        if (!p) throw new Error(`unknown repo "${args.only}"\n\n${usage()}`);
        return true;
      })
    : DEMO_PROFILES;

  console.log(`seeding ${targets.length} demo repo(s) into ${DEMO_ROOT}`);
  for (const profile of targets) {
    const started = Date.now();
    const { commits } = await seedProfile(profile);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `  ${profile.name.padEnd(14)} ${String(commits).padStart(4)} commits  ` +
        `→ expects ${profile.expected}  (${seconds}s)`,
    );
  }
  console.log('\nAdd one in the dashboard, or:');
  console.log(`  curl -X POST localhost:3001/api/repos -H 'content-type: application/json' \\`);
  console.log(`    -d '{"path":"${demoRepoPath('demo-stormy')}"}'`);
}

// Only run as a CLI, so the seeding helpers stay importable from tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
