import { useCallback, useEffect, useRef, useState } from 'react';
import type { ForecastPayload } from '@wcg/shared';
import { ApiError, fetchForecast } from '../api/client.ts';

export type LiveStatus = 'connecting' | 'live' | 'offline';

export interface UseForecastResult {
  forecast: ForecastPayload | null;
  loading: boolean;
  /** True only for the very first load of a repo, so refreshes don't blank the UI. */
  initialLoading: boolean;
  error: string | null;
  errorCode: string | null;
  /** Whether the live stream is currently connected. */
  liveStatus: LiveStatus;
  reload: () => void;
}

/**
 * Subscribes to the forecast stream for a repo and window.
 *
 * The stream sends the current forecast on connect and again whenever HEAD moves,
 * so this is both the initial load and the live update path — there is no polling
 * and no separate fetch to keep in sync. If the stream cannot be established the
 * hook falls back to a one-shot fetch, so the dashboard still works even where
 * SSE is unavailable.
 */
export function useForecast(repoId: string | null, windowDays: number): UseForecastResult {
  const [forecast, setForecast] = useState<ForecastPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('offline');
  const [nonce, setNonce] = useState(0);
  const loadedRepo = useRef<string | null>(null);

  useEffect(() => {
    if (!repoId) {
      setForecast(null);
      setError(null);
      setErrorCode(null);
      setLiveStatus('offline');
      loadedRepo.current = null;
      return;
    }

    // A different repo means the old payload is meaningless; a window change or
    // refresh of the same repo can keep showing the old one while loading.
    if (loadedRepo.current !== repoId) setForecast(null);

    let cancelled = false;
    let recovering = false;
    setLoading(true);
    setError(null);
    setErrorCode(null);
    setLiveStatus('connecting');

    const url = `/api/repos/${encodeURIComponent(repoId)}/stream?window=${windowDays}`;
    const source = new EventSource(url);

    const fail = (message: string, code: string): void => {
      if (cancelled) return;
      setForecast(null);
      setError(message);
      setErrorCode(code);
      setLoading(false);
    };

    source.addEventListener('forecast', (event) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as ForecastPayload;
        setForecast(payload);
        loadedRepo.current = repoId;
        setError(null);
        setErrorCode(null);
        setLoading(false);
        setLiveStatus('live');
      } catch {
        fail('Received a malformed forecast from the server.', 'bad_payload');
      }
    });

    source.addEventListener('stream-error', (event) => {
      if (cancelled) return;
      try {
        const body = JSON.parse((event as MessageEvent<string>).data) as {
          error?: string;
          code?: string;
        };
        fail(body.error ?? 'The forecast stream reported an error.', body.code ?? 'stream_error');
      } catch {
        fail('The forecast stream reported an error.', 'stream_error');
      }
    });

    source.onopen = () => {
      if (!cancelled) setLiveStatus('live');
    };

    /*
     * EventSource reports every failure the same opaque way, including an HTTP
     * error on the initial request. A one-shot fetch is the only way to learn
     * *why* it failed, and doubles as the fallback when streaming is blocked.
     */
    source.onerror = () => {
      if (cancelled) return;
      setLiveStatus(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
      // Already showing this repo's data, or already probing: nothing to do but
      // let EventSource retry on its own.
      if (loadedRepo.current === repoId || recovering) return;

      recovering = true;
      fetchForecast(repoId, windowDays)
        .then((payload) => {
          if (cancelled) return;
          setForecast(payload);
          loadedRepo.current = repoId;
          setLoading(false);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          fail(
            cause instanceof ApiError ? cause.message : 'Could not load the forecast.',
            cause instanceof ApiError ? cause.code : 'unknown_error',
          );
        })
        .finally(() => {
          recovering = false;
        });
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [repoId, windowDays, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return {
    forecast,
    loading,
    initialLoading: loading && forecast === null,
    error,
    errorCode,
    liveStatus,
    reload,
  };
}
