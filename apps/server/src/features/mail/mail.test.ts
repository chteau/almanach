import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { Hono } from 'hono';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { Config } from '../../config.ts';
import { createDatabase, type Database, runMigrations } from '../../db/client.ts';
import { mailSettings, users } from '../../db/schema.ts';
import type { AppEnv } from '../../http/request.ts';
import { decryptSecret } from '../../security/secrets.ts';
import { mailRoutes } from './mail.routes.ts';
import { Mailer, mailError, type TransportFactory } from './mailer.ts';
import { MS_AUTHORITY, MS_SCOPE, xoauth2Token } from './outlook.ts';
import { checkEndpoint, type MailSettingsInput } from './providers.ts';

// Database tests run against an empty PostgreSQL server: TEST_DATABASE_URL=postgres://… bun test mail
const url = process.env.TEST_DATABASE_URL;
const secretsKey = Buffer.alloc(32, 9);
const CLIENT_ID = '00000000-0000-0000-0000-000000000000';
type MailConfig = Pick<Config, 'smtpUrl' | 'smtpFrom' | 'secretsKey' | 'msOAuthClientId'>;
const baseConfig: MailConfig = {
  smtpUrl: undefined,
  smtpFrom: undefined,
  secretsKey,
  msOAuthClientId: CLIENT_ID,
};

/**
 * This function builds an in-memory stand-in for the few queries the mail service and its routes run
 *
 * @returns {{ db: Database; state: { row: Record<string, unknown> | null; audit: unknown[] } }} - database and state
 */
function fakeDb(): { db: Database; state: { row: Record<string, unknown> | null; audit: unknown[] } } {
  const state: { row: Record<string, unknown> | null; audit: unknown[] } = { row: null, audit: [] };
  const db = {
    select: () => ({ from: () => ({ limit: async () => (state.row ? [state.row] : []) }) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) =>
        table === mailSettings
          ? {
              onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
                state.row = state.row ? { ...state.row, ...set } : { ...values };
              },
            }
          : Promise.resolve(void state.audit.push(values)),
    }),
    update: () => ({
      set: async (values: Record<string, unknown>) => {
        state.row = { ...state.row, ...values };
      },
    }),
    delete: async () => {
      state.row = null;
    },
  } as unknown as Database;
  return { db, state };
}

/**
 * This function records the transporter options and messages instead of connecting
 *
 * @param fail {unknown} - error thrown by sendMail, if any
 * @returns {{ transport: TransportFactory; options: (string | SMTPTransport.Options)[]; sent: unknown[] }} - factory and records
 */
function fakeTransport(fail?: unknown): {
  transport: TransportFactory;
  options: (string | SMTPTransport.Options)[];
  sent: unknown[];
} {
  const options: (string | SMTPTransport.Options)[] = [];
  const sent: unknown[] = [];
  const transport = ((value: string | SMTPTransport.Options) => {
    options.push(value);
    return {
      sendMail: async (mail: unknown) => {
        if (fail) throw fail;
        sent.push(mail);
        return {};
      },
    };
  }) as unknown as TransportFactory;
  return { transport, options, sent };
}

/**
 * This function answers Microsoft requests from a queue of JSON replies and records the forms sent
 *
 * @param replies {{ status: number; body: unknown }[]} - replies, in order
 * @returns {{ fetch: typeof fetch; calls: { url: string; form: URLSearchParams }[] }} - fetch and calls
 */
function fakeMicrosoft(replies: { status: number; body: unknown }[]): {
  fetch: typeof fetch;
  calls: { url: string; form: URLSearchParams }[];
} {
  const calls: { url: string; form: URLSearchParams }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), form: new URLSearchParams(String(init?.body)) });
    const reply = replies.shift() ?? { status: 500, body: {} };
    return Response.json(reply.body, { status: reply.status });
  }) as typeof fetch;
  return { fetch: fetcher, calls };
}

const gmail: MailSettingsInput = {
  provider: 'gmail',
  host: 'smtp.gmail.com',
  port: 465,
  security: 'tls',
  username: 'me@gmail.com',
  from: 'Almanach <me@gmail.com>',
  password: 'abcd efgh ijkl mnop',
};

describe('providers', () => {
  test('port 25 is always refused, 465 and 587 follow their security, the Bridge stays on loopback', () => {
    expect(checkEndpoint({ ...gmail, port: 25 })).toEqual({ error: 'port_not_allowed' });
    expect(
      checkEndpoint({ provider: 'proton_bridge', host: '127.0.0.1', port: 25, security: 'starttls' }),
    ).toEqual({
      error: 'port_not_allowed',
    });
    expect(checkEndpoint(gmail)).toBeNull();
    expect(checkEndpoint({ ...gmail, port: 587, security: 'starttls' })).toBeNull();
    expect(checkEndpoint({ ...gmail, port: 587, security: 'tls' })).toEqual({
      field: 'security',
      message: 'security_mismatch',
    });
    expect(checkEndpoint({ ...gmail, port: 2525 })).toEqual({ error: 'port_not_allowed' });
    expect(checkEndpoint({ ...gmail, host: 'evil.example' })).toEqual({
      field: 'host',
      message: 'preset_host',
    });
    expect(
      checkEndpoint({ provider: 'icloud', host: 'smtp.mail.me.com', port: 465, security: 'tls' }),
    ).toEqual({
      error: 'port_not_allowed',
    });
    expect(
      checkEndpoint({ provider: 'other', host: 'mail.example.com', port: 587, security: 'starttls' }),
    ).toBeNull();
    expect(
      checkEndpoint({ provider: 'other', host: 'mail.example.com', port: 2525, security: 'tls' }),
    ).toEqual({
      error: 'port_not_allowed',
    });
    expect(
      checkEndpoint({ provider: 'proton_bridge', host: '127.0.0.1', port: 1025, security: 'starttls' }),
    ).toBeNull();
    expect(checkEndpoint({ provider: 'proton_bridge', host: '::1', port: 1143, security: 'tls' })).toBeNull();
    expect(
      checkEndpoint({ provider: 'proton_bridge', host: '10.0.0.2', port: 1025, security: 'starttls' }),
    ).toEqual({
      field: 'host',
      message: 'loopback_required',
    });
  });

  test('builds the XOAUTH2 initial response', () => {
    const token = xoauth2Token('me@outlook.com', 'EwBAA');
    expect(Buffer.from(token, 'base64').toString()).toBe('user=me@outlook.com\x01auth=Bearer EwBAA\x01\x01');
    expect(token).toBe(
      Buffer.from('user=me@outlook.com\u0001auth=Bearer EwBAA\u0001\u0001').toString('base64'),
    );
  });

  test('maps server errors to codes without leaking credentials', () => {
    const code = (error: unknown) => mailError(error).code;
    expect(
      code(
        Object.assign(new Error('Invalid login: 535 5.7.8 rejected'), { code: 'EAUTH', responseCode: 535 }),
      ),
    ).toBe('auth_failed');
    expect(code(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:465'), { code: 'ESOCKET' }))).toBe(
      'connection_failed',
    );
    expect(code(Object.assign(new Error('getaddrinfo ENOTFOUND smtp.nowhere'), { code: 'EDNS' }))).toBe(
      'connection_failed',
    );
    expect(code(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }))).toBe('timeout');
    expect(code(Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' }))).toBe('timeout');
    expect(code(Object.assign(new Error('ssl3_get_record:wrong version number'), { code: 'ESOCKET' }))).toBe(
      'tls_failed',
    );
    expect(code(Object.assign(new Error('Error initiating TLS'), { code: 'ETLS' }))).toBe('tls_failed');
    expect(code(new Error('something else'))).toBe('failed');
    expect(mailError(new Error('smtps://me:secret@host failed')).detail).toBe('smtps://***@host failed');
  });
});

describe('mail settings', () => {
  test('the environment wins over the database, which wins over nothing', async () => {
    const { db, state } = fakeDb();
    const { transport, options, sent } = fakeTransport();
    const none = new Mailer(db, baseConfig, { transport });
    expect(await none.source()).toBe('none');
    expect(await none.test('a@example.test', 'en')).toEqual({ error: 'not_configured' });

    expect(await none.save(gmail, 'admin')).toBeNull();
    expect(await none.source()).toBe('db');
    expect(state.row?.passwordEnc).not.toContain('abcd');

    const env = new Mailer(
      db,
      { ...baseConfig, smtpUrl: 'smtps://u:p@mail.example.com:465', smtpFrom: 'A <a@example.com>' },
      { transport },
    );
    const status = await env.status();
    expect(status).toMatchObject({ source: 'env', envHost: 'mail.example.com:465', secretsKey: true });
    expect(status.config).toMatchObject({ provider: 'gmail', hasPassword: true, oauthConnected: false });
    await env.send({ to: 'x@example.test', subject: 's', text: 't' });
    expect(options.at(-1)).toBe('smtps://u:p@mail.example.com:465');
    expect(sent.at(-1)).toMatchObject({ from: 'A <a@example.com>', to: 'x@example.test' });

    await none.remove();
    expect(await none.source()).toBe('none');
  });

  test('stores the password encrypted, keeps it when omitted and needs SECRETS_KEY', async () => {
    const { db, state } = fakeDb();
    const { transport, options } = fakeTransport();
    const mailer = new Mailer(db, baseConfig, { transport });
    expect(await mailer.save({ ...gmail, password: undefined }, 'admin')).toEqual({
      field: 'password',
      message: 'required',
    });
    await mailer.save(gmail, 'admin');
    const stored = String(state.row?.passwordEnc);
    expect(JSON.stringify(state.row)).not.toContain(gmail.password);
    expect(decryptSecret(stored, secretsKey)).toBe(gmail.password as string);
    await mailer.save({ ...gmail, port: 587, security: 'starttls', password: undefined }, 'admin');
    expect(state.row?.passwordEnc).toBe(stored);
    expect(await mailer.test('me@example.test', 'fr')).toEqual({ ok: true, to: 'me@example.test' });
    expect(options.at(-1)).toMatchObject({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'me@gmail.com', pass: gmail.password },
    });
    const keyless = new Mailer(fakeDb().db, { ...baseConfig, secretsKey: undefined }, { transport });
    expect(await keyless.save(gmail, 'admin')).toEqual({ error: 'secrets_key_missing' });
  });

  test('returns the mapped error of a failed send', async () => {
    const { db } = fakeDb();
    const failing = fakeTransport(Object.assign(new Error('Invalid login: 535 nope'), { code: 'EAUTH' }));
    const mailer = new Mailer(db, baseConfig, { transport: failing.transport });
    await mailer.save(gmail, 'admin');
    expect(await mailer.test('me@example.test', 'de')).toEqual({
      error: 'auth_failed',
      detail: 'Invalid login: 535 nope',
    });
  });
});

describe('Outlook device code flow', () => {
  const mailbox = { username: 'me@outlook.com', from: 'Me <me@outlook.com>' };
  const device = {
    status: 200,
    body: {
      device_code: 'DEVICE-SECRET',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://www.microsoft.com/link',
      expires_in: 900,
      interval: 5,
      message: 'To sign in, use a web browser…',
    },
  };

  test('polls until connected, keeps the device code on the server and stores the refresh token encrypted', async () => {
    let now = 1_000_000;
    const { db, state } = fakeDb();
    const microsoft = fakeMicrosoft([
      device,
      { status: 400, body: { error: 'authorization_pending' } },
      { status: 400, body: { error: 'slow_down' } },
      { status: 200, body: { access_token: 'ACCESS-1', expires_in: 3600, refresh_token: 'REFRESH-1' } },
    ]);
    const mailer = new Mailer(db, baseConfig, { fetch: microsoft.fetch, now: () => now });
    const started = await mailer.outlookStart('admin', mailbox);
    expect(started).toEqual({
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://www.microsoft.com/link',
      expiresIn: 900,
      interval: 5,
      message: 'To sign in, use a web browser…',
    });
    expect(microsoft.calls[0]?.url).toBe(`${MS_AUTHORITY}/devicecode`);
    expect(Object.fromEntries(microsoft.calls[0]?.form ?? [])).toEqual({
      client_id: CLIENT_ID,
      scope: MS_SCOPE,
    });

    expect(await mailer.outlookPoll('admin')).toEqual({ status: 'pending' });
    expect(await mailer.outlookPoll('admin')).toEqual({ status: 'pending' });
    expect(microsoft.calls).toHaveLength(2);
    now += 5_000;
    expect(await mailer.outlookPoll('admin')).toEqual({ status: 'pending' });
    now += 5_000;
    expect(await mailer.outlookPoll('admin')).toEqual({ status: 'connected' });
    expect(Object.fromEntries(microsoft.calls[3]?.form ?? [])).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: CLIENT_ID,
      device_code: 'DEVICE-SECRET',
    });
    expect(state.row).toMatchObject({
      provider: 'outlook',
      host: 'smtp-mail.outlook.com',
      port: 587,
      security: 'starttls',
      username: 'me@outlook.com',
      passwordEnc: null,
    });
    expect(JSON.stringify(state.row)).not.toContain('REFRESH-1');
    expect(decryptSecret(String(state.row?.oauthRefreshEnc), secretsKey)).toBe('REFRESH-1');
    expect((await mailer.status()).config?.oauthConnected).toBe(true);
    expect(await mailer.outlookPoll('admin')).toEqual({ status: 'expired' });
  });

  test('reports a declined or expired sign-in, and refuses without a client ID', async () => {
    let now = 0;
    const microsoft = fakeMicrosoft([
      device,
      { status: 400, body: { error: 'authorization_declined' } },
      device,
      { status: 400, body: { error: 'expired_token' } },
      device,
    ]);
    const mailer = new Mailer(fakeDb().db, baseConfig, { fetch: microsoft.fetch, now: () => now });
    await mailer.outlookStart('admin', mailbox);
    expect(await mailer.outlookPoll('admin')).toEqual({ status: 'declined' });
    await mailer.outlookStart('admin', mailbox);
    expect(await mailer.outlookPoll('admin')).toEqual({ status: 'expired' });
    await mailer.outlookStart('admin', mailbox);
    now += 901_000;
    expect(await mailer.outlookPoll('admin')).toEqual({ status: 'expired' });
    expect(await mailer.outlookPoll('other')).toEqual({ status: 'expired' });
    const unavailable = new Mailer(fakeDb().db, { ...baseConfig, msOAuthClientId: undefined });
    expect(await unavailable.outlookStart('admin', mailbox)).toEqual({ error: 'outlook_unavailable' });
  });

  test('refreshes the access token, stores the rotated refresh token encrypted and signs in with XOAUTH2', async () => {
    let now = 0;
    const { db, state } = fakeDb();
    const microsoft = fakeMicrosoft([
      device,
      { status: 200, body: { access_token: 'ACCESS-1', expires_in: 3600, refresh_token: 'REFRESH-1' } },
      { status: 200, body: { access_token: 'ACCESS-2', expires_in: 3600, refresh_token: 'REFRESH-2' } },
      { status: 400, body: { error: 'invalid_grant' } },
    ]);
    const { transport, options } = fakeTransport();
    const mailer = new Mailer(db, baseConfig, { fetch: microsoft.fetch, transport, now: () => now });
    await mailer.outlookStart('admin', mailbox);
    await mailer.outlookPoll('admin');

    await mailer.send({ to: 'x@example.test', subject: 's', text: 't' });
    expect(microsoft.calls).toHaveLength(2);
    now += 3_550_000;
    await mailer.send({ to: 'x@example.test', subject: 's', text: 't' });
    expect(Object.fromEntries(microsoft.calls[2]?.form ?? [])).toEqual({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: 'REFRESH-1',
      scope: MS_SCOPE,
    });
    expect(decryptSecret(String(state.row?.oauthRefreshEnc), secretsKey)).toBe('REFRESH-2');
    expect(JSON.stringify(state.row)).not.toContain('REFRESH-2');

    const last = options.at(-1) as SMTPTransport.Options;
    expect(last).toMatchObject({
      host: 'smtp-mail.outlook.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { type: 'custom', method: 'XOAUTH2', user: 'me@outlook.com' },
    });
    const commands: string[] = [];
    await last.customAuth?.XOAUTH2?.({
      sendCommand: async (command: string) => {
        commands.push(command);
        return { command, response: '235 OK', status: 235, text: 'OK' };
      },
    } as never);
    expect(commands).toEqual([`AUTH XOAUTH2 ${xoauth2Token('me@outlook.com', 'ACCESS-2')}`]);

    now += 4_000_000;
    expect(await mailer.test('x@example.test', 'en')).toEqual({
      error: 'oauth_failed',
      detail: 'invalid_grant',
    });
  });
});

describe('routes', () => {
  /**
   * This function mounts the routes behind a stand-in session
   *
   * @param role {'admin' | 'member'} - role of the signed-in person
   * @returns {{ app: Hono<AppEnv>; state: { row: Record<string, unknown> | null; audit: unknown[] } }} - app and state
   */
  function mount(role: 'admin' | 'member') {
    const { db, state } = fakeDb();
    const app = new Hono<AppEnv>();
    app.use(async (c, next) => {
      c.set('user', { id: `${role}-id`, email: `${role}@example.test`, role, locale: 'fr' });
      await next();
    });
    app.route('/', mailRoutes(db, new Mailer(db, baseConfig, { transport: fakeTransport().transport })));
    return { app, state };
  }
  const send = (app: Hono<AppEnv>, method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  test('members read the settings, only administrators change them', async () => {
    const { app } = mount('member');
    const read = await send(app, 'GET', '/');
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({
      source: 'none',
      envHost: null,
      outlookAvailable: true,
      secretsKey: true,
      config: null,
    });
    for (const [method, path, body] of [
      ['PUT', '/', gmail],
      ['DELETE', '/', undefined],
      ['POST', '/test', {}],
      ['POST', '/outlook/start', { username: 'a@outlook.com', from: 'a@outlook.com' }],
      ['POST', '/outlook/poll', undefined],
    ] as const) {
      const response = await send(app, method, path, body);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'forbidden' });
    }
  });

  test('administrators save, test and delete; bad bodies and ports are refused', async () => {
    const { app, state } = mount('admin');
    const saved = await send(app, 'PUT', '/', gmail);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      source: 'db',
      config: { provider: 'gmail', from: 'Almanach <me@gmail.com>', hasPassword: true },
    });
    expect(state.audit).toHaveLength(1);
    expect((await send(app, 'PUT', '/', { ...gmail, port: 25 })).status).toBe(422);
    expect(await (await send(app, 'PUT', '/', { ...gmail, port: 25 })).json()).toEqual({
      error: 'port_not_allowed',
    });
    expect((await send(app, 'PUT', '/', { ...gmail, extra: true })).status).toBe(422);
    expect((await send(app, 'PUT', '/', { ...gmail, from: 'x\r\nBcc: y@z.test' })).status).toBe(422);
    expect(await (await send(app, 'POST', '/test', {})).json()).toEqual({
      ok: true,
      to: 'admin@example.test',
    });
    expect(await (await send(app, 'DELETE', '/')).json()).toEqual({ ok: true });
    const empty = await send(app, 'POST', '/test', {});
    expect(empty.status).toBe(409);
    expect(await empty.json()).toEqual({ error: 'not_configured' });
  });
});

describe.skipIf(!url)('mail settings (database)', () => {
  const name = `almanach_mail_${process.pid}`;
  let admin: SQL;
  let db: Database;

  beforeAll(async () => {
    admin = new SQL(url as string);
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const target = new URL(url as string);
    target.pathname = `/${name}`;
    db = createDatabase(target.toString());
    await runMigrations(db);
  });

  afterAll(async () => {
    await db?.$client.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.close();
  });

  test('round-trips the stored secret without plaintext in the row', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: 'admin@example.test', passwordHash: 'x', role: 'admin', locale: 'fr' })
      .returning({ id: users.id });
    const { transport, options } = fakeTransport();
    const mailer = new Mailer(db, baseConfig, { transport });
    expect(await mailer.save(gmail, user?.id ?? '')).toBeNull();
    const [row] = await db.select().from(mailSettings);
    expect(row).toMatchObject({
      id: 1,
      provider: 'gmail',
      fromAddress: 'Almanach <me@gmail.com>',
      updatedBy: user?.id,
    });
    expect(JSON.stringify(row)).not.toContain(gmail.password);
    expect(decryptSecret(row?.passwordEnc ?? '', secretsKey)).toBe(gmail.password as string);
    expect(await new Mailer(db, baseConfig, { transport }).test('admin@example.test', 'fr')).toMatchObject({
      ok: true,
    });
    expect(options.at(-1)).toMatchObject({ auth: { pass: gmail.password } });
    await mailer.save({ ...gmail, provider: 'other', host: 'mail.example.com' }, user?.id ?? '');
    expect(await db.select().from(mailSettings)).toHaveLength(1);
    await mailer.remove();
    expect(await db.select().from(mailSettings)).toHaveLength(0);
  });
});
