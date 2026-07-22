import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const WEB_DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url));

/**
 * Serves the built dashboard when it exists, so `npm run build && npm start`
 * gives a working app on one port instead of an API with no UI. In development
 * the dist directory is absent and Vite serves the client instead, so this is a
 * no-op there.
 */
export function mountWebApp(app: express.Express): boolean {
  const indexHtml = path.join(WEB_DIST, 'index.html');
  if (!existsSync(indexHtml)) return false;

  // Hashed asset filenames can be cached hard; index.html must not be, or a
  // rebuild would keep serving stale asset references.
  app.use(
    express.static(WEB_DIST, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('cache-control', 'no-cache');
        else res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      },
    }),
  );

  // Single-page app fallback. Registered after the API router, so an unknown
  // /api path still answers with a JSON error rather than the HTML shell.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(indexHtml);
  });

  return true;
}
