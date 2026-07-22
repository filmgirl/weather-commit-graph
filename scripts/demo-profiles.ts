import type { RepoBuilder, Author } from './repo-builder.ts';
import type { Rng } from './rng.ts';

export interface CommitContext {
  daysAgo: number;
  hour: number;
  minute: number;
  /** 0 at the start of the window, 1 at the present. Lets a profile ramp over time. */
  progress: number;
}

export interface DemoProfile {
  name: string;
  seed: number;
  /** The condition this repo is built to produce. Asserted by the tests. */
  expected: string;
  description: string;
  /** Files created in the first commit. */
  scaffold(builder: RepoBuilder): void;
  /** Applies edits and commits once. Shared by initial seeding and `--append`. */
  writeCommit(builder: RepoBuilder, rng: Rng, ctx: CommitContext): Promise<void>;
  /** Produces the commit schedule for a full seed, newest last. */
  schedule(rng: Rng): CommitContext[];
}

const AUTHORS: Author[] = [
  { name: 'Ada Okonjo', email: 'ada@example.invalid' },
  { name: 'Bo Lindqvist', email: 'bo@example.invalid' },
  { name: 'Chen Wei', email: 'chen@example.invalid' },
  { name: 'Dara Silva', email: 'dara@example.invalid' },
  { name: 'Emre Kaya', email: 'emre@example.invalid' },
  { name: 'Fen Marsh', email: 'fen@example.invalid' },
];

const FEATURE_MESSAGES = [
  'feat: add retry budget to the sync worker',
  'feat: expose window size on the forecast endpoint',
  'refactor: split the parser into pure helpers',
  'perf: memoize the churn aggregation',
  'test: cover the empty-window case',
  'docs: describe the ownership metric',
  'chore: bump the lint config',
  'feat: support relative date windows',
  'refactor: lift shared types into one module',
  'test: add fixtures for merge-heavy history',
];

const FIX_MESSAGES = [
  'fix: correct off-by-one in the day bucket',
  'fix: guard against a missing numstat column',
  'revert: back out the aggressive cache',
  'hotfix: stop double counting renames',
  'fix: handle repos with a single commit',
  'fix: bug where dormant repos returned NaN',
  'fix: restore the pressure trend calculation',
];

/** Spreads a commit across the working hours of a day, deterministically. */
function clockFor(rng: Rng): { hour: number; minute: number } {
  return { hour: rng.int(9, 18), minute: rng.int(0, 59) };
}

/**
 * Healthy repository: steady daily commits, work spread across many files and
 * several authors, very few fixes.
 */
const sunny: DemoProfile = {
  name: 'demo-sunny',
  seed: 1001,
  expected: 'sunny',
  description: 'Steady velocity, low churn, work shared across four authors.',
  scaffold(builder) {
    builder.seedFile('README.md', 24);
    builder.seedFile('src/index.ts', 80);
    builder.seedFile('src/forecast/model.ts', 140);
    builder.seedFile('src/forecast/format.ts', 90);
    builder.seedFile('src/git/log.ts', 120);
    builder.seedFile('src/git/parse.ts', 110);
    builder.seedFile('src/metrics/velocity.ts', 70);
    builder.seedFile('src/metrics/churn.ts', 85);
    builder.seedFile('src/metrics/ownership.ts', 60);
    builder.seedFile('src/api/routes.ts', 95);
    builder.seedFile('src/api/errors.ts', 45);
    builder.seedFile('test/model.test.ts', 130);
    builder.seedFile('test/parse.test.ts', 105);
    builder.seedFile('docs/metrics.md', 40);
  },
  async writeCommit(builder, rng, ctx) {
    const candidates = builder.fileNames();
    const touched = rng.int(1, 3);
    for (let i = 0; i < touched; i += 1) {
      builder.edit(rng.pick(candidates), {
        modify: rng.int(2, 8),
        add: rng.int(1, 6),
        remove: rng.int(0, 3),
      });
    }
    const isFix = rng.chance(0.06);
    await builder.commit({
      daysAgo: ctx.daysAgo,
      hour: ctx.hour,
      minute: ctx.minute,
      author: AUTHORS[rng.int(0, 3)]!,
      message: isFix ? rng.pick(FIX_MESSAGES) : rng.pick(FEATURE_MESSAGES),
    });
  },
  schedule(rng) {
    const out: CommitContext[] = [];
    for (let daysAgo = 29; daysAgo >= 0; daysAgo -= 1) {
      // Most days see work; weekends stay quiet, which is what healthy looks like.
      if (rng.chance(0.13)) continue;
      const perDay = rng.int(2, 4);
      for (let i = 0; i < perDay; i += 1) {
        out.push({ daysAgo, progress: (29 - daysAgo) / 29, ...clockFor(rng) });
      }
    }
    return out;
  },
};

/**
 * Repository in trouble: one file rewritten over and over, a high share of fix
 * and revert commits, a single author carrying all of it, and erratic commit sizes.
 */
const stormy: DemoProfile = {
  name: 'demo-stormy',
  seed: 2002,
  expected: 'storm',
  description: 'One hotspot file rewritten constantly, heavy fixes, single author.',
  scaffold(builder) {
    builder.seedFile('README.md', 18);
    builder.seedFile('src/payments/reconciler.ts', 900);
    builder.seedFile('src/payments/ledger.ts', 320);
    builder.seedFile('src/payments/webhooks.ts', 240);
    builder.seedFile('src/index.ts', 70);
    builder.seedFile('test/reconciler.test.ts', 180);
  },
  async writeCommit(builder, rng, ctx) {
    const hotspot = 'src/payments/reconciler.ts';
    if (rng.chance(0.75)) {
      // The blast radius that makes this file a storm cell.
      builder.edit(hotspot, {
        modify: rng.int(60, 160),
        add: rng.int(30, 90),
        remove: rng.int(30, 90),
      });
      if (rng.chance(0.12)) {
        // Occasional lurching rewrite, which is what drives size variance up.
        builder.edit(hotspot, { add: rng.int(250, 450), remove: rng.int(120, 260) });
      }
    } else {
      const others = builder.fileNames().filter((file) => file !== hotspot);
      builder.edit(rng.pick(others), {
        modify: rng.int(10, 40),
        add: rng.int(5, 30),
        remove: rng.int(5, 25),
      });
    }
    const isFix = rng.chance(0.55);
    await builder.commit({
      daysAgo: ctx.daysAgo,
      hour: ctx.hour,
      minute: ctx.minute,
      author: AUTHORS[0]!,
      message: isFix ? rng.pick(FIX_MESSAGES) : rng.pick(FEATURE_MESSAGES),
    });
  },
  schedule(rng) {
    const out: CommitContext[] = [];
    for (let daysAgo = 29; daysAgo >= 0; daysAgo -= 1) {
      const perDay = rng.int(3, 6);
      for (let i = 0; i < perDay; i += 1) {
        out.push({ daysAgo, progress: (29 - daysAgo) / 29, ...clockFor(rng) });
      }
    }
    return out;
  },
};

/**
 * Deteriorating repository: churn and fix ratio both climb across the window,
 * so the pressure trend should read as falling.
 */
const rainy: DemoProfile = {
  name: 'demo-rainy',
  seed: 3003,
  expected: 'rain',
  description: 'Churn and fixes rising across the window; pressure falling.',
  scaffold(builder) {
    builder.seedFile('README.md', 20);
    builder.seedFile('src/search/query.ts', 420);
    builder.seedFile('src/search/index.ts', 260);
    builder.seedFile('src/search/rank.ts', 300);
    builder.seedFile('src/server.ts', 150);
    builder.seedFile('src/config.ts', 80);
    builder.seedFile('test/query.test.ts', 200);
  },
  async writeCommit(builder, rng, ctx) {
    // Ramp the blast radius as the window progresses: 1x early, 4x by the end.
    const ramp = 1 + ctx.progress * 3;
    const scale = (base: number) => Math.round(base * ramp);
    const touched = rng.int(1, 2);
    for (let i = 0; i < touched; i += 1) {
      builder.edit(rng.pick(builder.fileNames()), {
        modify: scale(rng.int(8, 24)),
        add: scale(rng.int(6, 20)),
        remove: scale(rng.int(4, 16)),
      });
    }
    // Fix ratio climbs alongside the churn.
    const isFix = rng.chance(0.12 + ctx.progress * 0.35);
    await builder.commit({
      daysAgo: ctx.daysAgo,
      hour: ctx.hour,
      minute: ctx.minute,
      author: rng.chance(0.6) ? AUTHORS[1]! : AUTHORS[rng.int(2, 3)]!,
      message: isFix ? rng.pick(FIX_MESSAGES) : rng.pick(FEATURE_MESSAGES),
    });
  },
  schedule(rng) {
    const out: CommitContext[] = [];
    for (let daysAgo = 29; daysAgo >= 0; daysAgo -= 1) {
      if (rng.chance(0.2)) continue;
      const perDay = rng.int(2, 4);
      for (let i = 0; i < perDay; i += 1) {
        out.push({ daysAgo, progress: (29 - daysAgo) / 29, ...clockFor(rng) });
      }
    }
    return out;
  },
};

/**
 * Abandoned repository: a normal-looking burst of work that stopped months ago.
 * Nothing lands inside the default window at all.
 */
const dormant: DemoProfile = {
  name: 'demo-dormant',
  seed: 4004,
  expected: 'snow',
  description: 'Healthy history that stopped roughly six months ago.',
  scaffold(builder) {
    builder.seedFile('README.md', 30);
    builder.seedFile('src/main.ts', 180);
    builder.seedFile('src/render.ts', 220);
    builder.seedFile('src/util.ts', 90);
    builder.seedFile('test/render.test.ts', 140);
  },
  async writeCommit(builder, rng, ctx) {
    builder.edit(rng.pick(builder.fileNames()), {
      modify: rng.int(4, 14),
      add: rng.int(2, 10),
      remove: rng.int(0, 6),
    });
    await builder.commit({
      daysAgo: ctx.daysAgo,
      hour: ctx.hour,
      minute: ctx.minute,
      author: AUTHORS[rng.int(2, 4)]!,
      message: rng.chance(0.15) ? rng.pick(FIX_MESSAGES) : rng.pick(FEATURE_MESSAGES),
    });
  },
  schedule(rng) {
    const out: CommitContext[] = [];
    for (let daysAgo = 210; daysAgo >= 160; daysAgo -= 1) {
      if (rng.chance(0.45)) continue;
      const perDay = rng.int(1, 3);
      for (let i = 0; i < perDay; i += 1) {
        out.push({ daysAgo, progress: (210 - daysAgo) / 50, ...clockFor(rng) });
      }
    }
    return out;
  },
};

/**
 * Directionless repository: a handful of tiny commits from many different people,
 * with no sustained thread of work to read.
 */
const foggy: DemoProfile = {
  name: 'demo-foggy',
  seed: 5005,
  expected: 'fog',
  description: 'Sparse, tiny commits scattered across many one-off authors.',
  scaffold(builder) {
    builder.seedFile('README.md', 26);
    builder.seedFile('src/app.ts', 140);
    builder.seedFile('src/helpers.ts', 95);
    builder.seedFile('scripts/build.ts', 60);
    builder.seedFile('docs/notes.md', 34);
  },
  async writeCommit(builder, rng, ctx) {
    builder.edit(rng.pick(builder.fileNames()), {
      modify: rng.int(1, 2),
      add: rng.int(0, 2),
      remove: rng.int(0, 1),
    });
    await builder.commit({
      daysAgo: ctx.daysAgo,
      hour: ctx.hour,
      minute: ctx.minute,
      author: AUTHORS[rng.int(0, AUTHORS.length - 1)]!,
      message: rng.pick(['chore: tidy imports', 'docs: fix a typo', 'chore: nudge config']),
    });
  },
  schedule(rng) {
    const out: CommitContext[] = [];
    const days = [27, 24, 20, 17, 12, 9, 6, 3, 1];
    for (const daysAgo of days) {
      out.push({ daysAgo, progress: (29 - daysAgo) / 29, ...clockFor(rng) });
    }
    return out;
  },
};

export const DEMO_PROFILES: DemoProfile[] = [sunny, stormy, rainy, dormant, foggy];

export function findProfile(name: string): DemoProfile | undefined {
  return DEMO_PROFILES.find((profile) => profile.name === name);
}
