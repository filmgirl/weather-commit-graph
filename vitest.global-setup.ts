import { access } from 'node:fs/promises';
import path from 'node:path';
import { DEMO_PROFILES } from './scripts/demo-profiles.ts';
import { demoRepoPath, seedProfile } from './scripts/seed-demo.ts';

/**
 * Ensures the generated demo repositories exist before the suite runs.
 *
 * Much of the test suite asserts against real git history, and those fixtures
 * live in a gitignored `.demo-repos/`. Without this, `npm test` from a fresh
 * clone would fail with a wall of "no such directory" errors until someone
 * happened to read the README and run `npm run seed:demo` first.
 *
 * Only missing repos are generated, so the common case costs a few stat calls.
 */
export default async function setup(): Promise<void> {
  const missing = [];
  for (const profile of DEMO_PROFILES) {
    if (!(await isSeeded(profile.name))) missing.push(profile);
  }

  if (missing.length === 0) return;

  console.log(`[wcg] seeding ${missing.length} demo repo(s) for the test suite…`);
  for (const profile of missing) {
    const { commits } = await seedProfile(profile);
    console.log(`[wcg]   ${profile.name}: ${commits} commits`);
  }
}

async function isSeeded(name: string): Promise<boolean> {
  try {
    // A `.git` directory is the real marker; a bare directory is not enough.
    await access(path.join(demoRepoPath(name), '.git'));
    return true;
  } catch {
    return false;
  }
}
