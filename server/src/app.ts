import express from 'express';
import type { ApiErrorBody } from '@wcg/shared';
import { RepoRegistry } from './registry/registry.ts';
import { ForecastService } from './forecast/service.ts';
import { WatcherRegistry } from './watch/watcher.ts';
import { createApiRouter, statusForError } from './routes/api.ts';
import { mountWebApp } from './web.ts';

export interface AppDeps {
  registry?: RepoRegistry;
  forecasts?: ForecastService;
  watchers?: WatcherRegistry;
  /** Tests opt out so an existing web/dist cannot swallow their 404 assertions. */
  serveWeb?: boolean;
}

export interface AppBundle {
  app: express.Express;
  registry: RepoRegistry;
  forecasts: ForecastService;
  watchers: WatcherRegistry;
}

/**
 * Builds the app and hands back its dependencies too, so tests can drive the
 * registry directly and point it at a throwaway config file.
 */
export function createAppBundle(deps: AppDeps = {}): AppBundle {
  const registry = deps.registry ?? new RepoRegistry();
  const forecasts = deps.forecasts ?? new ForecastService(registry);
  const watchers = deps.watchers ?? new WatcherRegistry();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.use('/api', createApiRouter({ registry, forecasts, watchers }));

  // Unknown /api routes should answer in the API error shape, not Express HTML.
  app.use('/api', (_req, res) => {
    const body: ApiErrorBody = { error: 'not found', code: 'not_found' };
    res.status(404).json(body);
  });

  // Serves the built dashboard when present; a no-op during development.
  if (deps.serveWeb !== false) mountWebApp(app);

  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ): void => {
      const { status, body } = statusForError(error);
      if (status >= 500) console.error('[wcg] unhandled request error', error);
      res.status(status).json(body);
    },
  );

  return { app, registry, forecasts, watchers };
}

export function createApp(deps: AppDeps = {}): express.Express {
  return createAppBundle(deps).app;
}
