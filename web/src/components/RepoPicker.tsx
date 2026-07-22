import { useState, type FormEvent } from 'react';
import type { RepoSummary } from '@wcg/shared';

export interface RepoPickerProps {
  repos: RepoSummary[];
  selectedId: string | null;
  loading: boolean;
  adding: boolean;
  addError: string | null;
  onSelect: (id: string) => void;
  onAdd: (path: string) => void;
  onRemove: (id: string) => void;
  onDismissAddError: () => void;
}

export function RepoPicker({
  repos,
  selectedId,
  loading,
  adding,
  addError,
  onSelect,
  onAdd,
  onRemove,
  onDismissAddError,
}: RepoPickerProps) {
  const [draft, setDraft] = useState('');

  function submit(event: FormEvent): void {
    event.preventDefault();
    const path = draft.trim();
    if (path === '' || adding) return;
    onAdd(path);
    setDraft('');
  }

  return (
    <aside className="repo-picker">
      <div className="repo-picker__head">
        <h2 className="repo-picker__title">Stations</h2>
        <p className="repo-picker__hint">Local repositories being observed.</p>
      </div>

      {loading ? (
        <p className="repo-picker__empty">Loading stations…</p>
      ) : repos.length === 0 ? (
        <p className="repo-picker__empty">
          No repositories yet. Add an absolute path to a local git repo below.
        </p>
      ) : (
        <ul className="repo-list">
          {repos.map((repo) => {
            const selected = repo.id === selectedId;
            return (
              <li key={repo.id} className={`repo-list__item${selected ? ' is-selected' : ''}`}>
                <button
                  type="button"
                  className="repo-list__select"
                  aria-current={selected}
                  onClick={() => onSelect(repo.id)}
                >
                  <span className="repo-list__name">{repo.name}</span>
                  <span className="repo-list__path" title={repo.path}>
                    {shortenPath(repo.path)}
                  </span>
                </button>
                <button
                  type="button"
                  className="repo-list__remove"
                  aria-label={`Remove ${repo.name}`}
                  title={`Remove ${repo.name}`}
                  onClick={() => onRemove(repo.id)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form className="add-repo" onSubmit={submit}>
        <label className="add-repo__label" htmlFor="repo-path">
          Add a repository
        </label>
        <input
          id="repo-path"
          className="add-repo__input"
          type="text"
          placeholder="/Users/you/code/project"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setDraft(event.target.value);
            if (addError) onDismissAddError();
          }}
        />
        <button type="submit" className="add-repo__submit" disabled={adding || draft.trim() === ''}>
          {adding ? 'Checking…' : 'Add station'}
        </button>
        {addError ? (
          <p className="add-repo__error" role="alert">
            {addError}
          </p>
        ) : null}
      </form>
    </aside>
  );
}

/**
 * Shows the tail of a path, which is the part that actually distinguishes one
 * checkout from another. Done here rather than with CSS truncation because the
 * usual `direction: rtl` trick relocates the leading slash and renders a path
 * that does not exist.
 */
function shortenPath(fullPath: string): string {
  const segments = fullPath.split('/').filter(Boolean);
  if (segments.length <= 2) return fullPath;
  return `…/${segments.slice(-2).join('/')}`;
}
