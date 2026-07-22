import type { HotspotFile, WeatherCondition } from '@wcg/shared';
import type { FileAggregate } from '../metrics/engine.ts';
import { unit } from '../metrics/math.ts';

export const DEFAULT_HOTSPOT_LIMIT = 40;

/**
 * Ranks files as their own little weather cells. The score blends *how often* a
 * file changes with *how big* it is, which is the classic hotspot heuristic: a
 * large file touched constantly is far riskier than a small one churning just as
 * often, because there is more surface area to break.
 */
export function buildHotspots(
  files: FileAggregate[],
  limit = DEFAULT_HOTSPOT_LIMIT,
): HotspotFile[] {
  if (files.length === 0) return [];

  const maxWeighted = Math.max(...files.map((file) => file.weightedChurn), 1);
  const maxCommits = Math.max(...files.map((file) => file.commits), 1);
  const maxSize = Math.max(...files.map((file) => file.sizeBytes), 1);

  return files
    .map((file) => {
      const churnScore = unit(file.weightedChurn / maxWeighted);
      const frequencyScore = unit(file.commits / maxCommits);
      // Size is dampened with a square root: it matters, but a 40KB file is not
      // 10x the risk of a 4KB one.
      const sizeScore = unit(Math.sqrt(file.sizeBytes / maxSize));
      const fixScore = file.commits === 0 ? 0 : unit(file.fixCommits / file.commits);

      const hotspotScore = unit(
        0.4 * churnScore + 0.3 * frequencyScore + 0.15 * sizeScore + 0.15 * fixScore,
      );

      return {
        path: file.path,
        commits: file.commits,
        fixCommits: file.fixCommits,
        linesAdded: file.added,
        linesDeleted: file.deleted,
        churn: file.churn,
        authors: file.authors.size,
        hotspotScore: round(hotspotScore, 4),
        condition: fileCondition(hotspotScore, fixScore),
        lastTouchedAt: file.lastTouched.toISOString(),
      } satisfies HotspotFile;
    })
    .sort((a, b) => b.hotspotScore - a.hotspotScore || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/**
 * A file's own condition. Heavy corrective work bumps a file up the ramp even at
 * a moderate score, because repeatedly *fixing* one file is the real signal.
 */
function fileCondition(hotspotScore: number, fixScore: number): WeatherCondition {
  const adjusted = unit(hotspotScore + fixScore * 0.2);
  if (adjusted >= 0.68) return 'storm';
  if (adjusted >= 0.48) return 'rain';
  if (adjusted >= 0.3) return 'overcast';
  if (adjusted >= 0.15) return 'partly-cloudy';
  return 'sunny';
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
