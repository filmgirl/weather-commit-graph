/**
 * Prints a repo's forecast to the terminal without booting the server. Useful for
 * calibrating the weather thresholds and for sanity-checking a real repo quickly.
 *
 *   npm run report -- <path-to-repo> [--window 30]
 *   npm run report -- --demos
 */
import { readCommits } from '../server/src/git/log.ts';
import { resolveRepo } from '../server/src/git/repo.ts';
import { readFileSizes } from '../server/src/git/tree.ts';
import { analyzeCommits } from '../server/src/metrics/engine.ts';
import { buildForecast } from '../server/src/weather/index.ts';
import { DEMO_PROFILES } from './demo-profiles.ts';
import { demoRepoPath } from './seed-demo.ts';

interface Row {
  label: string;
  expected?: string;
  actual: string;
  trouble: number;
  detail: string;
}

async function reportRepo(inputPath: string, windowDays: number, label?: string, expected?: string): Promise<Row> {
  const repo = await resolveRepo(inputPath);
  const [commits, sizes] = await Promise.all([
    readCommits(repo.path, { windowDays }),
    readFileSizes(repo.path),
  ]);
  const analysis = analyzeCommits(commits, sizes, { windowDays });
  const { forecast, scores, hotspots } = buildForecast(analysis, { windowDays });
  const m = analysis.metrics;

  return {
    label: label ?? repo.name,
    expected,
    actual: forecast.condition,
    trouble: scores.trouble,
    detail: [
      `commits=${m.totalCommits}`,
      `activeDays=${m.activeDays}/${m.windowDays}`,
      `authors=${m.authors}`,
      `fixRatio=${m.fixRatio.toFixed(2)}`,
      `own=${m.ownershipConcentration.toFixed(2)}`,
      `var=${m.commitSizeVariance.toFixed(2)}`,
      `vTrend=${m.velocityTrend.toFixed(2)}`,
      `sinceLast=${m.daysSinceLastCommit.toFixed(1)}d`,
      '',
      `fix=${scores.fixPressure.toFixed(2)}`,
      `churn=${scores.churnPressure.toFixed(2)}`,
      `conc=${scores.concentration.toFixed(2)}`,
      `hot=${scores.hotspotConcentration.toFixed(2)}`,
      `drag=${scores.velocityDrag.toFixed(2)}`,
      '',
      `top=${hotspots[0]?.path ?? 'n/a'}`,
    ].join(' '),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const windowIndex = args.indexOf('--window');
  const windowDays = windowIndex === -1 ? 30 : Number(args[windowIndex + 1] ?? 30);

  const rows: Row[] = [];

  if (args.includes('--demos')) {
    for (const profile of DEMO_PROFILES) {
      rows.push(
        await reportRepo(demoRepoPath(profile.name), windowDays, profile.name, profile.expected),
      );
    }
  } else {
    const target = args.find((arg) => !arg.startsWith('--') && arg !== String(windowDays));
    if (!target) {
      console.error('usage: npm run report -- <path-to-repo> [--window 30] | --demos');
      process.exitCode = 1;
      return;
    }
    rows.push(await reportRepo(target, windowDays));
  }

  for (const row of rows) {
    const verdict = row.expected ? (row.expected === row.actual ? 'PASS' : 'FAIL') : '';
    const expected = row.expected ? ` expected=${row.expected}` : '';
    console.log(
      `${verdict.padEnd(5)}${row.label.padEnd(14)} ${row.actual.padEnd(14)} trouble=${row.trouble.toFixed(3)}${expected}`,
    );
    console.log(`      ${row.detail}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
