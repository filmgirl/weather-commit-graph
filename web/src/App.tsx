import { useEffect, useState } from 'react';
import { useRepos } from './hooks/useRepos.ts';
import { useForecast, type LiveStatus } from './hooks/useForecast.ts';
import { RepoPicker } from './components/RepoPicker.tsx';
import { ForecastView } from './components/ForecastView.tsx';

const WINDOWS = [7, 30, 90] as const;
const SELECTED_REPO_KEY = 'wcg:selected-repo';

export default function App() {
  const { repos, loading, error, adding, addError, add, remove, clearAddError } = useRepos();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState<number>(30);

  // Restore the last viewed repo, but only once the list confirms it still
  // exists — a repo removed elsewhere should not leave a dead selection.
  useEffect(() => {
    if (repos.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) => {
      if (current && repos.some((repo) => repo.id === current)) return current;
      const remembered = localStorage.getItem(SELECTED_REPO_KEY);
      if (remembered && repos.some((repo) => repo.id === remembered)) return remembered;
      return repos[0]?.id ?? null;
    });
  }, [repos]);

  useEffect(() => {
    if (selectedId) localStorage.setItem(SELECTED_REPO_KEY, selectedId);
  }, [selectedId]);

  const {
    forecast,
    loading: forecastLoading,
    initialLoading,
    error: forecastError,
    liveStatus,
    reload,
  } = useForecast(selectedId, windowDays);

  return (
    <div className="app">
      <header className="app__bar">
        <div className="app__brand">
          <span className="app__logo" aria-hidden="true">
            ⛅
          </span>
          <div>
            <h1 className="app__title">Weather Commit Graph</h1>
            <p className="app__tagline">Your git history as a weather forecast</p>
          </div>
        </div>

        <div className="app__bar-right">
          {forecast ? <LiveIndicator status={liveStatus} /> : null}
          <div className="window-picker" role="group" aria-label="Forecast window">
            {WINDOWS.map((days) => (
              <button
                key={days}
                type="button"
                className={`window-picker__option${days === windowDays ? ' is-active' : ''}`}
                aria-pressed={days === windowDays}
                onClick={() => setWindowDays(days)}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="app__body">
        <RepoPicker
          repos={repos}
          selectedId={selectedId}
          loading={loading}
          adding={adding}
          addError={addError}
          onSelect={setSelectedId}
          onAdd={(path) => {
            void add(path).then((repo) => {
              if (repo) setSelectedId(repo.id);
            });
          }}
          onRemove={(id) => void remove(id)}
          onDismissAddError={clearAddError}
        />

        <main className="app__main">
          {error ? (
            <StatePanel
              title="Cannot reach the API"
              detail={error}
              action={{ label: 'Reload page', onClick: () => window.location.reload() }}
            />
          ) : loading ? (
            <StatePanel title="Warming up the instruments…" />
          ) : repos.length === 0 ? (
            <StatePanel
              title="No stations yet"
              detail="Add the absolute path to a local git repository to see its forecast. If you ran npm run seed:demo, try one of the generated repos in .demo-repos/."
            />
          ) : forecastError ? (
            <StatePanel
              title="No reading available"
              detail={forecastError}
              action={{ label: 'Try again', onClick: reload }}
            />
          ) : initialLoading ? (
            <StatePanel title="Taking a reading…" detail="Walking the commit history." />
          ) : forecast ? (
            <ForecastView payload={forecast} refreshing={forecastLoading} />
          ) : (
            <StatePanel title="Pick a station" detail="Choose a repository to see its forecast." />
          )}
        </main>
      </div>
    </div>
  );
}

interface StatePanelProps {
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
}

const LIVE_LABELS: Record<LiveStatus, { text: string; hint: string }> = {
  live: { text: 'Live', hint: 'Watching this repository for new commits.' },
  connecting: { text: 'Reconnecting', hint: 'Trying to re-establish the live connection.' },
  offline: { text: 'Not live', hint: 'Updates are not streaming; reload to refresh.' },
};

function LiveIndicator({ status }: { status: LiveStatus }) {
  const label = LIVE_LABELS[status];
  return (
    <span className={`live live--${status}`} title={label.hint}>
      <span className="live__dot" aria-hidden="true" />
      {label.text}
    </span>
  );
}

function StatePanel({ title, detail, action }: StatePanelProps) {
  return (
    <div className="state-panel">
      <h2 className="state-panel__title">{title}</h2>
      {detail ? <p className="state-panel__detail">{detail}</p> : null}
      {action ? (
        <button type="button" className="state-panel__action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
