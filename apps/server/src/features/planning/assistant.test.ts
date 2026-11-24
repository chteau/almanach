import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createApp } from '../../app.ts';
import { loadConfig } from '../../config.ts';
import { createDatabase, type Database, runMigrations } from '../../db/client.ts';
import { clients, companies, instance, profiles, users } from '../../db/schema.ts';
import { SessionStore } from '../auth/sessions.ts';
import { DocumentService } from '../documents/documents.service.ts';
import { Federation } from '../federation/federation.ts';
import { DrizzleInstallRepository } from '../install/install.repository.ts';
import { InstallService } from '../install/install.service.ts';
import { InstallTokenStore } from '../install/install-token.ts';
import { PackRegistry } from '../packs/packs.ts';
import { PackUpdates } from '../packs/updates.ts';
import { isoWeek } from '../review/review.ts';
import { StripeSync } from '../stripe/stripe.ts';
import { ReleaseCheck } from '../system/system.ts';
import { instanceToday } from './planning.routes.ts';
import { PlanningService } from './planning.service.ts';
import { ReminderJob } from './reminders.ts';

// Database tests of the administrative assistant: TEST_DATABASE_URL=postgres://… bun test assistant
const url = process.env.TEST_DATABASE_URL;

// biome-ignore lint/suspicious/noExplicitAny: test answers are checked field by field.
type Body = any;

describe.skipIf(!url)('administrative assistant (database)', () => {
  const name = `almanach_assistant_${process.pid}`;
  let admin: SQL;
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let today = '';
  const people = { a: { cookie: '', company: '', client: '' }, b: { cookie: '', company: '', client: '' } };

  const call = (who: 'a' | 'b', path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(path, {
      method: init.method ?? 'GET',
      headers: { cookie: `almanach_session=${people[who].cookie}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  const json = async (who: 'a' | 'b', path: string, init: { method?: string; body?: unknown } = {}) =>
    (await (await call(who, path, init)).json()) as Body;

  /**
   * Calls one MCP tool with a fresh token of a scope
   *
   * @param who {'a' | 'b'} - account
   * @param scope {string} - token scope
   * @param tool {string} - tool name
   * @param args {Record<string, unknown>} - arguments
   * @returns {Promise<{ error: boolean; value: Body }>} - the tool result
   */
  const mcp = async (who: 'a' | 'b', scope: string, tool: string, args: Record<string, unknown> = {}) => {
    const { token } = await json(who, '/api/settings/tokens', {
      method: 'POST',
      body: { name: 'AI', scope },
    });
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }),
    });
    const body = (await response.json()) as Body;
    if (body.error) return { error: true, value: body.error };
    return { error: body.result.isError as boolean, value: JSON.parse(body.result.content[0].text) };
  };

  /**
   * Creates and issues an invoice of one line, then records its payment today
   *
   * @param who {'a' | 'b'} - account
   * @param cents {number} - amount before tax
   * @returns {Promise<Body>} - the payment answer, with reserveShareCents
   */
  const paidInvoice = async (who: 'a' | 'b', cents: number) => {
    const created = await json(who, '/api/documents', {
      method: 'POST',
      body: {
        type: 'invoice',
        clientId: people[who].client,
        missionId: null,
        issueDate: today,
        validUntil: null,
        depositIds: [],
        language: 'fr',
        currency: 'EUR',
        lines: [{ description: 'Dev', quantity: 1000, unit: 'day', unitPriceCents: cents, discountBp: 0 }],
        discountBp: 0,
      },
    });
    const issued = await call(who, `/api/documents/${created.id}/issue`, { method: 'POST' });
    expect(issued.status).toBe(204);
    return json(who, `/api/documents/${created.id}/payments`, {
      method: 'POST',
      body: {
        date: today,
        amountCents: cents,
        receivedCents: null,
        feesCents: 0,
        method: 'transfer',
        reference: '',
        activityId: null,
      },
    });
  };

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
      mcp: true,
    });
    today = await instanceToday(db);
    const sessions = new SessionStore(db);
    for (const who of ['a', 'b'] as const) {
      const [user] = await db
        .insert(users)
        .values({ email: `${who}@example.test`, passwordHash: 'x', role: 'admin', locale: 'fr' })
        .returning({ id: users.id });
      const id = user?.id ?? '';
      await db.insert(companies).values({ id, userId: id, name: `Studio ${who}` });
      await db.insert(profiles).values({
        companyId: id,
        country: 'FR',
        status: 'micro_bnc',
        activityStart: '2020-01-01',
        declarationPeriod: 'monthly',
        options: [],
        identifiers: { siret: '73282932000074' },
        currency: 'EUR',
        bank: { iban: null, bic: null } as never,
        company: {
          name: `Studio ${who}`,
          address: '1 rue de Paris\n75001 Paris',
          email: `${who}@example.test`,
          phone: null,
          website: null,
        },
      });
      const [client] = await db
        .insert(clients)
        .values({
          companyId: id,
          kind: 'company',
          name: `Client of ${who}`,
          country: 'FR',
          currency: 'EUR',
          language: 'fr',
          paymentTermsDays: 30,
          contacts: [],
          address: '2 rue de Lyon\n69001 Lyon',
        })
        .returning({ id: clients.id });
      people[who] = {
        cookie: await sessions.create(id, { ip: null, userAgent: null }),
        company: id,
        client: client?.id ?? '',
      };
    }
    const config = { ...loadConfig({ DATABASE_URL: target.toString() }), cookieSecure: false };
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
      stripe: new StripeSync(db, undefined),
      federation: new Federation(db, planning, undefined),
    });
  });

  afterAll(async () => {
    await db?.$client.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.close();
  });

  test('reserve: a payment brings its share, settings change it, other accounts see nothing of it', async () => {
    const empty = (await json('a', '/api/reserve')).reserve;
    expect(empty).toMatchObject({
      currency: 'EUR',
      reserveCents: 0,
      marginBp: 1000,
      maturity: 'experimental',
    });
    // 10 000 € BNC: contributions 25.6 % = 2 560 €, CFP 0.2 % = 20 €, income tax on 6 600 € taxable = 0 €.
    // (2 560 + 20) × 1.10 = 2 838 €.
    const payment = await paidInvoice('a', 1_000_000);
    expect(payment.reserveShareCents).toBe(283_800);
    const reserve = (await json('a', '/api/reserve')).reserve;
    expect(reserve.reserveCents).toBe(283_800);
    expect(reserve.components.map((item: Body) => [item.id, item.estimatedCents])).toEqual([
      ['contributions_bnc', 256_000],
      ['cfp_liberal', 2_000],
      ['income_tax_bareme', 0],
    ]);
    expect((await json('b', '/api/reserve')).reserve.reserveCents).toBe(0);

    const settings = {
      marginBp: 0,
      extraRateBp: 100,
      extraMonthlyCents: 0,
      extraNote: 'Mutuelle',
      taxPartsQuarters: 4,
      jointTaxation: false,
    };
    expect((await call('a', '/api/reserve/settings', { method: 'PUT', body: settings })).status).toBe(204);
    // No margin, 1 % of 10 000 € as personal extra.
    expect((await json('a', '/api/reserve')).reserve.reserveCents).toBe(258_000 + 10_000);
    const refused = await call('a', '/api/reserve/settings', {
      method: 'PUT',
      body: { ...settings, jointTaxation: true },
    });
    expect(refused.status).toBe(422);

    const dashboard = await json('a', '/api/dashboard');
    expect(dashboard.reserve.reserveCents).toBe(268_000);
    const tool = await mcp('a', 'read', 'get_reserve');
    expect(tool.value.reserve.reserveCents).toBe(268_000);
  });

  test('prepared declaration: figures of the month, declared figures checked, notice saved, MCP', async () => {
    const key = `urssaf_monthly:${today.slice(0, 8)}01`;
    const { deadline } = await json('a', `/api/deadlines/${key}`);
    expect(deadline.prepared.lines.map((line: Body) => [line.id, line.cents])).toEqual([
      ['ca_bnc', 1_000_000],
    ]);
    expect(deadline.prepared.amount).toMatchObject({ method: 'estimates', cents: 256_000 });
    const mark = { doneOn: today, note: '', actualCents: 256_000 };
    expect(
      (
        await call('a', `/api/deadlines/${key}/mark`, {
          method: 'PUT',
          body: { ...mark, declared: { other: 1 } },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call('a', `/api/deadlines/${key}/mark`, {
          method: 'PUT',
          body: { ...mark, declared: { ca_bnc: 1_000_000 } },
        })
      ).status,
    ).toBe(204);
    expect((await json('a', `/api/deadlines/${key}`)).deadline.mark.declared).toEqual({ ca_bnc: 1_000_000 });
    const notice = {
      perOccurrenceCents: 10_000,
      priorYearTaxCents: null,
      priorYearIncomeCents: null,
      method: null,
      note: '',
    };
    expect(
      (await call('a', '/api/deadline-notices/urssaf_monthly/2026', { method: 'PUT', body: notice })).status,
    ).toBe(204);
    expect(
      (
        await call('a', '/api/deadline-notices/urssaf_monthly/2026', {
          method: 'PUT',
          body: { ...notice, method: 'x' },
        })
      ).status,
    ).toBe(422);
    expect((await json('b', '/api/deadlines/next-prepared')).deadline.prepared).toBeDefined();
    const tool = await mcp('a', 'read', 'prepare_declaration', { key });
    expect(tool.value.deadline.prepared.lines[0].cents).toBe(1_000_000);
  });

  test('weekly review: ISO week, stable sections, actions sorted, every company through MCP', async () => {
    expect(isoWeek('2026-11-24')).toEqual({ start: '2026-11-23', end: '2026-11-29' });
    expect(isoWeek('2026-11-29')).toEqual({ start: '2026-11-23', end: '2026-11-29' });
    expect(isoWeek('2027-01-01')).toEqual({ start: '2026-12-28', end: '2027-01-03' });
    expect((await call('a', '/api/review/weekly?date=2026-13-45')).status).toBe(422);
    const { review } = await json('a', '/api/review/weekly');
    expect(Object.keys(review).sort()).toEqual(
      [
        'actions',
        'cash',
        'company',
        'currency',
        'deadlines',
        'format',
        'notices',
        'quotes',
        'reserve',
        'testDataExcluded',
        'thresholds',
        'week',
      ].sort(),
    );
    expect(review).toMatchObject({
      format: 'weeklyReview/1',
      company: { id: people.a.company },
      testDataExcluded: true,
    });
    expect(review.week.start <= today && today <= review.week.end).toBe(true);
    expect(review.cash.collectedThisWeekCents).toBe(1_000_000);
    expect(review.reserve.deltaThisWeekCents).toBe(review.reserve.reserveCents);
    const dues = review.actions.map((action: Body) => action.due ?? '9999');
    expect(dues).toEqual([...dues].sort());
    // The month marked done in the previous test is not an action any more.
    expect(
      review.actions.some((action: Body) => action.id === `deadline:urssaf_monthly:${today.slice(0, 8)}01`),
    ).toBe(false);
    const all = await mcp('a', 'read', 'weekly_review', { allCompanies: true });
    expect(all.value.map((item: Body) => item.company.id)).toEqual([people.a.company]);
    expect((await mcp('b', 'read', 'weekly_review')).value.cash.collectedThisWeekCents).toBe(0);
  });
});
