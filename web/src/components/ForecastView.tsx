import type { ForecastPayload } from '@wcg/shared';
import { CONDITION_META } from '@wcg/shared';
import { GaugePanel } from './GaugePanel.tsx';
import { AdvisoryList, MetricsGrid } from './ForecastDetails.tsx';
import { WeatherScene } from './WeatherScene.tsx';
import { HotspotMap } from './HotspotMap.tsx';

export interface ForecastViewProps {
  payload: ForecastPayload;
  /** True while a refresh is in flight over an already-rendered forecast. */
  refreshing: boolean;
}

export function ForecastView({ payload, refreshing }: ForecastViewProps) {
  const { forecast, metrics, repo } = payload;
  const meta = CONDITION_META[forecast.condition];

  return (
    <div
      className="forecast"
      // The whole panel is themed from the condition, so one source of truth in
      // shared/ drives both the server's model and every colour on screen.
      style={
        {
          '--sky-from': meta.sky[0],
          '--sky-to': meta.sky[1],
          '--accent': meta.accent,
        } as React.CSSProperties
      }
      data-condition={forecast.condition}
      data-ink={meta.ink}
    >
      <header className="forecast__hero">
        <div className="forecast__scene" aria-hidden="true">
          <WeatherScene
            condition={forecast.condition}
            intensity={forecast.intensity}
            title={`${meta.label}: ${meta.meaning}`}
          />
        </div>

        <div className="forecast__headline-block">
          <p className="forecast__eyebrow">
            {repo.name}
            <span className="forecast__eyebrow-sep">·</span>
            last {payload.windowDays} days
            {refreshing ? <span className="forecast__refreshing">refreshing…</span> : null}
          </p>
          <h2 className="forecast__headline">{forecast.headline}</h2>
          <p className="forecast__condition">
            <span className="forecast__condition-label">{meta.label}</span>
            <span className="forecast__condition-meaning">{meta.meaning}</span>
          </p>
          <p className="forecast__summary">{forecast.summary}</p>
        </div>
      </header>

      <GaugePanel gauges={forecast.gauges} />
      <AdvisoryList advisories={forecast.advisories} />
      <HotspotMap hotspots={payload.hotspots} />
      <MetricsGrid metrics={metrics} />

      <footer className="forecast__footer">
        <span>
          HEAD <code>{payload.headSha.slice(0, 8) || 'none'}</code>
        </span>
        <span>Generated {new Date(payload.generatedAt).toLocaleTimeString()}</span>
      </footer>
    </div>
  );
}
