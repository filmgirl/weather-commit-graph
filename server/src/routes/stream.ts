import type { Request, Response } from 'express';
import type { ForecastPayload } from '@wcg/shared';
import type { ForecastService } from '../forecast/service.ts';
import type { RepoRegistry } from '../registry/registry.ts';
import type { WatcherRegistry } from '../watch/watcher.ts';
import { RegistryError } from '../registry/registry.ts';
import { parseWindow } from '../forecast/service.ts';

/** Comment ping interval; keeps proxies from closing an idle stream. */
const KEEPALIVE_MS = 25_000;

export interface StreamDeps {
  registry: RepoRegistry;
  forecasts: ForecastService;
  watchers: WatcherRegistry;
}

/**
 * Server-sent events stream of forecasts for one repository.
 *
 * SSE rather than websockets because the traffic is strictly one-way and SSE
 * reconnects on its own, which is exactly the behaviour wanted for a dashboard
 * left open while a dev server restarts.
 *
 * The stream sends the current forecast immediately so a subscriber never has to
 * make a separate request to populate itself, then one message per HEAD change.
 */
export async function streamForecast(req: Request, res: Response, deps: StreamDeps): Promise<void> {
  // Express 5 types a bare Request's params loosely; this route always has :id.
  const repoId = String(req.params.id);

  let windowDays: number;
  try {
    windowDays = parseWindow(req.query.window);
  } catch {
    res.status(400).json({ error: 'invalid window', code: 'invalid_window' });
    return;
  }

  let repoPath: string;
  try {
    repoPath = (await deps.registry.resolve(repoId)).path;
  } catch (error) {
    if (error instanceof RegistryError) {
      const status = error.code === 'repo_not_found' ? 404 : 410;
      res.status(status).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Nginx and friends will otherwise buffer the stream into uselessness.
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();

  let closed = false;
  let sending = false;
  let pendingResend = false;
  let lastSha: string | null = null;

  const send = (event: string, data: unknown): void => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  /**
   * Recomputes and pushes, unless a push is already in flight. Analyzing a big
   * repo takes a moment and a rebase can fire many events, so overlapping runs
   * are collapsed into a single follow-up.
   */
  const push = async (reason: 'initial' | 'head-change'): Promise<void> => {
    if (closed) return;
    if (sending) {
      pendingResend = true;
      return;
    }
    sending = true;
    try {
      const payload: ForecastPayload = await deps.forecasts.getForecast(repoId, windowDays);
      // Skip no-op notifications: a lock file touched without a new commit
      // should not make the dashboard flicker.
      if (reason === 'head-change' && payload.headSha === lastSha) return;
      lastSha = payload.headSha;
      send('forecast', payload);
    } catch (error) {
      send('stream-error', {
        error: error instanceof Error ? error.message : 'failed to compute forecast',
        code: error instanceof RegistryError ? error.code : 'forecast_failed',
      });
    } finally {
      sending = false;
      if (pendingResend && !closed) {
        pendingResend = false;
        void push('head-change');
      }
    }
  };

  const unsubscribe = await deps.watchers.subscribe(repoId, repoPath, () => {
    void push('head-change');
  });

  const keepalive = setInterval(() => {
    if (!closed) res.write(': keepalive\n\n');
  }, KEEPALIVE_MS);

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    unsubscribe();
  };

  req.on('close', cleanup);
  res.on('close', cleanup);

  await push('initial');
}
