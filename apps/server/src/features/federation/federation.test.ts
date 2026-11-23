import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { loadConfig } from '../../config.ts';
import { createDatabase, type Database, runMigrations } from '../../db/client.ts';
import {
  clients,
  companies,
  documents,
  externalDocuments,
  externalRevenues,
  externalSources,
  federationClients,
  federationDocuments,
  federationLinks,
  federationPayments,
  federationTotals,
  instance,
  numberSequences,
  payments,
  profiles,
  users,
} from '../../db/schema.ts';
import { SessionStore } from '../auth/sessions.ts';
import { DocumentService } from '../documents/documents.service.ts';
import { DrizzleInstallRepository } from '../install/install.repository.ts';
import { InstallService } from '../install/install.service.ts';
import { InstallTokenStore } from '../install/install-token.ts';
import { PackRegistry } from '../packs/packs.ts';
import { PackUpdates } from '../packs/updates.ts';
import { PlanningService } from '../planning/planning.service.ts';
import { ReminderJob } from '../planning/reminders.ts';
import { StripeSync } from '../stripe/stripe.ts';
import { ReleaseCheck } from '../system/system.ts';
import { Federation } from './federation.ts';

// Two instances, each on its own database created next to TEST_DATABASE_URL and dropped afterwards:
// TEST_DATABASE_URL=postgres://… bun test federation
const url = process.env.TEST_DATABASE_URL;
const SIDES = ['a', 'b'] as const;
type Who = (typeof SIDES)[number];

interface Side {
  db: Database;
  app: ReturnType<typeof createApp>;
  cookie: string;
  company: string;
  federation: Federation;
}

/** The parts of API answers the assertions read. */
// biome-ignore lint/suspicious/noExplicitAny: test answers are checked field by field.
type Body = any;

describe.skipIf(!url)('linked instances (two databases)', () => {
  const sides = {} as Record<Who, Side>;
  const down: Record<Who, boolean> = { a: false, b: false };
  const databases = SIDES.map((who) => `almanach_federation_${who}_${process.pid}`);
  let admin: SQL;
  let last: { side: Who; path: string; init: RequestInit; answer: string } | undefined;
  let exchanges = 0;
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()).slice(0, 7);

  /** Network between the two instances: http://a.localhost and http://b.localhost, recorded for replays. */
  const network = (async (input: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(input));
    const who = target.hostname.split('.')[0] as Who;
    if (!sides[who] || down[who]) throw new TypeError('unreachable');
    if (target.pathname.endsWith('/exchange')) exchanges += 1;
    const response = await sides[who].app.request(target.pathname, init);
    last = { side: who, path: target.pathname, init: init ?? {}, answer: await response.clone().text() };
    return response;
  }) as typeof fetch;

  /**
   * Calls the API of one instance as its owner
   *
   * @param who {Who} - instance
   * @param path {string} - API path
   * @param init {{ method?: string; body?: unknown; cookie?: string }} - method, JSON body, other session
   * @returns {Promise<Response>} - the response
   */
  const call = (who: Who, path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
    sides[who].app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        cookie: `almanach_session=${init.cookie ?? sides[who].cookie}`,
        'content-type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  /**
   * Reads a JSON answer
   *
   * @param who {Who} - instance
   * @param path {string} - API path
   * @returns {Promise<Body>} - parsed body
   */
  const get = async (who: Who, path: string): Promise<Body> => (await call(who, path)).json();

  /**
   * Creates a signed-in person with a French micro-entreprise on an instance
   *
   * @param who {Who} - instance
   * @param email {string} - login
   * @param status {string} - micro status of the activity
   * @returns {Promise<{ cookie: string; company: string }>} - session and company
   */
  const person = async (who: Who, email: string, status: string) => {
    const db = sides[who].db;
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash: 'x', role: 'admin', locale: 'fr' })
      .returning({ id: users.id });
    const id = user?.id ?? '';
    await db.insert(companies).values({ id, userId: id, name: email.split('@')[0] ?? email });
    await db.insert(profiles).values({
      companyId: id,
      country: 'FR',
      status,
      activityStart: '2025-01-01',
      declarationPeriod: 'monthly',
      options: [],
      identifiers: {},
      currency: 'EUR',
      bank: { iban: null, bic: null } as never,
      company: { name: email, address: 'Paris', email, phone: null, website: null },
    });
    return { cookie: await new SessionStore(db).create(id, { ip: null, userAgent: null }), company: id };
  };

  beforeAll(async () => {
    admin = new SQL(url as string);
    for (const [index, who] of SIDES.entries()) {
      const name = databases[index] as string;
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
      await admin.unsafe(`CREATE DATABASE ${name}`);
      const target = new URL(url as string);
      target.pathname = `/${name}`;
      const db = createDatabase(target.toString());
      await runMigrations(db);
      await db.insert(instance).values({
        id: 1,
        name: who,
        publicUrl: `http://${who}.localhost`,
        timezone: 'Europe/Paris',
        defaultLocale: 'fr',
        federation: true,
      });
      const config = {
        ...loadConfig({ DATABASE_URL: target.toString() }),
        cookieSecure: false,
        secretsKey: Buffer.alloc(32, index + 1),
      };
      const packs = await PackRegistry.load();
      const planning = new PlanningService(db, packs);
      const sessions = new SessionStore(db);
      const documents = new DocumentService(db, packs);
      const federation = new Federation(db, planning, config.secretsKey, network, false, { documents });
      const app = createApp({
        config,
        install: new InstallService(new DrizzleInstallRepository(db), new InstallTokenStore(), false),
        db,
        sessions,
        packs,
        documents,
        planning,
        reminders: new ReminderJob(db, planning, config),
        packUpdates: new PackUpdates(db, packs, [], undefined),
        releases: new ReleaseCheck(db, config.releaseCheckUrl),
        stripe: new StripeSync(db, config.secretsKey),
        federation,
      });
      sides[who] = { db, app, cookie: '', company: '', federation };
      const owner = await person(
        who,
        `${who}@example.test`,
        who === 'a' ? 'micro_bnc' : 'micro_bic_services',
      );
      sides[who] = { db, app, federation, ...owner };
      await db.insert(externalRevenues).values({
        companyId: owner.company,
        source: 'stripe',
        externalId: `in_${who}`,
        date: `${month}-01`,
        amountCents: who === 'a' ? 3_000_000 : 2_000_000,
        currency: 'EUR',
        client: 'Secret Client Corp',
        reference: 'INV-PRIVATE-42',
      });
    }
  });

  afterAll(async () => {
    for (const who of SIDES) await sides[who]?.db.$client.close();
    for (const name of databases) await admin?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.close();
  });

  test('the federation routes answer 404 while no link exists', async () => {
    expect(
      (await sides.a.app.request('/api/federation/exchange', { method: 'POST', body: '{}' })).status,
    ).toBe(404);
    expect(
      (
        await call('a', '/api/settings/federation/links', {
          method: 'POST',
          body: { url: 'http://a.localhost', share: true, receive: true },
        })
      ).status,
    ).toBe(409);
  });

  test('pairing: one-time code, fingerprints shown on both sides', async () => {
    for (const [who, label] of [
      ['a', 'Freelance'],
      ['b', 'SEKLYR'],
    ] as const) {
      const saved = await call(who, '/api/settings/federation', {
        method: 'PUT',
        body: { enabled: true, label },
      });
      expect(saved.status).toBe(204);
    }
    const issued = await call('a', '/api/settings/federation/links', {
      method: 'POST',
      body: { url: 'http://a.localhost', share: true, receive: true },
    });
    expect(issued.status).toBe(201);
    const { code, fingerprint } = (await issued.json()) as Body;
    const join = () =>
      call('b', '/api/settings/federation/links/join', {
        method: 'POST',
        body: { code, url: 'http://b.localhost', share: true, receive: true },
      });
    expect((await join()).status).toBe(201);
    const [onA] = (await get('a', '/api/settings/federation')).links;
    const [onB] = (await get('b', '/api/settings/federation')).links;
    expect(onA).toMatchObject({ state: 'active', fingerprint, peerUrl: 'http://b.localhost', pulls: false });
    expect(onB).toMatchObject({
      state: 'active',
      peerFingerprint: fingerprint,
      peerUrl: 'http://a.localhost',
      pulls: true,
    });
    expect(onA.peerFingerprint).toBe(onB.fingerprint);
    expect(JSON.stringify(onA)).not.toMatch(/privateKey|PRIVATE/);

    const reused = await join();
    expect(reused.status).toBe(409);
    expect(await reused.json()).toEqual({ error: 'code_unknown' });
  });

  test('an expired pairing code is refused', async () => {
    const issued = (await (
      await call('a', '/api/settings/federation/links', {
        method: 'POST',
        body: { url: 'http://a.localhost', share: true, receive: true },
      })
    ).json()) as Body;
    await sides.a.db
      .update(federationLinks)
      .set({ codeExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(federationLinks.state, 'pending'));
    const late = await call('b', '/api/settings/federation/links/join', {
      method: 'POST',
      body: { code: issued.code, url: 'http://b.localhost', share: true, receive: true },
    });
    expect(await late.json()).toEqual({ error: 'code_expired' });
    await sides.a.db.delete(federationLinks).where(eq(federationLinks.state, 'pending'));
  });

  test('thresholds count both activities; estimates stay local', async () => {
    for (const [who, own, other, label] of [
      ['a', 3_000_000, 2_000_000, 'SEKLYR'],
      ['b', 2_000_000, 3_000_000, 'Freelance'],
    ] as const) {
      const { outlook } = await get(who, '/api/outlook');
      const ceiling = outlook.thresholds.find((item: Body) => item.id === 'micro_ceiling_services');
      expect(ceiling).toMatchObject({ reachedCents: 5_000_000, linkedCents: other });
      // 50,000 € together: VAT is due at once although each activity alone stays in the franchise.
      expect(outlook.thresholds.find((item: Body) => item.id === 'vat_franchise_services')).toMatchObject({
        toleranceExceeded: true,
      });
      expect(outlook.linked).toEqual([{ label, cents: other, receivedAt: expect.any(String), error: null }]);
      expect(outlook.collectedCents).toBe(own);
      for (const estimate of outlook.estimates) expect(estimate.steps[0].baseCents).toBe(own);
    }
    const simulated = (await get('a', '/api/outlook?simulate=1000000')).outlook;
    expect(simulated.thresholds[0]).toMatchObject({ reachedCents: 6_000_000, linkedCents: 2_000_000 });
    const stored = await sides.b.db.select().from(federationTotals);
    expect(stored.map(({ month: m, category, cents }) => ({ m, category, cents }))).toEqual([
      { m: month, category: 'micro_bnc', cents: 3_000_000 },
    ]);
  });

  test('only monthly totals travel; unsigned, altered and replayed requests are refused', async () => {
    const [link] = (await get('b', '/api/settings/federation')).links;
    expect(
      (await call('b', `/api/settings/federation/links/${link.id}/sync`, { method: 'POST' })).status,
    ).toBe(200);
    const sent = last;
    if (!sent) throw new Error('no request recorded');
    expect(sent.path).toBe('/api/federation/exchange');
    const answer = JSON.parse(sent.answer);
    expect(Object.keys(answer)).toEqual(['totals']);
    expect(Object.keys(answer.totals).sort()).toEqual(['currency', 'label', 'months']);
    expect(answer.totals.months).toEqual([{ month, category: 'micro_bnc', cents: 3_000_000 }]);
    expect(JSON.stringify(sent.init.body) + sent.answer).not.toMatch(/Secret Client|INV-PRIVATE|in_a|in_b/);

    const replay = (init: RequestInit) =>
      sides.a.app.request('/api/federation/exchange', { method: 'POST', ...init });
    const headers = sent.init.headers as Record<string, string>;
    const replayed = await replay({ headers, body: sent.init.body });
    expect(replayed.status).toBe(401);
    expect(await replayed.json()).toEqual({ error: 'replayed' });
    const altered = await replay({
      headers,
      body: String(sent.init.body).replace('"cents":2000000', '"cents":1'),
    });
    expect(await altered.json()).toEqual({ error: 'bad_signature' });
    const unsigned = await replay({ headers: { 'content-type': 'application/json' }, body: sent.init.body });
    expect(await unsigned.json()).toEqual({ error: 'bad_signature' });
  });

  test('an unreachable peer leaves the last totals, with their date', async () => {
    const [link] = (await get('b', '/api/settings/federation')).links;
    down.a = true;
    const failed = await call('b', `/api/settings/federation/links/${link.id}/sync`, { method: 'POST' });
    down.a = false;
    expect(await failed.json()).toEqual({ error: 'peer_unreachable' });
    const { outlook } = await get('b', '/api/outlook');
    expect(outlook.linked).toEqual([
      { label: 'Freelance', cents: 3_000_000, receivedAt: link.receivedAt, error: 'peer_unreachable' },
    ]);
  });

  test('the export keeps the link settings without keys; an import leaves them to pair again', async () => {
    const file = await get('a', '/api/account/export');
    expect(file.companies[0].data.federationLinks).toEqual([
      {
        peerUrl: 'http://b.localhost',
        peerLabel: 'SEKLYR',
        share: true,
        receive: true,
        pulls: false,
        shareDetail: false,
        receiveDetail: false,
      },
    ]);
    expect(JSON.stringify(file)).not.toMatch(/BEGIN PRIVATE|privateKey|publicKey|codeHash|federationTotals/);
    const other = await person('b', 'c@example.test', 'micro_bnc');
    await sides.b.db.delete(profiles).where(eq(profiles.companyId, other.company));
    const imported = await call('b', '/api/account/import', {
      method: 'POST',
      body: file,
      cookie: other.cookie,
    });
    expect(imported.status).toBe(200);
    const [restored] = await sides.b.db
      .select()
      .from(federationLinks)
      .where(eq(federationLinks.companyId, other.company));
    expect(restored).toMatchObject({
      state: 'imported',
      publicKey: null,
      privateKey: null,
      peerPublicKey: null,
    });
    await sides.b.db.delete(companies).where(eq(companies.id, other.company));
  });

  /**
   * Sets the options of the only link of an instance
   *
   * @param who {Who} - instance
   * @param options {Record<string, boolean>} - options to change
   * @returns {Promise<void>} - resolves once saved
   */
  const options = async (who: Who, options: Record<string, boolean>) => {
    const [link] = (await get(who, '/api/settings/federation')).links;
    const { share, receive, pulls, shareDetail, receiveDetail } = link;
    const saved = await call(who, `/api/settings/federation/links/${link.id}`, {
      method: 'PATCH',
      body: { share, receive, pulls, shareDetail, receiveDetail, ...options },
    });
    expect(saved.status).toBe(204);
  };

  /**
   * Has B, the calling side, exchange with A now
   *
   * @returns {Promise<{ request: Body; answer: Body }>} - bodies of the exchange
   */
  const sync = async () => {
    const [link] = (await get('b', '/api/settings/federation')).links;
    expect(
      (await call('b', `/api/settings/federation/links/${link.id}/sync`, { method: 'POST' })).status,
    ).toBe(200);
    return { request: JSON.parse(String(last?.init.body)), answer: JSON.parse(last?.answer ?? '{}') };
  };

  test('the detail is off by default, and travels only when one side shares and the other receives', async () => {
    const year = Number(month.slice(0, 4)) - 1;
    const [client] = await sides.a.db
      .insert(clients)
      .values({
        companyId: sides.a.company,
        kind: 'company',
        name: 'Acme',
        email: 'billing@acme.test',
        country: 'FR',
        currency: 'EUR',
        language: 'fr',
        paymentTermsDays: 30,
        contacts: [],
        siret: '12345678900011',
      })
      .returning({ id: clients.id });
    const totals = {
      linesCents: 300_000,
      discountCents: 0,
      netCents: 300_000,
      vatRateBp: 0,
      vatCents: 0,
      depositsCents: 0,
      totalCents: 300_000,
    };
    const [invoice] = await sides.a.db
      .insert(documents)
      .values({
        companyId: sides.a.company,
        type: 'invoice',
        state: 'issued',
        number: 'F-0001',
        clientId: client?.id ?? '',
        issueDate: `${year}-03-01`,
        dueDate: `${year}-04-01`,
        language: 'fr',
        currency: 'EUR',
        lines: [
          { description: 'Audit', quantity: 3000, unit: 'day', unitPriceCents: 100_000, discountBp: 0 },
        ],
        discountBp: 0,
        depositIds: [],
        vatMode: 'franchise',
        mentions: [],
        totals,
      })
      .returning({ id: documents.id });
    await sides.a.db.insert(payments).values({
      companyId: sides.a.company,
      documentId: invoice?.id ?? '',
      date: `${year}-03-15`,
      amountCents: 100_000,
      feesCents: 0,
      method: 'transfer',
    });

    const [link] = (await get('a', '/api/settings/federation')).links;
    expect(link).toMatchObject({ shareDetail: false, receiveDetail: false });
    let { request, answer } = await sync();
    expect('detail' in request || 'detail' in answer || 'receiveDetail' in request).toBe(false);

    await options('a', { shareDetail: true });
    ({ answer } = await sync());
    expect('detail' in answer).toBe(false);
    expect(await sides.b.db.select().from(federationDocuments)).toEqual([]);

    await options('b', { receiveDetail: true });
    ({ request, answer } = await sync());
    expect(request.receiveDetail).toBe(true);
    expect('detail' in request).toBe(false);
    expect(answer.detail.documents).toEqual([
      expect.objectContaining({ number: 'F-0001', status: 'overdue', paidCents: 100_000, dueCents: 200_000 }),
    ]);
    const linked = await get('b', '/api/linked');
    expect(linked.sources).toEqual([
      { id: expect.any(String), label: 'Freelance', url: 'http://a.localhost', kind: 'link', test: false },
    ]);
    expect(linked.clients).toEqual([expect.objectContaining({ name: 'Acme', siret: '12345678900011' })]);
    expect(linked.payments.map((item: Body) => [item.source, item.amountCents])).toEqual([
      ['stripe', 3_000_000],
      ['payment', 100_000],
    ]);
    const dashboard = await get('b', '/api/dashboard');
    expect(dashboard.overdueInvoices).toEqual([
      expect.objectContaining({
        number: 'F-0001',
        dueCents: 200_000,
        link: { id: linked.sources[0].id, label: 'Freelance' },
      }),
    ]);
    expect(dashboard.linkedRevenue).toEqual([
      expect.objectContaining({ label: 'Freelance', month: 3_000_000 }),
    ]);

    // B shares its detail too, but A does not receive it: nothing leaves B.
    await options('b', { shareDetail: true });
    ({ request } = await sync());
    expect('detail' in request).toBe(false);
  });

  test('received records stay apart: no local numbering, receipts or documents change', async () => {
    expect(await sides.b.db.select().from(documents)).toEqual([]);
    expect(await sides.b.db.select().from(numberSequences)).toEqual([]);
    expect((await get('b', '/api/documents?type=invoice')).documents).toEqual([]);
    expect((await get('b', '/api/clients')).clients).toEqual([]);
    expect((await get('b', '/api/outlook')).outlook.collectedCents).toBe(2_000_000);
    // A local invoice may carry the same number as a linked one: the copies take no part in numbering.
    const [client] = await sides.b.db
      .insert(clients)
      .values({
        companyId: sides.b.company,
        kind: 'company',
        name: 'Local',
        country: 'FR',
        currency: 'EUR',
        language: 'fr',
        paymentTermsDays: 30,
        contacts: [],
      })
      .returning({ id: clients.id });
    const [local] = await sides.b.db
      .insert(documents)
      .values({
        companyId: sides.b.company,
        type: 'invoice',
        state: 'issued',
        number: 'F-0001',
        clientId: client?.id ?? '',
        issueDate: `${month}-01`,
        language: 'fr',
        currency: 'EUR',
        lines: [],
        discountBp: 0,
        depositIds: [],
        vatMode: 'franchise',
        mentions: [],
        totals: {
          linesCents: 0,
          discountCents: 0,
          netCents: 0,
          vatRateBp: 0,
          vatCents: 0,
          depositsCents: 0,
          totalCents: 0,
        },
      })
      .returning({ id: documents.id });
    expect((await sides.b.db.select().from(federationDocuments))[0]?.data.number).toBe('F-0001');
    await sides.b.db.delete(documents).where(eq(documents.id, local?.id ?? ''));
    await sides.b.db.delete(clients).where(eq(clients.id, client?.id ?? ''));
  });

  test('external documents and test data travel marked, and never count on the other side', async () => {
    const [source] = await sides.a.db
      .insert(externalSources)
      .values({
        companyId: sides.a.company,
        name: 'SEKLYR dev',
        url: 'https://dev.test/feed',
        token: 'x',
        test: true,
      })
      .returning({ id: externalSources.id });
    const remoteId = '6f1c2a5e-0000-5000-8000-000000000001';
    await sides.a.db.insert(externalDocuments).values({
      linkId: source?.id ?? '',
      remoteId,
      data: {
        id: remoteId,
        type: 'invoice',
        status: 'sent',
        number: 'DEV-1',
        clientId: remoteId,
        clientName: 'Prospect',
        issueDate: `${month}-02`,
        dueDate: '2020-01-01',
        validUntil: null,
        currency: 'EUR',
        netCents: 5_000,
        vatCents: 1_000,
        totalCents: 6_000,
        paidCents: 0,
        dueCents: 6_000,
        lines: null,
      },
    });
    await sides.a.db.insert(externalRevenues).values({
      companyId: sides.a.company,
      source: 'stripe',
      externalId: 'ch_test',
      date: `${month}-03`,
      amountCents: 999_999,
      currency: 'EUR',
      livemode: false,
    });
    await sync();
    const linked = await get('b', '/api/linked');
    expect(linked.documents.find((item: Body) => item.number === 'DEV-1')).toMatchObject({
      origin: 'SEKLYR dev',
      test: true,
    });
    expect(linked.payments.find((item: Body) => item.amountCents === 999_999)?.test).toBe(true);
    const dashboard = await get('b', '/api/dashboard');
    expect(dashboard.overdueInvoices.map((item: Body) => item.number)).not.toContain('DEV-1');
    expect(dashboard.linkedRevenue).toEqual([
      expect.objectContaining({ label: 'Freelance', month: 3_000_000 }),
    ]);
    await sides.a.db.delete(externalSources);
    await sides.a.db.delete(externalRevenues).where(eq(externalRevenues.externalId, 'ch_test'));
  });

  test('changes trigger one debounced exchange, and none while links are not allowed', async () => {
    const federation = sides.b.federation;
    federation.debounceMs = 20;
    const before = exchanges;
    for (let i = 0; i < 3; i += 1) federation.touch(sides.b.company);
    await Bun.sleep(200);
    expect(exchanges).toBe(before + 1);

    await sides.b.db.update(instance).set({ federation: false });
    federation.touch(sides.b.company);
    federation.refresh(sides.b.company);
    await Bun.sleep(200);
    expect(exchanges).toBe(before + 1);
    await sides.b.db.update(instance).set({ federation: true });
    federation.debounceMs = 30_000;
  });

  test('the copies go as soon as either side stops sharing the detail', async () => {
    await options('a', { shareDetail: false });
    await sync();
    for (const table of [federationClients, federationDocuments, federationPayments])
      expect(await sides.b.db.select().from(table)).toEqual([]);
    await options('a', { shareDetail: true });
    await sync();
    expect((await get('b', '/api/linked')).documents).toHaveLength(1);
    await options('b', { receiveDetail: false });
    expect(await sides.b.db.select().from(federationDocuments)).toEqual([]);
    expect((await get('b', '/api/linked')).sources).toEqual([]);
    await options('b', { receiveDetail: true });
    await sync();
    expect(await sides.b.db.select().from(federationDocuments)).toHaveLength(1);
  });

  test('revoking on one side deletes the keys and totals on both', async () => {
    const [link] = (await get('a', '/api/settings/federation')).links;
    expect((await call('a', `/api/settings/federation/links/${link.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await get('a', '/api/settings/federation')).links).toEqual([]);
    expect((await get('b', '/api/settings/federation')).links).toEqual([]);
    expect(await sides.b.db.select().from(federationTotals)).toEqual([]);
    for (const table of [federationClients, federationDocuments, federationPayments])
      expect(await sides.b.db.select().from(table)).toEqual([]);
    expect((await get('b', '/api/outlook')).outlook.linked).toEqual([]);
    expect(
      (await sides.a.app.request('/api/federation/exchange', { method: 'POST', body: '{}' })).status,
    ).toBe(404);
  });
});
