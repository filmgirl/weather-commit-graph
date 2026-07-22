import type { WeatherCondition } from './types.ts';

export interface ConditionMeta {
  label: string;
  /** Short gloss of what this condition means for the codebase. */
  meaning: string;
  /** Rank along the trouble ramp. `fog` and `snow` are absence-of-signal, not trouble. */
  severity: number;
  /** Accent color used by the SVG scenes and the hotspot map. */
  accent: string;
  /** Sky gradient stops, light to dark. */
  sky: [string, string];
}

export const CONDITION_META: Record<WeatherCondition, ConditionMeta> = {
  sunny: {
    label: 'Sunny',
    meaning: 'Steady velocity, low churn, few fixes. Healthy shipping.',
    severity: 0,
    accent: '#f5b431',
    sky: ['#7ec8f5', '#2f7fc4'],
  },
  'partly-cloudy': {
    label: 'Partly cloudy',
    meaning: 'Mostly healthy, with some churn or a slight velocity dip.',
    severity: 1,
    accent: '#c9d6e4',
    sky: ['#8fb8d8', '#4a7aa5'],
  },
  overcast: {
    label: 'Overcast',
    meaning: 'Velocity stalling or churn creeping up. Worth watching.',
    severity: 2,
    accent: '#94a3b4',
    sky: ['#8f9caa', '#55636f'],
  },
  rain: {
    label: 'Rain',
    meaning: 'Elevated churn with a meaningful share of fix commits.',
    severity: 3,
    accent: '#5b9bd5',
    sky: ['#6a7f92', '#3c4a57'],
  },
  storm: {
    label: 'Storm',
    meaning: 'Hotspot churn, heavy fixes, and concentrated ownership.',
    severity: 4,
    accent: '#a855f7',
    sky: ['#4a4560', '#221f31'],
  },
  fog: {
    label: 'Fog',
    meaning: 'Sparse, scattered activity. Hard to read any direction.',
    severity: 2,
    accent: '#b8bec7',
    sky: ['#adb5bd', '#7a828b'],
  },
  snow: {
    label: 'Snow',
    meaning: 'Dormant. Nothing has landed here in a long while.',
    severity: 1,
    accent: '#e2ecf5',
    sky: ['#9fb3c4', '#6d8093'],
  },
};

/** Conditions along the health ramp, best to worst. Excludes the absence states. */
export const RAMP_CONDITIONS: WeatherCondition[] = [
  'sunny',
  'partly-cloudy',
  'overcast',
  'rain',
  'storm',
];

export function conditionLabel(condition: WeatherCondition): string {
  return CONDITION_META[condition].label;
}
