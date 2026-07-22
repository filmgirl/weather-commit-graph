import { useState } from 'react';
import type { HotspotFile } from '@wcg/shared';
import { CONDITION_META } from '@wcg/shared';
import { WeatherScene } from './WeatherScene.tsx';

export interface HotspotMapProps {
  hotspots: HotspotFile[];
}

/** How many cells to show before the "show all" toggle is needed. */
const COLLAPSED_LIMIT = 12;

/**
 * The per-file storm map.
 *
 * Cells are sized by hotspot score so the worst offenders physically dominate
 * the view, which is the point: a repo's trouble is usually concentrated in a
 * handful of files and a uniform grid would hide that.
 */
export function HotspotMap({ hotspots }: HotspotMapProps) {
  const [expanded, setExpanded] = useState(false);
  const [activePath, setActivePath] = useState<string | null>(null);

  if (hotspots.length === 0) {
    return (
      <section className="hotspots" aria-label="Hotspot map">
        <h3 className="section-title">Storm map</h3>
        <p className="hotspots__empty">
          No files changed in this window, so there is nothing to map.
        </p>
      </section>
    );
  }

  const visible = expanded ? hotspots : hotspots.slice(0, COLLAPSED_LIMIT);
  // Track the selection by path and re-resolve it every render. Narrowing the
  // window can drop the selected file out of the list entirely, and the detail
  // pane must never describe a file that is no longer on the map.
  const detail = hotspots.find((file) => file.path === activePath) ?? hotspots[0]!;

  return (
    <section className="hotspots" aria-label="Hotspot map">
      <header className="hotspots__head">
        <h3 className="section-title">Storm map</h3>
        <p className="hotspots__caption">
          Files sized by hotspot score, which blends how often a file changes with
          how big it is and how much of that work was corrective.
        </p>
      </header>

      <div className="hotspots__layout">
        <ul className="hotspot-grid">
          {visible.map((file) => (
            <li
              key={file.path}
              className="hotspot-grid__item"
              // Both the base width and the share of leftover space scale with the
              // score, so the hottest files are unmistakably the biggest cells.
              style={
                {
                  flexBasis: `${112 + file.hotspotScore * 168}px`,
                  flexGrow: 1 + file.hotspotScore * 4,
                } as React.CSSProperties
              }
            >
              <button
                type="button"
                className={`hotspot${detail.path === file.path ? ' is-active' : ''}`}
                style={{ '--cell-accent': CONDITION_META[file.condition].accent } as React.CSSProperties}
                onClick={() => setActivePath(file.path)}
                onMouseEnter={() => setActivePath(file.path)}
                onFocus={() => setActivePath(file.path)}
                aria-label={`${file.path}: ${CONDITION_META[file.condition].label}, ${file.churn} lines changed across ${file.commits} commits`}
              >
                <span className="hotspot__scene" aria-hidden="true">
                  <WeatherScene condition={file.condition} intensity={file.hotspotScore} compact />
                </span>
                <span className="hotspot__name">{basename(file.path)}</span>
                <span className="hotspot__meta">
                  {formatNumber(file.churn)} lines · {file.commits}{' '}
                  {file.commits === 1 ? 'commit' : 'commits'}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <aside className="hotspot-detail" aria-live="polite">
          <p className="hotspot-detail__path" title={detail.path}>
            {detail.path}
          </p>
          <p className="hotspot-detail__condition">
            <span
              className="hotspot-detail__badge"
              style={{ background: CONDITION_META[detail.condition].accent }}
            >
              {CONDITION_META[detail.condition].label}
            </span>
            <span className="hotspot-detail__score">
              score {detail.hotspotScore.toFixed(2)}
            </span>
          </p>
          <dl className="hotspot-detail__stats">
            <Stat label="Commits" value={formatNumber(detail.commits)} />
            <Stat label="Fix commits" value={formatNumber(detail.fixCommits)} />
            <Stat label="Added" value={`+${formatNumber(detail.linesAdded)}`} />
            <Stat label="Deleted" value={`−${formatNumber(detail.linesDeleted)}`} />
            <Stat label="Authors" value={formatNumber(detail.authors)} />
            <Stat label="Last touched" value={formatDate(detail.lastTouchedAt)} />
          </dl>
        </aside>
      </div>

      {hotspots.length > COLLAPSED_LIMIT ? (
        <button
          type="button"
          className="hotspots__toggle"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded
            ? `Show top ${COLLAPSED_LIMIT}`
            : `Show all ${hotspots.length} files`}
        </button>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="hotspot-detail__stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
