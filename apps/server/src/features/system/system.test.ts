import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { loadConfig } from '../../config.ts';
import type { Database } from '../../db/client.ts';
import type { AppEnv } from '../../http/request.ts';
import { Federation } from '../federation/federation.ts';
import type { PlanningService } from '../planning/planning.service.ts';
import { StripeSync } from '../stripe/stripe.ts';
import { compareVersions, parseRelease, type ReleaseCheck, systemRoutes } from './system.ts';

describe('release check (S-273)', () => {
  test('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
  });

  test('keeps only a well-formed tag and a GitHub link', () => {
    expect(
      parseRelease({
        tag_name: 'v1.2.3',
        html_url: 'https://github.com/chteau/almanach/releases/tag/v1.2.3',
      }),
    ).toEqual({
      version: '1.2.3',
      url: 'https://github.com/chteau/almanach/releases/tag/v1.2.3',
    });
    expect(parseRelease({ tag_name: '1.2.3', html_url: 'javascript:alert(1)' })).toBeNull();
    expect(parseRelease({ tag_name: 'latest', html_url: 'https://github.com/x' })).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });
});

describe('permissions set by the server configuration', () => {
  test('STRIPE_SYNC and FEDERATION are off unless set to true', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x' })).toMatchObject({
      stripeSync: false,
      federation: false,
    });
    expect(loadConfig({ DATABASE_URL: 'postgres://x', STRIPE_SYNC: 'true', FEDERATION: '1' })).toMatchObject({
      stripeSync: true,
      federation: true,
    });
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', FEDERATION: 'yes' })).toThrow('FEDERATION');
  });

  test('a preset permission allows without asking the database and is locked in the interface', async () => {
    const noDatabase = {} as Database;
    expect(await new StripeSync(noDatabase, undefined, fetch, true).allowed()).toBe(true);
    expect(await new Federation(noDatabase, {} as PlanningService, undefined, fetch, true).allowed()).toBe(
      true,
    );
    const db = {
      select: () => ({ from: () => ({ limit: async () => [{ stripeSync: false, federation: false }] }) }),
    } as unknown as Database;
    const releases = { newer: () => null, enabled: async () => false } as unknown as ReleaseCheck;
    const app = new Hono<AppEnv>();
    app.use(async (c, next) => {
      c.set('user', { id: 'admin', role: 'admin' } as never);
      await next();
    });
    app.route(
      '/',
      systemRoutes(db, releases, { stripeSync: true, federation: false, externalSources: false, mcp: true }),
    );
    expect(await (await app.request('/')).json()).toMatchObject({
      stripeSync: true,
      federation: false,
      preset: { stripeSync: true, federation: false },
    });
    const put = await app.request('/stripe-sync', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{"enabled":false}',
    });
    expect(put.status).toBe(409);
  });
});
