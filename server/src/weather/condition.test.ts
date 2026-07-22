import { describe, expect, it } from 'vitest';
import type { RepoMetrics } from '@wcg/shared';
import { classifyCondition, DORMANT_DAYS, RAMP_THRESHOLDS } from './condition.ts';
import type { RepoScores } from './score.ts';

function metrics(overrides: Partial<RepoMetrics> = {}): RepoMetrics {
  return {
    windowDays: 30,
    totalCommits: 60,
    activeDays: 20,
    authors: 3,
    filesTouched: 25,
    commitsPerDay: 2,
    velocityTrend: 0,
    linesAdded: 900,
    linesDeleted: 400,
    churnPerDay: 43,
    rewriteChurn: 1000,
    fixRatio: 0.05,
    ownershipConcentration: 0.2,
    commitSizeVariance: 0.2,
    daysSinceLastCommit: 1,
    ...overrides,
  };
}

function scores(trouble: number): RepoScores {
  return {
    fixPressure: trouble,
    churnPressure: trouble,
    concentration: trouble,
    hotspotConcentration: trouble,
    variance: trouble,
    velocityDrag: 0,
    trouble,
  };
}

describe('classifyCondition — absence states take precedence', () => {
  it('returns snow for an empty window', () => {
    expect(classifyCondition(metrics({ totalCommits: 0, commitsPerDay: 0 }), scores(0))).toBe('snow');
  });

  it('returns snow for a dormant repo even when the window had activity', () => {
    const condition = classifyCondition(
      metrics({ daysSinceLastCommit: DORMANT_DAYS + 1 }),
      scores(0.9),
    );
    expect(condition).toBe('snow');
  });

  it('returns fog for activity too sparse to read', () => {
    const condition = classifyCondition(
      metrics({ totalCommits: 9, commitsPerDay: 0.3, activeDays: 9 }),
      scores(0.05),
    );
    expect(condition).toBe('fog');
  });

  it('does not hide a genuine storm behind fog', () => {
    const condition = classifyCondition(
      metrics({ totalCommits: 9, commitsPerDay: 0.3, activeDays: 9 }),
      scores(0.8),
    );
    expect(condition).toBe('storm');
  });

  it('does not call a steadily busy repo foggy', () => {
    const condition = classifyCondition(
      metrics({ totalCommits: 72, commitsPerDay: 2.4, activeDays: 24 }),
      scores(0.05),
    );
    expect(condition).toBe('sunny');
  });
});

describe('classifyCondition — trouble ramp', () => {
  it('walks sunny → storm as trouble rises', () => {
    expect(classifyCondition(metrics(), scores(0))).toBe('sunny');
    expect(classifyCondition(metrics(), scores(RAMP_THRESHOLDS.partlyCloudy))).toBe('partly-cloudy');
    expect(classifyCondition(metrics(), scores(RAMP_THRESHOLDS.overcast))).toBe('overcast');
    expect(classifyCondition(metrics(), scores(RAMP_THRESHOLDS.rain))).toBe('rain');
    expect(classifyCondition(metrics(), scores(RAMP_THRESHOLDS.storm))).toBe('storm');
    expect(classifyCondition(metrics(), scores(1))).toBe('storm');
  });

  it('treats each threshold as inclusive at its lower bound', () => {
    const justBelow = RAMP_THRESHOLDS.storm - 0.001;
    expect(classifyCondition(metrics(), scores(justBelow))).toBe('rain');
  });
});
