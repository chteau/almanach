import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { serveWebApp } from './static.ts';

const web = resolve(import.meta.dir, '../../../web');
const root = await mkdtemp(join(tmpdir(), 'almanach-static-'));
await writeFile(join(root, 'index.html'), '<!doctype html><title>Almanach</title>');
await writeFile(join(root, 'favicon.svg'), await readFile(join(web, 'public/favicon.svg')));
const app = new Hono().get('*', serveWebApp(root));

describe('web app files', () => {
  afterAll(() => rm(root, { recursive: true, force: true }));

  test('the page declares the favicon that the build ships', async () => {
    expect(await readFile(join(web, 'index.html'), 'utf8')).toContain(
      '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
    );
    expect(await readFile(join(web, 'public/favicon.svg'), 'utf8')).not.toContain('<style');
  });

  test('the favicon is served as SVG', async () => {
    const response = await app.request('/favicon.svg');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toStartWith('image/svg+xml');
  });

  test('a missing file is a 404, while client-side routes get the page', async () => {
    expect((await app.request('/favicon.ico')).status).toBe(404);
    const route = await app.request('/clients/42');
    expect(route.status).toBe(200);
    expect(route.headers.get('content-type')).toStartWith('text/html');
  });
});
