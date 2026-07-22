import type { Gauges } from '@wcg/shared';

const TREND_GLYPH = { rising: '↑', steady: '→', falling: '↓' } as const;

export interface GaugePanelProps {
  gauges: Gauges;
}

/**
 * The instrument row. Each reading pairs the weather unit with the git signal it
 * came from, so the metaphor stays honest and the panel is still diagnostic.
 */
export function GaugePanel({ gauges }: GaugePanelProps) {
  return (
    <dl className="gauges">
      <Gauge
        label="Temperature"
        value={`${gauges.temperatureF}°F`}
        meaning="Commit velocity"
        detail="Warmer means more is shipping."
      />
      <Gauge
        label="Wind"
        value={`${gauges.windMph} mph`}
        meaning="Churn rate"
        detail="Gusty means a lot of code is moving."
      />
      <Gauge
        label="Pressure"
        value={`${gauges.pressureHpa} hPa`}
        meaning="Fix ratio"
        detail={`${TREND_GLYPH[gauges.pressureTrend]} ${gauges.pressureTrend} — low means corrective work.`}
        trend={gauges.pressureTrend}
      />
      <Gauge
        label="Humidity"
        value={`${gauges.humidityPct}%`}
        meaning="Ownership"
        detail="Muggy means knowledge is trapped with few people."
      />
    </dl>
  );
}

interface GaugeProps {
  label: string;
  value: string;
  meaning: string;
  detail: string;
  trend?: Gauges['pressureTrend'];
}

function Gauge({ label, value, meaning, detail, trend }: GaugeProps) {
  return (
    <div className={`gauge${trend ? ` gauge--${trend}` : ''}`}>
      <dt className="gauge__label">{label}</dt>
      <dd className="gauge__body">
        <span className="gauge__value">{value}</span>
        <span className="gauge__meaning">{meaning}</span>
        <span className="gauge__detail">{detail}</span>
      </dd>
    </div>
  );
}
