import type { Advisory, RepoMetrics } from '@wcg/shared';

export interface AdvisoryListProps {
  advisories: Advisory[];
}

export function AdvisoryList({ advisories }: AdvisoryListProps) {
  if (advisories.length === 0) return null;

  return (
    <section className="advisories" aria-label="Advisories">
      <h3 className="section-title">Advisories</h3>
      <ul className="advisories__list">
        {advisories.map((advisory) => (
          <li key={advisory.title} className={`advisory advisory--${advisory.level}`}>
            <span className="advisory__level">{advisory.level}</span>
            <div className="advisory__body">
              <p className="advisory__title">{advisory.title}</p>
              <p className="advisory__detail">{advisory.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface MetricsGridProps {
  metrics: RepoMetrics;
}

/** The raw numbers behind the forecast, for when the metaphor is not enough. */
export function MetricsGrid({ metrics }: MetricsGridProps) {
  const entries: Array<[string, string]> = [
    ['Commits', formatNumber(metrics.totalCommits)],
    ['Active days', `${metrics.activeDays} of ${metrics.windowDays}`],
    ['Authors', formatNumber(metrics.authors)],
    ['Files touched', formatNumber(metrics.filesTouched)],
    ['Lines added', formatNumber(metrics.linesAdded)],
    ['Lines deleted', formatNumber(metrics.linesDeleted)],
    ['Commits / day', metrics.commitsPerDay.toFixed(2)],
    ['Churn / day', formatNumber(Math.round(metrics.churnPerDay))],
    ['Fix commits', `${Math.round(metrics.fixRatio * 100)}%`],
    ['Last commit', formatLastCommit(metrics.daysSinceLastCommit)],
  ];

  return (
    <section className="metrics" aria-label="Underlying metrics">
      <h3 className="section-title">The numbers</h3>
      <dl className="metrics__grid">
        {entries.map(([label, value]) => (
          <div key={label} className="metric">
            <dt className="metric__label">{label}</dt>
            <dd className="metric__value">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatLastCommit(days: number): string {
  if (!Number.isFinite(days)) return 'never';
  if (days < 1) return 'today';
  const rounded = Math.round(days);
  return rounded === 1 ? 'yesterday' : `${rounded} days ago`;
}
