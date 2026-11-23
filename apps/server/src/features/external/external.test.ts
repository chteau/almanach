import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { FEED_VERSION, feedSchema } from '@almanach/shared';
import { SQL } from 'bun';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { loadConfig } from '../../config.ts';
import { createDatabase, type Database, runMigrations } from '../../db/client.ts';
import {
  companies,
  externalDocuments,
  externalRevenues,
  externalSources,
  instance,
  profiles,
  users,
} from '../../db/schema.ts';
import { decryptSecret, encryptSecret } from '../../security/secrets.ts';
import { SessionStore } from '../auth/sessions.ts';
import { DocumentService } from '../documents/documents.service.ts';
import { Federation } from '../federation/federation.ts';
import { DrizzleInstallRepository } from '../install/install.repository.ts';
import { InstallService } from '../install/install.service.ts';
import { InstallTokenStore } from '../install/install-token.ts';
import { PackRegistry } from '../packs/packs.ts';
import { PackUpdates } from '../packs/updates.ts';
import { PlanningService } from '../planning/planning.service.ts';
import { ReminderJob } from '../planning/reminders.ts';
import { StripeSync } from '../stripe/stripe.ts';
import { ReleaseCheck } from '../system/system.ts';
import { ExternalSources, externalId, fetchFeed } from './external.ts';

// Database tests run against an empty PostgreSQL server: TEST_DATABASE_URL=postgres://… bun test external
const url = process.env.TEST_DATABASE_URL;

/** The parts of API answers the assertions read. */
// biome-ignore lint/suspicious/noExplicitAny: test answers are checked field by field.
type Body = any;

const doc = (id: string, type: 'quote' | 'invoice', status: string, cents: number) => ({
  id,
  type,
  number: `SEK-${id}`,
  status,
  issuedAt: '2026-11-02',
  ...(type === 'quote' && { validUntil: '2026-12-02' }),
  currency: 'EUR',
  totalExclTaxCents: cents,
  taxCents: cents / 5,
  totalInclTaxCents: cents + cents / 5,
  client: { id: 'c1', name: 'Acme', email: 'billing@acme.test', country: 'FR', siret: '73282932000074' },
  lines: [{ label: 'Plan Pro', quantity: 1.5, unitPriceCents: cents, totalCents: cents }],
});
const feed = {
  version: FEED_VERSION,
  generatedAt: '2026-11-23T10:00:00Z',
  documents: [doc('1', 'quote', 'refused', 100_000), doc('2', 'invoice', 'sent', 50_000)],
};

describe('feed format', () => {
  test('accepts almanach-feed/1 and refuses anything else', () => {
    expect(feedSchema.safeParse(feed).success).toBe(true);
    const broken = (patch: Record<string, unknown>) =>
      feedSchema.safeParse({ ...feed, documents: [{ ...feed.documents[0], ...patch }] }).success;
    expect(broken({ taxCents: 1 })).toBe(false);
    expect(broken({ status: 'lost' })).toBe(false);
    expect(broken({ extra: true })).toBe(false);
    expect(broken({ totalExclTaxCents: 1.5 })).toBe(false);
    expect(feedSchema.safeParse({ ...feed, version: 'almanach-feed/2' }).success).toBe(false);
  });

  test('ids are stable UUIDs per source', () => {
    const id = externalId('s1', 'quote:1');
    expect(id).toBe(externalId('s1', 'quote:1'));
    expect(id).not.toBe(externalId('s2', 'quote:1'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('fetches with the token, without following redirects, and refuses bad answers', async () => {
    let seen: RequestInit | undefined;
    const answer = (response: Response) =>
      (async (_input: string | URL | Request, init?: RequestInit) => {
        seen = init;
        return response;
      }) as typeof fetch;
    await fetchFeed('https://feed.test', 'secret-token-123456', answer(Response.json(feed)));
    expect(seen?.redirect).toBe('error');
    expect((seen?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      'Bearer secret-token-123456',
    );
    const failure = (response: Response) =>
      fetchFeed('https://feed.test', 'x', answer(response)).catch((error: Error) => error.message);
    expect(await failure(new Response('', { status: 401 }))).toBe('feed_unauthorized');
    expect(await failure(new Response('nope'))).toBe('feed_invalid');
    expect(await failure(new Response('x'.repeat(5 * 1024 * 1024 + 1)))).toBe('feed_too_large');
  });
});

describe.skipIf(!url)('external sources and test data (database)', () => {
  const name = `almanach_external_${process.pid}`;
  const secretsKey = Buffer.alloc(32, 3);
  let admin: SQL;
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let cookie = '';
  let companyId = '';
  let served: unknown = feed;
  const fetcher = (async () => Response.json(served)) as unknown as typeof fetch;

  const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(path, {
      method: init.method ?? 'GET',
      headers: { cookie: `almanach_session=${cookie}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  beforeAll(async () => {
    admin = new SQL(url as string);
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const target = new URL(url as string);
    target.pathname = `/${name}`;
    db = createDatabase(target.toString());
    await runMigrations(db);
    await db.insert(instance).values({
      id: 1,
      name: 'Test',
      publicUrl: 'http://localhost',
      timezone: 'Europe/Paris',
      defaultLocale: 'fr',
    });
    const [user] = await db
      .insert(users)
      .values({ email: 'a@example.test', passwordHash: 'x', role: 'admin', locale: 'fr' })
      .returning({ id: users.id });
    companyId = user?.id ?? '';
    await db.insert(companies).values({ id: companyId, userId: companyId, name: 'Studio' });
    await db.insert(profiles).values({
      companyId,
      country: 'FR',
      status: 'micro_bnc',
      activityStart: '2026-01-01',
      declarationPeriod: 'monthly',
      options: [],
      identifiers: {},
      currency: 'EUR',
      bank: { iban: null, bic: null } as never,
      company: { name: 'Studio', address: 'Paris', email: 'a@example.test', phone: null, website: null },
    });
    const config = { ...loadConfig({ DATABASE_URL: target.toString() }), cookieSecure: false, secretsKey };
    const sessions = new SessionStore(db);
    cookie = await sessions.create(companyId, { ip: null, userAgent: null });
    const packs = await PackRegistry.load();
    const planning = new PlanningService(db, packs);
    app = createApp({
      config,
      install: new InstallService(new DrizzleInstallRepository(db), new InstallTokenStore(), false),
      db,
      sessions,
      packs,
      documents: new DocumentService(db, packs),
      planning,
      reminders: new ReminderJob(db, planning, config),
      packUpdates: new PackUpdates(db, packs, [], undefined),
      releases: new ReleaseCheck(db, config.releaseCheckUrl),
      stripe: new StripeSync(db, secretsKey),
      federation: new Federation(db, planning, secretsKey),
      externalSources: new ExternalSources(db, secretsKey, fetcher),
    });
  });

  afterAll(async () => {
    await db?.$client.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.close();
  });

  const source = {
    name: 'SEKLYR prod',
    url: 'https://api.seklyr.test/feed',
    token: 'feed-token-0123456789',
    test: false,
  };

  test('sources stay off until an administrator allows them', async () => {
    expect((await call('/api/settings/external-sources', { method: 'POST', body: source })).status).toBe(409);
    expect(
      (await call('/api/system/external-sources', { method: 'PUT', body: { enabled: true } })).status,
    ).toBe(204);
    expect(
      (
        await call('/api/settings/external-sources', {
          method: 'POST',
          body: { ...source, url: 'http://x.test' },
        })
      ).status,
    ).toBe(422);
  });

  test('a source stores its token encrypted, never shows it, and its documents show read-only', async () => {
    const created = await call('/api/settings/external-sources', { method: 'POST', body: source });
    expect(created.status).toBe(201);
    const { id, result } = (await created.json()) as Body;
    expect(result).toEqual({ documents: 2 });
    const [row] = await db.select().from(externalSources).where(eq(externalSources.id, id));
    expect(row?.token).not.toContain('feed-token');
    expect(decryptSecret(row?.token ?? '', secretsKey)).toBe(source.token);
    const listed = await (await call('/api/settings/external-sources')).text();
    expect(listed).not.toContain('feed-token');
    expect(listed).not.toContain(row?.token ?? '-');

    const linked = (await (await call('/api/linked')).json()) as Body;
    expect(linked.sources).toEqual([{ id, label: 'SEKLYR prod', url: null, kind: 'external', test: false }]);
    expect(linked.documents.map((item: Body) => [item.type, item.status, item.totalCents])).toEqual([
      ['quote', 'declined', 120_000],
      ['invoice', 'sent', 60_000],
    ]);
    expect(linked.documents[0].lines[0]).toMatchObject({ description: 'Plan Pro', quantity: 1500 });
    expect(linked.clients).toHaveLength(1);
    // External documents never count in revenue: only receipts do.
    const dashboard = (await (await call('/api/dashboard')).json()) as Body;
    expect(dashboard.revenue.year.collectedCents).toBe(0);
    expect(dashboard.revenue.year.invoicedCents).toBe(0);
  });

  test('a test source marks its records test; a bad feed keeps the last copies', async () => {
    const [row] = await db.select().from(externalSources);
    const id = row?.id ?? '';
    expect(
      (
        await call(`/api/settings/external-sources/${id}`, {
          method: 'PATCH',
          body: { ...source, token: undefined, test: true },
        })
      ).status,
    ).toBe(204);
    const linked = (await (await call('/api/linked')).json()) as Body;
    expect(linked.sources[0].test).toBe(true);
    expect(linked.documents.every((item: Body) => item.test === true)).toBe(true);
    // Changing the address requires the token again.
    expect(
      (
        await call(`/api/settings/external-sources/${id}`, {
          method: 'PATCH',
          body: { ...source, token: undefined, url: 'https://other.test/feed' },
        })
      ).status,
    ).toBe(422);
    served = { ...feed, version: 'other' };
    expect((await call(`/api/settings/external-sources/${id}/sync`, { method: 'POST' })).status).toBe(409);
    expect(await db.$count(externalDocuments)).toBe(2);
    served = feed;
  });

  test('removing a source removes its copies', async () => {
    const [row] = await db.select().from(externalSources);
    expect((await call(`/api/settings/external-sources/${row?.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await db.$count(externalDocuments)).toBe(0);
    expect(((await (await call('/api/linked')).json()) as Body).sources).toEqual([]);
  });

  test('Stripe test-mode receipts never count; existing rows take the mode of the company key', async () => {
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' })
      .format(new Date())
      .slice(0, 7);
    const receipt = (externalId: string, livemode: boolean | null) => ({
      companyId,
      source: 'stripe' as const,
      externalId,
      date: `${month}-01`,
      amountCents: 10_000,
      currency: 'EUR',
      livemode,
    });
    await db.insert(externalRevenues).values([receipt('in_live', true), receipt('in_test', false)]);
    const collected = async () =>
      ((await (await call('/api/dashboard')).json()) as Body).revenue.year.collectedCents;
    expect(await collected()).toBe(10_000);

    await db.insert(externalRevenues).values(receipt('in_old', null));
    await db
      .update(companies)
      .set({ stripeKey: encryptSecret('rk_test_abcdefghijklmnop', secretsKey) })
      .where(eq(companies.id, companyId));
    await new StripeSync(db, secretsKey).backfillLivemode();
    const [old] = await db.select().from(externalRevenues).where(eq(externalRevenues.externalId, 'in_old'));
    expect(old?.livemode).toBe(false);
    expect(await collected()).toBe(10_000);
    expect(((await (await call('/api/settings/stripe')).json()) as Body).testKey).toBe(true);
  });
});
