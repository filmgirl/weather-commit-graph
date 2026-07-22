import type { TimelineDay } from '@wcg/shared';
import { CONDITION_META } from '@wcg/shared';
import { WeatherScene } from './WeatherScene.tsx';

export interface TimelineStripProps {
  timeline: TimelineDay[];
  /** How many observed days to show before the projection. */
  observedDays?: number;
}

const DEFAULT_OBSERVED = 7;

/**
 * The forecast strip: the last week of observed days followed by the projection.
 *
 * Bar height encodes commits and the mini scene encodes that day's condition, so
 * a run of storms or a frozen stretch is visible at a glance. Projected days are
 * drawn hollow and carry a confidence value, because presenting a guess with the
 * same authority as a measurement would be dishonest.
 */
export function TimelineStrip({ timeline, observedDays = DEFAULT_OBSERVED }: TimelineStripProps) {
  const observed = timeline.filter((day) => day.kind === 'observed').slice(-observedDays);
  const projected = timeline.filter((day) => day.kind === 'projected');
  const days = [...observed, ...projected];

  if (days.length === 0) return null;

  // Scale bars against the busiest day in view so the shape is always readable,
  // whatever the repo's absolute commit volume happens to be.
  const peak = Math.max(...days.map((day) => day.commits), 1);

  return (
    <section className="timeline" aria-label="Daily forecast">
      <header className="timeline__head">
        <h3 className="section-title">Forecast strip</h3>
        <p className="timeline__caption">
          Last {observed.length} days observed, then {projected.length} projected. Bar height is
          commits; the projection is a damped read of the recent trend, not a promise.
        </p>
      </header>

      <ol className="timeline__list">
        {days.map((day) => {
          const meta = CONDITION_META[day.condition];
          const height = Math.max(3, Math.round((day.commits / peak) * 100));
          return (
            <li
              key={`${day.kind}-${day.date}`}
              className={`tl-day tl-day--${day.kind}`}
              style={{ '--accent': meta.accent } as React.CSSProperties}
            >
              <div className="tl-day__scene" aria-hidden="true">
                <WeatherScene condition={day.condition} intensity={0.5} compact />
              </div>

              <div className="tl-day__bar-track">
                <div
                  className="tl-day__bar"
                  style={{ height: `${height}%` }}
                  title={`${formatCommits(day.commits)} commits, ${day.churn.toLocaleString('en-US')} lines`}
                />
              </div>

              <p className="tl-day__commits">{formatCommits(day.commits)}</p>
              <p className="tl-day__date">
                <span className="tl-day__weekday">{weekday(day.date)}</span>
                <span className="tl-day__daynum">{dayNumber(day.date)}</span>
              </p>
              <p className="tl-day__condition">
                {day.kind === 'projected' && day.confidence !== undefined
                  ? `${Math.round(day.confidence * 100)}% conf.`
                  : meta.label}
              </p>
              <span className="tl-day__sr">
                {day.date}: {meta.label}, {formatCommits(day.commits)} commits,{' '}
                {day.churn.toLocaleString('en-US')} lines changed
                {day.kind === 'projected' ? ' (projected)' : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function formatCommits(value: number): string {
  // Projections are fractional; observed counts are whole.
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function weekday(date: string): string {
  return parseLocalDate(date).toLocaleDateString('en-US', { weekday: 'short' });
}

function dayNumber(date: string): string {
  return String(parseLocalDate(date).getDate());
}

/**
 * Parses the server's local `YYYY-MM-DD` day key as a local date. `new Date(str)`
 * would read it as UTC and shift the label by a day in western time zones.
 */
function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}
