import { Router } from 'express';
import type { ApiErrorBody } from '@wcg/shared';
import { GitError } from '../git/exec.ts';
import { RegistryError, type RepoRegistry } from '../registry/registry.ts';
import { ForecastService, parseWindow, WindowError } from '../forecast/service.ts';
import type { WatcherRegistry } from '../watch/watcher.ts';
import { streamForecast } from './stream.ts';

export interface ApiDeps {
  registry: RepoRegistry;
  forecasts: ForecastService;
  watchers: WatcherRegistry;
}

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();
  const { registry, forecasts } = deps;

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'weather-commit-graph', version: '0.1.0' });
  });

  router.get('/repos', async (_req, res, next) => {
    try {
      res.json({ repos: await registry.list() });
    } catch (error) {
      next(error);
    }
  });

  router.post('/repos', async (req, res, next) => {
    try {
      const body = req.body as { path?: unknown } | undefined;
      if (typeof body?.path !== 'string' || body.path.trim() === '') {
        sendError(res, 400, 'a repository path is required', 'invalid_request');
        return;
      }
      const repo = await registry.add(body.path);
      res.status(201).json({ repo });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/repos/:id', async (req, res, next) => {
    try {
      const removed = await registry.remove(req.params.id);
      if (!removed) {
        sendError(res, 404, `no repository registered with id ${req.params.id}`, 'repo_not_found');
        return;
      }
      // Drop cached forecasts so re-adding the repo later cannot serve stale data.
      forecasts.invalidate(req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/repos/:id/forecast', async (req, res, next) => {
    try {
      const windowDays = parseWindow(req.query.window);
      const payload = await forecasts.getForecast(req.params.id, windowDays);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get('/repos/:id/stream', async (req, res, next) => {
    try {
      await streamForecast(req, res, deps);
    } catch (error) {
      // Once the SSE headers are out there is no way to send a JSON error, so
      // just close the stream and let the client reconnect.
      if (res.headersSent) {
        res.end();
        return;
      }
      next(error);
    }
  });

  return router;
}

function sendError(
  res: Parameters<Parameters<Router['get']>[1]>[1],
  status: number,
  error: string,
  code: string,
): void {
  const body: ApiErrorBody = { error, code };
  res.status(status).json(body);
}

/**
 * Maps domain errors onto status codes in one place, so route handlers can just
 * throw and every failure still reaches the client in the same shape.
 */
export function statusForError(error: unknown): { status: number; body: ApiErrorBody } {
  if (error instanceof WindowError) {
    return { status: 400, body: { error: error.message, code: error.code } };
  }

  if (error instanceof RegistryError) {
    const status = error.code === 'repo_not_found' ? 404 : 410;
    return { status, body: { error: error.message, code: error.code } };
  }

  if (error instanceof GitError) {
    // A bad path is the caller's problem; a missing git binary is ours.
    const status = error.code === 'git_missing' ? 500 : 400;
    return { status, body: { error: error.message, code: error.code } };
  }

  return { status: 500, body: { error: 'internal error', code: 'internal_error' } };
}
