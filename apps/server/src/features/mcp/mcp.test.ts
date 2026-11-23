import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createApp } from '../../app.ts';
import { loadConfig } from '../../config.ts';
import { createDatabase, type Database, runMigrations } from '../../db/client.ts';
import { apiTokens, clients, companies, documents, instance, profiles, users } from '../../db/schema.ts';
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

// Database tests run against an empty PostgreSQL server: TEST_DATABASE_URL=postgres://… bun test mcp
const url = process.env.TEST_DATABASE_URL;

/** The parts of API answers the assertions read. */
// biome-ignore lint/suspicious/noExplicitAny: test answers are checked field by field.
type Body = any;

describe.skipIf(!url)('MCP endpoint (database)', () => {
  const name = `almanach_mcp_${process.pid}`;
  let admin: SQL;
  let db: Database;
  let app: ReturnType<typeof createApp>;
  const people = { a: { cookie: '', company: '' }, b: { cookie: '', company: '' } };

  const call = (who: 'a' | 'b', path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(path, {
      method: init.method ?? 'GET',
      headers: { cookie: `almanach_session=${people[who].cookie}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  /**
   * Sends one JSON-RPC request to /mcp with a token
   *
   * @param token {string} - personal access token
   * @param method {string} - JSON-RPC method
   * @param params {Record<string, unknown>} - parameters
   * @returns {Promise<Response>} - the response
   */
  const rpc = (token: string, method: string, params: Record<string, unknown> = {}) =>
    app.request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  const tool = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const { result } = (await (await rpc(token, 'tools/call', { name, arguments: args })).json()) as Body;
    return { error: result?.isError as boolean, value: result && JSON.parse(result.content[0].text) };
  };
  const token = async (who: 'a' | 'b', scope: string) =>
    (
      (await (
        await call(who, '/api/settings/tokens', { method: 'POST', body: { name: 'Claude', scope } })
      ).json()) as Body
    ).token as string;

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
        activityStart: '2026-01-01',
        declarationPeriod: 'monthly',
        options: [],
        identifiers: {},
        currency: 'EUR',
        bank: { iban: null, bic: null } as never,
        company: {
          name: `Studio ${who}`,
          address: 'Paris',
          email: `${who}@example.test`,
          phone: null,
          website: null,
        },
      });
      await db.insert(clients).values({
        companyId: id,
        kind: 'company',
        name: `Client of ${who}`,
        country: 'FR',
        currency: 'EUR',
        language: 'fr',
        paymentTermsDays: 30,
        contacts: [],
      });
      people[who] = { cookie: await sessions.create(id, { ip: null, userAgent: null }), company: id };
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

  test('off by default: /mcp answers 404 and no token can be created', async () => {
    expect((await rpc('alm_whatever_token_value_1234', 'ping')).status).toBe(404);
    expect(
      (await call('a', '/api/settings/tokens', { method: 'POST', body: { name: 'x', scope: 'read' } }))
        .status,
    ).toBe(409);
    expect((await call('a', '/api/system/mcp', { method: 'PUT', body: { enabled: true } })).status).toBe(204);
  });

  test('a token is shown once, stored hashed, records its last use and can be revoked', async () => {
    const created = await token('a', 'read');
    expect(created).toMatch(/^alm_/);
    const [row] = await db.select().from(apiTokens);
    expect(row?.tokenHash).not.toBe(created);
    expect(JSON.stringify(await (await call('a', '/api/settings/tokens')).json())).not.toContain(created);
    expect((await rpc('alm_wrong_token_value_123456789', 'ping')).status).toBe(401);
    expect((await app.request('/mcp', { method: 'POST', body: '{}' })).status).toBe(401);
    const init = (await (await rpc(created, 'initialize', { protocolVersion: '2025-06-18' })).json()) as Body;
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'almanach' } });
    const listed = ((await (await call('a', '/api/settings/tokens')).json()) as Body).tokens;
    expect(listed[0].lastUsedAt).not.toBeNull();
    expect((await call('b', `/api/settings/tokens/${listed[0].id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await call('a', `/api/settings/tokens/${listed[0].id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await rpc(created, 'ping')).status).toBe(401);
  });

  test('a read token reads but cannot write; nothing can issue, send or delete', async () => {
    const read = await token('a', 'read');
    const tools = ((await (await rpc(read, 'tools/list')).json()) as Body).result.tools.map(
      (item: Body) => item.name,
    );
    expect(tools).toContain('list_documents');
    expect(tools).not.toContain('create_client');
    expect(tools.some((item: string) => /issue|send|delete|settings/.test(item))).toBe(false);
    const refused = (await (
      await rpc(read, 'tools/call', { name: 'create_client', arguments: {} })
    ).json()) as Body;
    expect(refused.error.code).toBe(-32602);
    expect((await tool(read, 'search_clients')).value.map((item: Body) => item.name)).toEqual([
      'Client of a',
    ]);
    expect((await tool(read, 'get_dashboard')).error).toBe(false);
    expect((await tool(read, 'get_thresholds')).error).toBe(false);
  });

  test('a drafts token creates clients and drafts only, in its own companies', async () => {
    const drafts = await token('a', 'read_drafts');
    const client = await tool(drafts, 'create_client', {
      client: {
        kind: 'company',
        name: 'New Co',
        email: null,
        country: 'FR',
        currency: 'EUR',
        language: 'fr',
        paymentTermsDays: 30,
        contacts: [],
      },
    });
    expect(client.error).toBe(false);
    const draft = {
      type: 'invoice',
      clientId: client.value.client.id,
      missionId: null,
      issueDate: '2026-11-23',
      validUntil: null,
      depositIds: [],
      language: 'fr',
      currency: 'EUR',
      lines: [{ description: 'Dev', quantity: 1000, unit: 'day', unitPriceCents: 50_000, discountBp: 0 }],
      discountBp: 0,
    };
    const created = await tool(drafts, 'create_draft_document', { document: draft });
    expect(created).toMatchObject({ error: false });
    const rows = await db.select().from(documents);
    expect(rows.map((row) => [row.state, row.number])).toEqual([['draft', null]]);
    expect(
      (await tool(drafts, 'create_draft_document', { document: { ...draft, type: 'credit_note' } })).value
        .error,
    ).toBe('only_quote_or_invoice_drafts');
    // Another account's company is out of reach, by id or by name.
    expect((await tool(drafts, 'search_clients', { company: people.b.company })).value.error).toBe(
      'unknown_company',
    );
    expect((await tool(drafts, 'create_client', { company: 'Studio b', client: {} })).error).toBe(true);
    const otherToken = await token('b', 'read');
    expect((await tool(otherToken, 'list_documents')).value).toEqual([]);
    expect((await tool(otherToken, 'get_document', { id: rows[0]?.id })).value.error).toBe('not_found');
  });
});
