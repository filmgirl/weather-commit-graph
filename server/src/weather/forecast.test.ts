import { describe, expect, it } from 'vitest';
import { readCommits } from '../git/log.ts';
import { resolveRepo } from '../git/repo.ts';
import { readFileSizes } from '../git/tree.ts';
import { analyzeCommits, type RepoAnalysis } from '../metrics/engine.ts';
import { buildForecast } from './forecast.ts';
import { DEMO_PROFILES } from '../../../scripts/demo-profiles.ts';
import { demoRepoPath } from '../../../scripts/seed-demo.ts';

const WINDOW_DAYS = 30;

async function analyzeDemo(name: string): Promise<RepoAnalysis> {
  const repo = await resolveRepo(demoRepoPath(name));
  const [commits, sizes] = await Promise.all([
    readCommits(repo.path, { windowDays: WINDOW_DAYS }),
    readFileSizes(repo.path),
  ]);
  return analyzeCommits(commits, sizes, { windowDays: WINDOW_DAYS });
}

describe('buildForecast against the demo repos', () => {
  // Each demo repo is generated to produce one specific condition. These are the
  // anchors the whole weather model is calibrated against; if one drifts, the
  // model changed meaning, not just its numbers.
  for (const profile of DEMO_PROFILES) {
    it(`forecasts ${profile.name} as ${profile.expected}`, async () => {
      const analysis = await analyzeDemo(profile.name);
      const { forecast } = buildForecast(analysis, { windowDays: WINDOW_DAYS });
      expect(forecast.condition).toBe(profile.expected);
    });
  }

  it('reports the stormy repo with a dropping barometer and trapped knowledge', async () => {
    const analysis = await analyzeDemo('demo-stormy');
    const { forecast, hotspots, scores } = buildForecast(analysis, { windowDays: WINDOW_DAYS });

    expect(scores.trouble).toBeGreaterThan(0.62);
    expect(forecast.gauges.pressureHpa).toBeLessThan(1000);
    // Single author by construction, so humidity should be pinned high.
    expect(forecast.gauges.humidityPct).toBeGreaterThan(90);

    // The generated hotspot file should dominate the map.
    expect(hotspots[0]?.path).toBe('src/payments/reconciler.ts');
    expect(hotspots[0]?.condition).toBe('storm');

    const titles = forecast.advisories.map((advisory) => advisory.title);
    expect(titles).toContain('Heavy corrective churn');
    expect(titles).toContain('Churn concentrated in one file');
    expect(titles).toContain('Low bus factor');
    expect(forecast.advisories[0]?.level).toBe('warning');
  });

  it('reports the sunny repo as calm with nothing to flag', async () => {
    const analysis = await analyzeDemo('demo-sunny');
    const { forecast, scores } = buildForecast(analysis, { windowDays: WINDOW_DAYS });

    expect(scores.trouble).toBeLessThan(0.18);
    expect(forecast.gauges.pressureHpa).toBeGreaterThan(1000);
    expect(forecast.gauges.humidityPct).toBeLessThan(40);
    expect(forecast.advisories.every((advisory) => advisory.level === 'info')).toBe(true);
  });

  it('explains the dormant repo instead of calling it healthy', async () => {
    const analysis = await analyzeDemo('demo-dormant');
    const { forecast } = buildForecast(analysis, { windowDays: WINDOW_DAYS });

    expect(forecast.condition).toBe('snow');
    expect(forecast.summary).toMatch(/no commits|gone quiet/i);
    expect(forecast.advisories.length).toBeGreaterThan(0);
  });

  it('produces a well-formed timeline covering the window plus a projection', async () => {
    const analysis = await analyzeDemo('demo-rainy');
    const { timeline } = buildForecast(analysis, { windowDays: WINDOW_DAYS });

    const observed = timeline.filter((day) => day.kind === 'observed');
    const projected = timeline.filter((day) => day.kind === 'projected');

    expect(observed).toHaveLength(WINDOW_DAYS);
    expect(projected).toHaveLength(3);

    // Dates must be unique, ordered, and gapless.
    const dates = timeline.map((day) => day.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect([...dates].sort()).toEqual(dates);

    // Projections carry decaying confidence; observed days carry none.
    expect(observed.every((day) => day.confidence === undefined)).toBe(true);
    const confidences = projected.map((day) => day.confidence ?? 0);
    expect(confidences[0]).toBeGreaterThan(confidences[2]!);
  });

  it('scores every hotspot within range and sorted hottest first', async () => {
    const analysis = await analyzeDemo('demo-stormy');
    const { hotspots } = buildForecast(analysis, { windowDays: WINDOW_DAYS });

    expect(hotspots.length).toBeGreaterThan(0);
    for (const file of hotspots) {
      expect(file.hotspotScore).toBeGreaterThanOrEqual(0);
      expect(file.hotspotScore).toBeLessThanOrEqual(1);
      expect(file.churn).toBe(file.linesAdded + file.linesDeleted);
      expect(file.authors).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(file.lastTouchedAt))).toBe(false);
    }
    for (let i = 1; i < hotspots.length; i += 1) {
      expect(hotspots[i - 1]!.hotspotScore).toBeGreaterThanOrEqual(hotspots[i]!.hotspotScore);
    }
  });
});
