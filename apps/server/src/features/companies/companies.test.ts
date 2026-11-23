import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../../app.ts';
import { loadConfig } from '../../config.ts';
import { createDatabase, type Database, runMigrations } from '../../db/client.ts';
import { clients, instance, profiles, users } from '../../db/schema.ts';
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

// Runs against an empty PostgreSQL database: TEST_DATABASE_URL=postgres://… bun test companies
const url = process.env.TEST_DATABASE_URL;

/** Stripe stand-in: one paid invoice, no charges or refunds. */
const stripeFetch = (async (input: string | URL | Request) => {
  const path = new URL(String(input)).pathname;
  const data =
    path === '/v1/invoices'
      ? [
          {
            id: 'in_1',
            number: 'SEK-1',
            currency: 'eur',
            total: 50_000,
            total_excluding_tax: 50_000,
            amount_paid: 50_000,
            customer_name: 'Acme',
            customer_email: null,
            created: Date.UTC(2026, 5, 1) / 1000,
            charge: null,
          },
        ]
      : [];
  return Response.json({ data, has_more: false });
}) as typeof fetch;

/** The parts of API answers the assertions read. */
interface Body {
  active: string;
  company: { id: string };
  companies: { id: string; name: string; data: { externalRevenues: unknown[] } }[];
  clients: { id: string; name: string }[];
  format: string;
}

/**
 * Reads a JSON answer
 *
 * @param response {Response | Promise<Response>} - API answer
 * @returns {Promise<Body>} - parsed body
 */
const json = async (response: Response | Promise<Response>): Promise<Body> =>
  (await response).json() as Promise<Body>;

describe.skipIf(!url)('companies (database)', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  const cookie: Record<'a' | 'b', string> = { a: '', b: '' };
  const ids: Record<'a' | 'b', string> = { a: '', b: '' };

  /**
   * Calls the API as one of the two people
   *
   * @param who {'a' | 'b'} - person
   * @param path {string} - API path
   * @param init {{ method?: string; body?: unknown; company?: string }} - method, JSON body, active company
   * @returns {Promise<Response>} - the response
   */
  const call = (
    who: 'a' | 'b',
    path: string,
    init: { method?: string; body?: unknown; company?: string } = {},
  ) =>
    app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        cookie: `almanach_session=${cookie[who]}${init.company ? `; almanach_company=${init.company}` : ''}`,
        'content-type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  beforeAll(async () => {
    db = createDatabase(url as string);
    await runMigrations(db);
    await db.insert(instance).values({
      id: 1,
      name: 'Test',
      publicUrl: 'http://localhost',
      timezone: 'Europe/Paris',
      defaultLocale: 'fr',
      stripeSync: true,
    });
    const config = {
      ...loadConfig({ DATABASE_URL: url }),
      cookieSecure: false,
      secretsKey: Buffer.alloc(32, 1),
    };
    const sessions = new SessionStore(db);
    for (const who of ['a', 'b'] as const) {
      const [row] = await db
        .insert(users)
        .values({ email: `${who}@example.test`, passwordHash: 'x', role: 'member', locale: 'fr' })
        .returning({ id: users.id });
      ids[who] = row?.id ?? '';
      cookie[who] = await sessions.create(ids[who], { ip: null, userAgent: null });
    }
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
      stripe: new StripeSync(db, config.secretsKey, stripeFetch),
      federation: new Federation(db, planning, config.secretsKey),
    });
  });

  afterAll(async () => {
    await db?.$client.close();
  });

  test('each person only ever sees their own companies and the active one', async () => {
    const first = await json(call('a', '/api/companies'));
    expect(first.companies).toHaveLength(1);
    expect(first.active).toBe(ids.a);
    const created = await call('a', '/api/companies', { method: 'POST', body: { name: 'SASU' } });
    expect(created.status).toBe(201);
    const second = (await json(created)).company.id;
    const activate = (who: 'a' | 'b', id: string) =>
      call(who, '/api/companies/active', { method: 'PUT', body: { id } });
    expect((await activate('a', second)).headers.get('set-cookie')).toContain(`almanach_company=${second}`);
    expect((await activate('b', second)).status).toBe(404);

    await db.insert(clients).values({
      companyId: ids.a,
      kind: 'company',
      name: 'Client of the micro',
      country: 'FR',
      currency: 'EUR',
      language: 'fr',
      paymentTermsDays: 30,
      contacts: [],
    });
    const list = async (who: 'a' | 'b', company?: string) =>
      (
        (await json(call(who, '/api/clients', { company }))).clients as {
          id: string;
          name: string;
        }[]
      ).map((row) => row.name);
    expect(await list('a', ids.a)).toEqual(['Client of the micro']);
    expect(await list('a', second)).toEqual([]);
    // Naming someone else's company falls back to one's own.
    expect(await list('b', ids.a)).toEqual([]);
    const [client] = await db.select({ id: clients.id }).from(clients);
    expect((await call('b', `/api/clients/${client?.id}`, { company: ids.a })).status).toBe(404);
    expect((await call('a', `/api/clients/${client?.id}`, { company: second })).status).toBe(404);
    const rename = await call('b', `/api/companies/${ids.a}`, { method: 'PATCH', body: { name: 'Mine' } });
    expect(rename.status).toBe(404);
    const theirs = await json(call('b', '/api/companies'));
    expect(theirs.companies.map((row: { id: string }) => row.id)).toEqual([ids.b]);
  });

  test('Stripe receipts land in the active company only, once', async () => {
    await db.insert(profiles).values({
      companyId: ids.a,
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
    const off = await call('a', '/api/settings/stripe/sync', { method: 'POST', company: ids.a });
    expect(off.status).toBe(409);
    const saved = await call('a', '/api/settings/stripe', {
      method: 'PUT',
      company: ids.a,
      body: { key: 'rk_live_abcdefghijklmnop', enabled: true },
    });
    expect(saved.status).toBe(204);
    const sync = () => call('a', '/api/settings/stripe/sync', { method: 'POST', company: ids.a });
    expect(await (await sync()).json()).toEqual({ imported: 1 } as never);
    expect(await (await sync()).json()).toEqual({ imported: 0 } as never);
    const status = await json(call('a', '/api/settings/stripe', { company: ids.a }));
    expect(status).toMatchObject({ keySet: true, enabled: true, imported: 1, error: null });
    expect(JSON.stringify(status)).not.toContain('rk_live');

    const planning = new PlanningService(db, await PackRegistry.load());
    const own = await planning.receipts(ids.a, 'EUR', '2026-01-01', '2026-12-31');
    expect(own.receipts).toEqual([{ date: '2026-06-01', cents: 50_000 }]);
    expect((await planning.receipts(ids.b, 'EUR', '2026-01-01', '2026-12-31')).receipts).toEqual([]);
    const other = await json(call('b', '/api/settings/stripe', { company: ids.a }));
    expect(other).toMatchObject({ keySet: false, imported: 0 });
  });

  test('the export carries every company and never the Stripe key', async () => {
    const file = await json(call('a', '/api/account/export'));
    expect(file.format).toBe('almanach-export/2');
    expect(file.companies.map((row: { name: string }) => row.name)).toEqual(['a', 'SASU']);
    expect(file.companies[0]?.data.externalRevenues).toHaveLength(1);
    expect(JSON.stringify(file)).not.toContain('stripeKey');
  });
});
