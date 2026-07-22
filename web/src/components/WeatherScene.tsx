import type { CSSProperties } from 'react';
import type { WeatherCondition } from '@wcg/shared';

/**
 * Animated SVG weather scenes.
 *
 * Hand-authored rather than pulled from an icon set, because the scene is driven
 * by live data: intensity scales the number of raindrops, cloud speed, and how
 * often lightning strikes. All motion is CSS on SVG elements, so scenes stay
 * crisp at any size and every animation can be disabled at once for
 * prefers-reduced-motion.
 */
export interface WeatherSceneProps {
  condition: WeatherCondition;
  /** 0..1 severity, used to scale how busy the scene is. */
  intensity?: number;
  /** Rendered small (timeline cells) drops the finer details. */
  compact?: boolean;
  title?: string;
}

export function WeatherScene({
  condition,
  intensity = 0.5,
  compact = false,
  title,
}: WeatherSceneProps) {
  const level = Math.min(1, Math.max(0, intensity));

  return (
    <svg
      className={`scene scene--${condition}${compact ? ' scene--compact' : ''}`}
      viewBox="0 0 160 120"
      role="img"
      aria-label={title ?? `${condition} conditions`}
      preserveAspectRatio="xMidYMid meet"
    >
      {title ? <title>{title}</title> : null}
      {renderScene(condition, level, compact)}
    </svg>
  );
}

function renderScene(condition: WeatherCondition, level: number, compact: boolean) {
  switch (condition) {
    case 'sunny':
      return <SunnyScene level={level} compact={compact} />;
    case 'partly-cloudy':
      return <PartlyCloudyScene level={level} compact={compact} />;
    case 'overcast':
      return <OvercastScene level={level} compact={compact} />;
    case 'rain':
      return <RainScene level={level} compact={compact} />;
    case 'storm':
      return <StormScene level={level} compact={compact} />;
    case 'fog':
      return <FogScene compact={compact} />;
    case 'snow':
      return <SnowScene level={level} compact={compact} />;
  }
}

interface SceneProps {
  level: number;
  compact: boolean;
}

/* ---------- Sun ---------- */

function Sun({ cx, cy, r, rays }: { cx: number; cy: number; r: number; rays: boolean }) {
  return (
    <g className="scene__sun">
      {rays ? (
        <g className="scene__rays" style={{ transformOrigin: `${cx}px ${cy}px` }}>
          {Array.from({ length: 8 }, (_, index) => {
            const angle = (index * Math.PI) / 4;
            const inner = r + 5;
            const outer = r + 13;
            return (
              <line
                key={index}
                x1={cx + Math.cos(angle) * inner}
                y1={cy + Math.sin(angle) * inner}
                x2={cx + Math.cos(angle) * outer}
                y2={cy + Math.sin(angle) * outer}
                className="scene__ray"
              />
            );
          })}
        </g>
      ) : null}
      <circle cx={cx} cy={cy} r={r} className="scene__sun-disc" />
    </g>
  );
}

function SunnyScene({ level, compact }: SceneProps) {
  return (
    <>
      {/* Rays are kept even when compact: without them a small sun is just a dot
          and the cell stops reading as weather. */}
      <Sun cx={80} cy={54} r={compact ? 16 : 22} rays />
      {/* Even clear skies get a wisp or two once there is any churn at all. */}
      {!compact && level > 0.08 ? (
        <Cloud x={26} y={86} scale={0.5} opacity={0.5} driftSeconds={34} />
      ) : null}
    </>
  );
}

function PartlyCloudyScene({ level, compact }: SceneProps) {
  return (
    <>
      <Sun cx={62} cy={46} r={compact ? 14 : 19} rays />
      <Cloud x={82} y={62} scale={compact ? 0.85 : 1} opacity={0.95} driftSeconds={26} />
      {!compact ? (
        <Cloud x={34} y={84} scale={0.6} opacity={0.6} driftSeconds={32} delaySeconds={-8} />
      ) : null}
      {!compact && level > 0.55 ? (
        <Cloud x={118} y={88} scale={0.55} opacity={0.5} driftSeconds={38} delaySeconds={-16} />
      ) : null}
    </>
  );
}

function OvercastScene({ compact }: SceneProps) {
  return (
    <>
      <Cloud x={54} y={50} scale={compact ? 0.9 : 1.15} opacity={0.9} driftSeconds={40} />
      <Cloud x={100} y={64} scale={compact ? 1 : 1.3} opacity={0.98} driftSeconds={34} delaySeconds={-12} />
      {!compact ? (
        <Cloud x={30} y={78} scale={0.9} opacity={0.75} driftSeconds={46} delaySeconds={-22} />
      ) : null}
    </>
  );
}

function RainScene({ level, compact }: SceneProps) {
  // More churn means more rain, which is the whole point of the metaphor.
  const drops = compact ? 5 : Math.round(8 + level * 12);
  return (
    <>
      <Cloud x={72} y={44} scale={compact ? 1 : 1.25} opacity={0.98} driftSeconds={44} />
      {!compact ? (
        <Cloud x={112} y={56} scale={0.95} opacity={0.85} driftSeconds={38} delaySeconds={-14} />
      ) : null}
      <Rain count={drops} level={level} />
    </>
  );
}

function StormScene({ level, compact }: SceneProps) {
  const drops = compact ? 6 : Math.round(12 + level * 14);
  return (
    <>
      <Cloud x={74} y={42} scale={compact ? 1.05 : 1.35} opacity={1} driftSeconds={30} dark />
      {!compact ? (
        <Cloud x={116} y={54} scale={1} opacity={0.9} driftSeconds={26} delaySeconds={-10} dark />
      ) : null}
      <Rain count={drops} level={level} slant />
      <g className="scene__lightning">
        <path d="M78 62 L68 86 L78 86 L70 108 L92 80 L80 80 L88 62 Z" className="scene__bolt" />
      </g>
    </>
  );
}

function FogScene({ compact }: { compact: boolean }) {
  const bands = compact ? 4 : 7;
  // Two scenes of different sizes can be on the page at once, so the filter id
  // is per-variant rather than fixed — otherwise every scene would resolve to
  // whichever blur happened to be defined first.
  const blurId = compact ? 'wcg-fog-blur-compact' : 'wcg-fog-blur';
  return (
    <>
      <defs>
        <filter id={blurId} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation={compact ? 1.6 : 2.4} />
        </filter>
      </defs>
      {/* A shape behind the bands gives the fog something to obscure, which is
          what makes it read as fog rather than as stripes. */}
      <Cloud x={78} y={54} scale={compact ? 0.9 : 1.1} opacity={0.35} driftSeconds={60} />
      <g className="scene__fog" filter={`url(#${blurId})`}>
        {Array.from({ length: bands }, (_, index) => {
          // Irregular bands: even spacing and matching widths look like a
          // loading skeleton instead of weather.
          const y = 26 + index * (compact ? 18 : 11) + fract(index * 0.618) * 6;
          const height = (compact ? 5 : 4) + fract(index * 0.377) * 5;
          const width = 150 + fract(index * 0.911) * 90;
          const x = -30 - fract(index * 0.494) * 40;
          return (
            <rect
              key={index}
              x={x}
              y={y}
              width={width}
              height={height}
              rx={height / 2}
              className="scene__fog-band"
              style={{
                animationDuration: `${8 + fract(index * 0.732) * 9}s`,
                animationDelay: `${index * -1.9}s`,
                opacity: 0.3 + fract(index * 0.208) * 0.4,
              }}
            />
          );
        })}
      </g>
    </>
  );
}

function SnowScene({ compact }: SceneProps) {
  const flakes = compact ? 6 : 14;
  return (
    <>
      <Cloud x={76} y={40} scale={compact ? 0.95 : 1.15} opacity={0.75} driftSeconds={54} />
      <g className="scene__snow">
        {Array.from({ length: flakes }, (_, index) => {
          // Deterministic scatter: a seeded fract keeps the layout stable across
          // renders so flakes do not teleport when the component re-renders.
          const x = 14 + fract(index * 0.618) * 132;
          const phase = fract(index * 0.377);
          const delay = -phase * 9;
          const duration = 7 + fract(index * 0.911) * 6;
          return (
            <circle
              key={index}
              cx={x}
              cy={54}
              r={compact ? 1.6 : 2.1}
              className="scene__flake"
              style={
                {
                  animationDuration: `${duration}s`,
                  animationDelay: `${delay}s`,
                  '--frozen-y': `${phase * 50 - 14}px`,
                } as CSSProperties
              }
            />
          );
        })}
      </g>
    </>
  );
}

/* ---------- Building blocks ---------- */

function Cloud({
  x,
  y,
  scale,
  opacity,
  driftSeconds,
  delaySeconds = 0,
  dark = false,
}: {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  driftSeconds: number;
  delaySeconds?: number;
  dark?: boolean;
}) {
  return (
    <g
      className={`scene__cloud${dark ? ' scene__cloud--dark' : ''}`}
      style={{
        animationDuration: `${driftSeconds}s`,
        animationDelay: `${delaySeconds}s`,
        opacity,
      }}
      transform={`translate(${x} ${y}) scale(${scale})`}
    >
      <ellipse cx={-16} cy={4} rx={17} ry={12} />
      <ellipse cx={2} cy={-4} rx={21} ry={16} />
      <ellipse cx={20} cy={4} rx={16} ry={11} />
      <rect x={-32} y={2} width={68} height={13} rx={6.5} />
    </g>
  );
}

function Rain({ count, level, slant = false }: { count: number; level: number; slant?: boolean }) {
  return (
    <g className={`scene__rain${slant ? ' scene__rain--slant' : ''}`}>
      {Array.from({ length: count }, (_, index) => {
        const x = 16 + fract(index * 0.618) * 128;
        const phase = fract(index * 0.484);
        const delay = -phase * 1.2;
        // Heavier weather falls faster.
        const duration = 0.95 - level * 0.35 + fract(index * 0.773) * 0.3;
        return (
          <line
            key={index}
            x1={x}
            y1={58}
            x2={x}
            y2={68}
            className="scene__drop"
            style={
              {
                animationDuration: `${duration}s`,
                animationDelay: `${delay}s`,
                // Where this drop sits when motion is disabled. Without it every
                // drop freezes on the same line and the rain looks like a barcode.
                '--frozen-y': `${phase * 46 - 6}px`,
              } as CSSProperties
            }
          />
        );
      })}
    </g>
  );
}

/** Fractional part of the golden-ratio walk: cheap, stable, well-spread scatter. */
function fract(value: number): number {
  return value - Math.floor(value);
}
