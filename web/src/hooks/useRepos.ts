import { useCallback, useEffect, useState } from 'react';
import type { RepoSummary } from '@wcg/shared';
import { addRepo, ApiError, listRepos, removeRepo } from '../api/client.ts';

export interface UseReposResult {
  repos: RepoSummary[];
  loading: boolean;
  error: string | null;
  /** Set while an add is in flight, so the form can disable itself. */
  adding: boolean;
  addError: string | null;
  add: (path: string) => Promise<RepoSummary | null>;
  remove: (id: string) => Promise<void>;
  clearAddError: () => void;
}

/**
 * Owns the registered repo list. Add and remove errors are tracked separately
 * from the list-load error, because a rejected path should leave the existing
 * list on screen rather than replacing the whole view with an error state.
 */
export function useRepos(): UseReposResult {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listRepos()
      .then((response) => {
        if (active) setRepos(response.repos);
      })
      .catch((cause: unknown) => {
        if (active) setError(messageFor(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const add = useCallback(async (path: string): Promise<RepoSummary | null> => {
    setAdding(true);
    setAddError(null);
    try {
      const { repo } = await addRepo(path);
      setRepos((current) =>
        current.some((existing) => existing.id === repo.id) ? current : [...current, repo],
      );
      return repo;
    } catch (cause) {
      setAddError(messageFor(cause));
      return null;
    } finally {
      setAdding(false);
    }
  }, []);

  const remove = useCallback(async (id: string): Promise<void> => {
    try {
      await removeRepo(id);
      setRepos((current) => current.filter((repo) => repo.id !== id));
    } catch (cause) {
      setError(messageFor(cause));
    }
  }, []);

  const clearAddError = useCallback(() => setAddError(null), []);

  return { repos, loading, error, adding, addError, add, remove, clearAddError };
}

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  return 'Something went wrong talking to the API.';
}
