import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppBundle, type AppBundle } from './app.ts';
import { RepoRegistry } from './registry/registry.ts';
import { ForecastService } from './forecast/service.ts';
import { demoRepoPath } from '../../scripts/seed-demo.ts';

let tmpDir: string;
let bundle: AppBundle;

beforeEach(async () => {
  // Every test gets its own registry file so nothing touches the real ~/.wcg.
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wcg-api-'));
  const registry = new RepoRegistry(path.join(tmpDir, 'repos.json'));
  bundle = createAppBundle({ registry, forecasts: new ForecastService(registry) });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function addDemo(name: string): Promise<string> {
  const response = await request(bundle.app)
    .post('/api/repos')
    .send({ path: demoRepoPath(name) })
    .expect(201);
  return (response.body as { repo: { id: string } }).repo.id;
}

describe('GET /api/health', () => {
  it('reports ok', async () => {
    const response = await request(bundle.app).get('/api/health').expect(200);
    expect(response.body).toMatchObject({ ok: true, service: 'weather-commit-graph' });
  });
});

describe('repo registry endpoints', () => {
  it('starts empty', async () => {
    const response = await request(bundle.app).get('/api/repos').expect(200);
    expect(response.body).toEqual({ repos: [] });
  });

  it('adds a repo and lists it back', async () => {
    const created = await request(bundle.app)
      .post('/api/repos')
      .send({ path: demoRepoPath('demo-sunny') })
      .expect(201);

    const repo = (created.body as { repo: { id: string; name: string; path: string } }).repo;
    expect(repo.name).toBe('demo-sunny');
    expect(repo.id).toMatch(/^[0-9a-f]{12}$/);
    expect(path.isAbsolute(repo.path)).toBe(true);

    const listed = await request(bundle.app).get('/api/repos').expect(200);
    expect((listed.body as { repos: unknown[] }).repos).toHaveLength(1);
  });

  it('is idempotent when the same repo is added twice', async () => {
    const first = await addDemo('demo-sunny');
    const second = await addDemo('demo-sunny');
    expect(second).toBe(first);

    const listed = await request(bundle.app).get('/api/repos').expect(200);
    expect((listed.body as { repos: unknown[] }).repos).toHaveLength(1);
  });

  it('persists across registry instances', async () => {
    await addDemo('demo-sunny');

    // A fresh registry reading the same file should see the entry.
    const reloaded = new RepoRegistry(path.join(tmpDir, 'repos.json'));
    const repos = await reloaded.list();
    expect(repos.map((repo) => repo.name)).toEqual(['demo-sunny']);
  });

  it('rejects a missing path', async () => {
    const response = await request(bundle.app).post('/api/repos').send({}).expect(400);
    expect((response.body as { code: string }).code).toBe('invalid_request');
  });

  it('rejects a path that is not a git repository', async () => {
    const response = await request(bundle.app).post('/api/repos').send({ path: tmpDir }).expect(400);
    expect((response.body as { code: string }).code).toBe('not_a_repo');
  });

  it('rejects a relative path', async () => {
    const response = await request(bundle.app)
      .post('/api/repos')
      .send({ path: './somewhere' })
      .expect(400);
    expect((response.body as { error: string }).error).toMatch(/absolute/i);
  });

  it('removes a repo', async () => {
    const id = await addDemo('demo-sunny');
    await request(bundle.app).delete(`/api/repos/${id}`).expect(204);
    const listed = await request(bundle.app).get('/api/repos').expect(200);
    expect((listed.body as { repos: unknown[] }).repos).toEqual([]);
  });

  it('404s when removing an unknown repo', async () => {
    const response = await request(bundle.app).delete('/api/repos/deadbeefcafe').expect(404);
    expect((response.body as { code: string }).code).toBe('repo_not_found');
  });
});

describe('GET /api/repos/:id/forecast', () => {
  it('returns a complete forecast payload', async () => {
    const id = await addDemo('demo-stormy');
    const response = await request(bundle.app).get(`/api/repos/${id}/forecast`).expect(200);
    const body = response.body as Record<string, unknown>;

    expect(body.repo).toMatchObject({ id, name: 'demo-stormy' });
    expect(body.windowDays).toBe(30);
    expect(body.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isNaN(Date.parse(String(body.generatedAt)))).toBe(false);

    const forecast = body.forecast as Record<string, unknown>;
    expect(forecast.condition).toBe('storm');
    expect(typeof forecast.headline).toBe('string');
    expect(typeof forecast.summary).toBe('string');
    expect(forecast.gauges).toMatchObject({ pressureTrend: expect.any(String) });
    expect(Array.isArray(forecast.advisories)).toBe(true);

    expect(Array.isArray(body.hotspots)).toBe(true);
    expect((body.hotspots as unknown[]).length).toBeGreaterThan(0);
    // 30 observed days plus the forward projection.
    expect((body.timeline as unknown[]).length).toBe(33);
    expect(body.metrics).toMatchObject({ windowDays: 30 });
  });

  it('honors the window parameter and the d shorthand', async () => {
    const id = await addDemo('demo-sunny');

    const week = await request(bundle.app).get(`/api/repos/${id}/forecast?window=7`).expect(200);
    expect((week.body as { windowDays: number }).windowDays).toBe(7);
    expect((week.body as { timeline: unknown[] }).timeline).toHaveLength(10);

    const shorthand = await request(bundle.app)
      .get(`/api/repos/${id}/forecast?window=90d`)
      .expect(200);
    expect((shorthand.body as { windowDays: number }).windowDays).toBe(90);
  });

  it('rejects an unsupported window', async () => {
    const id = await addDemo('demo-sunny');
    const response = await request(bundle.app)
      .get(`/api/repos/${id}/forecast?window=13`)
      .expect(400);
    expect((response.body as { code: string }).code).toBe('invalid_window');
  });

  it('rejects a nonsense window', async () => {
    const id = await addDemo('demo-sunny');
    await request(bundle.app).get(`/api/repos/${id}/forecast?window=abc`).expect(400);
  });

  it('404s for an unregistered repo id', async () => {
    const response = await request(bundle.app)
      .get('/api/repos/deadbeefcafe/forecast')
      .expect(404);
    expect((response.body as { code: string }).code).toBe('repo_not_found');
  });

  it('serves a cached payload for an unchanged HEAD', async () => {
    const id = await addDemo('demo-sunny');
    const first = await request(bundle.app).get(`/api/repos/${id}/forecast`).expect(200);
    const second = await request(bundle.app).get(`/api/repos/${id}/forecast`).expect(200);

    // Identical generatedAt proves the second response came from cache rather
    // than a fresh analysis.
    expect((second.body as { generatedAt: string }).generatedAt).toBe(
      (first.body as { generatedAt: string }).generatedAt,
    );
  });

  it('recomputes after the cache is invalidated', async () => {
    const id = await addDemo('demo-sunny');
    const first = await request(bundle.app).get(`/api/repos/${id}/forecast`).expect(200);

    bundle.forecasts.invalidate(id);
    await new Promise((resolve) => setTimeout(resolve, 2));

    const second = await request(bundle.app).get(`/api/repos/${id}/forecast`).expect(200);
    expect((second.body as { generatedAt: string }).generatedAt).not.toBe(
      (first.body as { generatedAt: string }).generatedAt,
    );
  });

  it('reports a repo that has gone missing since it was added', async () => {
    const registry = new RepoRegistry(path.join(tmpDir, 'gone.json'));
    const local = createAppBundle({ registry, forecasts: new ForecastService(registry) });

    // Register a real repo, then rewrite the entry to point somewhere that no
    // longer exists — the same situation as a repo being moved or deleted.
    const id = await registry.add(demoRepoPath('demo-sunny')).then((repo) => repo.id);
    const stored = await registry.get(id);
    expect(stored).toBeDefined();
    await rm(path.join(tmpDir, 'gone.json'), { force: true });
    Object.assign(stored!, { path: path.join(tmpDir, 'not-here') });

    const response = await request(local.app).get(`/api/repos/${id}/forecast`).expect(410);
    expect((response.body as { code: string }).code).toBe('repo_unavailable');
  });
});

describe('unknown api routes', () => {
  it('answer in the API error shape', async () => {
    const response = await request(bundle.app).get('/api/nope').expect(404);
    expect(response.body).toEqual({ error: 'not found', code: 'not_found' });
  });
});
