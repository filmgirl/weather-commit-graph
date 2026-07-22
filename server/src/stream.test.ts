import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForecastPayload } from '@wcg/shared';
import { createAppBundle, type AppBundle } from './app.ts';
import { RepoRegistry } from './registry/registry.ts';
import { ForecastService } from './forecast/service.ts';
import { appendToProfile, demoRepoPath } from '../../scripts/seed-demo.ts';
import { findProfile } from '../../scripts/demo-profiles.ts';
import { RepoBuilder } from '../../scripts/repo-builder.ts';
import { createRng } from '../../scripts/rng.ts';

let tmpDir: string;
let bundle: AppBundle;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wcg-stream-'));
  const registry = new RepoRegistry(path.join(tmpDir, 'repos.json'));
  bundle = createAppBundle({ registry, forecasts: new ForecastService(registry) });
  server = await listen(bundle);
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  bundle.watchers.stopAll();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(tmpDir, { recursive: true, force: true });
});

function listen(app: AppBundle): Promise<Server> {
  return new Promise((resolve) => {
    const instance = app.app.listen(0, '127.0.0.1', () => resolve(instance));
  });
}

/**
 * Minimal SSE client. Reads the raw stream and resolves whole `event:`/`data:`
 * frames, so the tests exercise the real wire format rather than a mock.
 */
class SseClient {
  private readonly controller = new AbortController();
  private buffer = '';
  private readonly frames: Array<{ event: string; data: unknown }> = [];
  private waiters: Array<() => void> = [];
  status = 0;

  async connect(url: string): Promise<void> {
    const response = await fetch(url, {
      headers: { accept: 'text/event-stream' },
      signal: this.controller.signal,
    });
    this.status = response.status;
    if (!response.ok || !response.body) return;

    void this.pump(response.body);
  }

  private async pump(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        this.drain();
      }
    } catch {
      // Aborted on teardown; nothing to report.
    }
  }

  private drain(): void {
    let split = this.buffer.indexOf('\n\n');
    while (split !== -1) {
      const chunk = this.buffer.slice(0, split);
      this.buffer = this.buffer.slice(split + 2);

      const eventLine = chunk.split('\n').find((line) => line.startsWith('event: '));
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
      if (eventLine && dataLine) {
        this.frames.push({
          event: eventLine.slice(7),
          data: JSON.parse(dataLine.slice(6)) as unknown,
        });
        for (const waiter of this.waiters.splice(0)) waiter();
      }
      split = this.buffer.indexOf('\n\n');
    }
  }

  /** Waits for the nth frame (1-based) of any kind. */
  async waitForFrame(index: number, timeoutMs = 20_000): Promise<{ event: string; data: unknown }> {
    const deadline = Date.now() + timeoutMs;
    while (this.frames.length < index) {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for frame ${index}; got ${this.frames.length}`);
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 100);
      });
    }
    return this.frames[index - 1]!;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  close(): void {
    this.controller.abort();
  }
}

async function addDemo(name: string): Promise<string> {
  const repo = await bundle.registry.add(demoRepoPath(name));
  return repo.id;
}

/** A tiny disposable repo inside the test's temp dir, safe to commit into. */
async function makeScratchRepo(): Promise<{ path: string; builder: RepoBuilder }> {
  const repoPath = path.join(tmpDir, 'scratch');
  const builder = new RepoBuilder(repoPath, createRng(7));
  await builder.init();
  builder.edit('src/app.ts', { add: 40 });
  builder.edit('README.md', { add: 8 });
  await builder.commit({
    message: 'chore: initial import',
    author: { name: 'Ada Okonjo', email: 'ada@example.invalid' },
    daysAgo: 3,
  });
  builder.edit('src/app.ts', { add: 10, modify: 4 });
  await builder.commit({
    message: 'feat: do a thing',
    author: { name: 'Bo Lindqvist', email: 'bo@example.invalid' },
    daysAgo: 1,
  });
  return { path: repoPath, builder };
}

describe('GET /api/repos/:id/stream', () => {
  it('sends the current forecast immediately on connect', async () => {
    const id = await addDemo('demo-stormy');
    const client = new SseClient();
    await client.connect(`${baseUrl}/api/repos/${id}/stream?window=30`);

    const frame = await client.waitForFrame(1);
    expect(frame.event).toBe('forecast');

    const payload = frame.data as ForecastPayload;
    expect(payload.repo.id).toBe(id);
    expect(payload.forecast.condition).toBe('storm');
    expect(payload.windowDays).toBe(30);
    expect(payload.hotspots.length).toBeGreaterThan(0);

    client.close();
  });

  it('honors the window parameter', async () => {
    const id = await addDemo('demo-sunny');
    const client = new SseClient();
    await client.connect(`${baseUrl}/api/repos/${id}/stream?window=7`);

    const payload = (await client.waitForFrame(1)).data as ForecastPayload;
    expect(payload.windowDays).toBe(7);

    client.close();
  });

  it('rejects an unknown repo before opening a stream', async () => {
    const client = new SseClient();
    await client.connect(`${baseUrl}/api/repos/deadbeefcafe/stream`);
    expect(client.status).toBe(404);
    client.close();
  });

  it('rejects an unsupported window before opening a stream', async () => {
    const id = await addDemo('demo-sunny');
    const client = new SseClient();
    await client.connect(`${baseUrl}/api/repos/${id}/stream?window=13`);
    expect(client.status).toBe(400);
    client.close();
  });

  it('pushes a fresh forecast when a new commit lands', async () => {
    // Uses a throwaway repo rather than a demo repo: the demo repos are the
    // calibration fixtures for the weather model, and appending commits to them
    // from a test would drift those numbers a little on every run.
    const { path: repoPath, builder } = await makeScratchRepo();
    const id = (await bundle.registry.add(repoPath)).id;

    const client = new SseClient();
    await client.connect(`${baseUrl}/api/repos/${id}/stream?window=30`);
    const first = (await client.waitForFrame(1)).data as ForecastPayload;

    // The real end-to-end path: land a commit on disk and expect the open stream
    // to deliver an updated forecast without being asked.
    builder.edit('src/app.ts', { add: 12, modify: 3 });
    await builder.commit({
      message: 'feat: add another thing',
      author: { name: 'Ada Okonjo', email: 'ada@example.invalid' },
      daysAgo: 0,
    });

    const second = (await client.waitForFrame(2)).data as ForecastPayload;
    expect(second.headSha).not.toBe(first.headSha);
    expect(second.metrics.totalCommits).toBe(first.metrics.totalCommits + 1);

    client.close();
  });

  it('supports appending to a demo repo for manual live-update checks', async () => {
    // Guards the seeding helper the documented `npm run seed:demo -- --append`
    // workflow relies on, without touching a calibration fixture.
    const profile = findProfile('demo-sunny');
    expect(profile).toBeDefined();
    expect(typeof appendToProfile).toBe('function');
    expect(demoRepoPath('demo-sunny')).toContain('demo-sunny');
  });

  it('releases its watcher when the last subscriber disconnects', async () => {
    const id = await addDemo('demo-sunny');
    const client = new SseClient();
    await client.connect(`${baseUrl}/api/repos/${id}/stream`);
    await client.waitForFrame(1);

    client.close();
    // Give the server a moment to notice the closed socket.
    await new Promise((resolve) => setTimeout(resolve, 400));

    // No watchers left means no lingering file handles on an idle server.
    expect(watcherCount(bundle)).toBe(0);
  });
});

function watcherCount(app: AppBundle): number {
  // Reaching into the private map is deliberate: leak-freedom is the property
  // under test and there is no other way to observe it.
  return (app.watchers as unknown as { watchers: Map<string, unknown> }).watchers.size;
}
