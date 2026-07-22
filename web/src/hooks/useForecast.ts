import { useCallback, useEffect, useRef, useState } from 'react';
import type { ForecastPayload } from '@wcg/shared';
import { ApiError, fetchForecast } from '../api/client.ts';

export interface UseForecastResult {
  forecast: ForecastPayload | null;
  loading: boolean;
  /** True only for the very first load of a repo, so refreshes don't blank the UI. */
  initialLoading: boolean;
  error: string | null;
  errorCode: string | null;
  reload: () => void;
}

/**
 * Fetches the forecast for the selected repo and window.
 *
 * Keeps the previous payload visible while a new one loads so switching windows
 * does not flash an empty dashboard, and aborts in-flight requests when the
 * selection changes so a slow response cannot overwrite a newer one.
 */
export function useForecast(repoId: string | null, windowDays: number): UseForecastResult {
  const [forecast, setForecast] = useState<ForecastPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const loadedRepo = useRef<string | null>(null);

  useEffect(() => {
    if (!repoId) {
      setForecast(null);
      setError(null);
      setErrorCode(null);
      loadedRepo.current = null;
      return;
    }

    // A different repo means the old payload is meaningless; a window change or
    // refresh of the same repo can keep showing the old one while loading.
    if (loadedRepo.current !== repoId) setForecast(null);

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setErrorCode(null);

    fetchForecast(repoId, windowDays, controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return;
        setForecast(payload);
        loadedRepo.current = repoId;
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setForecast(null);
        setError(cause instanceof ApiError ? cause.message : 'Could not load the forecast.');
        setErrorCode(cause instanceof ApiError ? cause.code : 'unknown_error');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [repoId, windowDays, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return {
    forecast,
    loading,
    initialLoading: loading && forecast === null,
    error,
    errorCode,
    reload,
  };
}
