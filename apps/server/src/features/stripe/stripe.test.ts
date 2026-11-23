import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDatabase, type Database, runMigrations } from '../../db/client.ts';
import { clients, companies, externalRevenues, instance, profiles, users } from '../../db/schema.ts';
import type { AppEnv } from '../../http/request.ts';
import { encryptSecret } from '../../security/secrets.ts';
import { clientRoutes } from '../clients/clients.routes.ts';
import {
  fetchStripeCustomers,
  fetchStripeRevenues,
  STRIPE_VERSION,
  type StripeCustomer,
  StripeSync,
  toClientFields,
} from './stripe.ts';

// Database tests run against an empty PostgreSQL server: TEST_DATABASE_URL=postgres://… bun test stripe
const url = process.env.TEST_DATABASE_URL;

const PAID_AT = Date.UTC(2026, 2, 31, 23, 30) / 1000;

const pages: Record<string, unknown[]> = {
  invoices: [
    {
      id: 'in_1',
      number: 'SEK-0001',
      currency: 'eur',
      total: 1200,
      total_excluding_tax: 1000,
      amount_paid: 1200,
      customer_name: 'Acme',
      customer_email: 'billing@acme.test',
      customer: 'cus_1',
      created: PAID_AT - 86_400,
      status_transitions: { paid_at: PAID_AT },
      charge: { id: 'ch_1', amount: 1200, balance_transaction: { amount: 1200, currency: 'eur' } },
    },
    {
      id: 'in_2',
      number: 'SEK-0002',
      currency: 'usd',
      total: 2000,
      total_excluding_tax: null,
      amount_paid: 2000,
      customer_name: null,
      customer_email: 'us@example.test',
      created: PAID_AT,
      charge: { id: 'ch_2', amount: 2000, balance_transaction: { amount: 1840, currency: 'eur' } },
    },
    { id: 'in_free', currency: 'eur', total: 0, total_excluding_tax: 0, amount_paid: 0, created: PAID_AT },
  ],
  charges: [
    {
      id: 'ch_1',
      amount: 1200,
      currency: 'eur',
      paid: true,
      status: 'succeeded',
      created: PAID_AT,
      invoice: 'in_1',
      balance_transaction: null,
    },
    {
      id: 'ch_3',
      amount: 500,
      currency: 'eur',
      paid: true,
      status: 'succeeded',
      created: PAID_AT,
      invoice: null,
      billing_details: { name: 'Walk-in', email: null },
      payment_method_details: { card: { last4: '4242' } },
      balance_transaction: { amount: 500, currency: 'eur' },
    },
    {
      id: 'ch_4',
      amount: 900,
      currency: 'eur',
      paid: false,
      status: 'failed',
      created: PAID_AT,
      invoice: null,
    },
  ],
  refunds: [
    {
      id: 're_1',
      amount: 600,
      currency: 'eur',
      status: 'succeeded',
      created: PAID_AT + 86_400,
      charge: {
        id: 'ch_1',
        customer: 'cus_1',
        invoice: {
          id: 'in_1',
          number: 'SEK-0001',
          total: 1200,
          total_excluding_tax: 1000,
          customer_name: 'Acme',
        },
      },
      balance_transaction: { amount: -600, currency: 'eur' },
    },
  ],
};

/**
 * Fake Stripe API answering list calls two items per page, recording each request
 *
 * @param calls {Request[]} - receives every request
 * @returns {typeof fetch} - the fake client
 */
function fakeStripe(calls: Request[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(String(input instanceof Request ? input.url : input), init);
    calls.push(request);
    const url = new URL(request.url);
    const all = pages[url.pathname.replace('/v1/', '')] ?? [];
    const after = url.searchParams.get('starting_after');
    const start = after ? all.findIndex((item) => (item as { id: string }).id === after) + 1 : 0;
    const data = all.slice(start, start + 2);
    return Response.json({ object: 'list', data, has_more: start + 2 < all.length });
  }) as typeof fetch;
}

test('paid invoices, standalone charges and refunds become receipts, once each', async () => {
  const calls: Request[] = [];
  const rows = await fetchStripeRevenues(
    'rk_test_x',
    1_700_000_000,
    'EUR',
    'Europe/Paris',
    fakeStripe(calls),
  );
  expect(rows).toEqual([
    {
      source: 'stripe',
      externalId: 'in_1',
      date: '2026-04-01',
      amountCents: 1000,
      currency: 'EUR',
      receivedCents: null,
      client: 'Acme',
      reference: 'SEK-0001',
      customer: 'cus_1',
      // A test key: objects without `livemode` take its mode.
      livemode: false,
    },
    {
      source: 'stripe',
      externalId: 'in_2',
      date: '2026-04-01',
      amountCents: 2000,
      currency: 'USD',
      receivedCents: 1840,
      client: 'us@example.test',
      reference: 'SEK-0002',
      customer: null,
      livemode: false,
    },
    {
      source: 'stripe',
      externalId: 'ch_3',
      date: '2026-04-01',
      amountCents: 500,
      currency: 'EUR',
      receivedCents: null,
      client: 'Walk-in',
      reference: null,
      customer: null,
      livemode: false,
    },
    {
      source: 'stripe',
      externalId: 're_1',
      date: '2026-04-02',
      amountCents: -500,
      currency: 'EUR',
      receivedCents: null,
      client: 'Acme',
      reference: 'SEK-0001',
      customer: 'cus_1',
      livemode: false,
    },
  ]);
  expect(JSON.stringify(rows)).not.toContain('4242');
  const first = calls[0];
  expect(first?.headers.get('authorization')).toBe('Bearer rk_test_x');
  expect(first?.headers.get('stripe-version')).toBe(STRIPE_VERSION);
  expect(first?.method).toBe('GET');
  expect(calls.some((call) => new URL(call.url).searchParams.get('starting_after') === 'in_2')).toBe(true);
  expect(new URL(calls.at(-1)?.url ?? '').searchParams.getAll('expand[]')).toEqual([
    'data.charge.invoice',
    'data.balance_transaction',
  ]);
});

test('a refused key is reported without retrying', async () => {
  const refused = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
  await expect(fetchStripeRevenues('rk_test_x', 0, 'EUR', 'UTC', refused)).rejects.toThrow(
    'stripe_unauthorized',
  );
  const offline = (async () => {
    throw new TypeError('network');
  }) as unknown as typeof fetch;
  await expect(fetchStripeRevenues('rk_test_x', 0, 'EUR', 'UTC', offline)).rejects.toThrow(
    'stripe_unreachable',
  );
});

/**
 * Builds a Stripe customer with an address
 *
 * @param id {string} - Stripe id
 * @param name {string} - customer name
 * @param extra {Partial<StripeCustomer>} - other fields
 * @returns {StripeCustomer} - the customer
 */
const customer = (id: string, name: string, extra: Partial<StripeCustomer> = {}): StripeCustomer => ({
  id,
  name,
  email: `${id}@example.test`,
  address: null,
  ...extra,
});

const ACME = customer('cus_1', 'Acme SAS', {
  currency: 'eur',
  preferred_locales: ['en-GB'],
  address: {
    line1: '1 rue de la Paix',
    line2: 'Bât. B',
    postal_code: '75002',
    city: 'Paris',
    state: null,
    country: 'FR',
  },
  metadata: { SIRET: '732 829 320 00074' },
  tax_ids: {
    data: [
      { type: 'gb_vat', value: 'GB123456789' },
      { type: 'eu_vat', value: 'FR 40303265045' },
    ],
  },
});

test('a Stripe customer becomes client fields, without what a form would refuse', () => {
  expect(toClientFields(ACME, 'BE')).toEqual({
    kind: 'company',
    name: 'Acme SAS',
    email: 'cus_1@example.test',
    address: '1 rue de la Paix\nBât. B\n75002 Paris',
    country: 'FR',
    vatNumber: 'FR40303265045',
    siret: '73282932000074',
  });
  const bare = customer('cus_9', '', {
    email: 'not an e-mail',
    metadata: { siret: '123' },
    tax_ids: { data: [{ type: 'eu_vat', value: 'XX1' }] },
  });
  expect(toClientFields(bare, 'BE')).toEqual({
    kind: 'individual',
    name: 'not an e-mail',
    email: null,
    address: null,
    country: 'BE',
    vatNumber: null,
    siret: null,
  });
});

test('customers are read with their tax ids, every page, whatever their creation date', async () => {
  const calls: Request[] = [];
  pages.customers = [ACME, customer('cus_2', 'B'), customer('cus_3', 'C')];
  const { items, complete } = await fetchStripeCustomers('rk_test_x', fakeStripe(calls));
  expect(items.map((item) => item.id)).toEqual(['cus_1', 'cus_2', 'cus_3']);
  expect(complete).toBe(true);
  const query = new URL(calls[0]?.url ?? '').searchParams;
  expect(query.getAll('expand[]')).toEqual(['data.tax_ids']);
  expect(query.has('created[gte]')).toBe(false);
  expect(calls).toHaveLength(2);
});

describe.skipIf(!url)('Stripe customers sync (database)', () => {
  const name = `almanach_stripe_${process.pid}`;
  const secretsKey = Buffer.alloc(32, 7);
  const stripe: Record<string, unknown[]> = {};
  let admin: SQL;
  let db: Database;
  let companyId = '';
  let api: Hono<AppEnv>;

  /** Stripe stand-in answering from `stripe`, one page per list. */
  const fake = (async (input: string | URL | Request) =>
    Response.json({
      data: stripe[new URL(String(input)).pathname.replace('/v1/', '')] ?? [],
      has_more: false,
    })) as typeof fetch;

  beforeAll(async () => {
    admin = new SQL(url as string);
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const target = new URL(url as string);
    target.pathname = `/${name}`;
    db = createDatabase(target.toString());
    await runMigrations(db);
    // The instance switch stays off: STRIPE_SYNC=true is what allows the sync here.
    await db.insert(instance).values({
      id: 1,
      name: 'Test',
      publicUrl: 'http://localhost',
      timezone: 'Europe/Paris',
      defaultLocale: 'fr',
    });
    const [user] = await db
      .insert(users)
      .values({ email: 'a@example.test', passwordHash: 'x', role: 'member', locale: 'fr' })
      .returning({ id: users.id });
    companyId = user?.id ?? '';
    await db.insert(companies).values({
      id: companyId,
      userId: companyId,
      name: 'Studio',
      stripeSync: true,
      stripeKey: encryptSecret('rk_test_abcdefghijklmnop', secretsKey),
    });
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
    api = new Hono<AppEnv>();
    api.use(async (c, next) => {
      c.set('company', { id: companyId } as never);
      c.set('user', { id: companyId, role: 'member', locale: 'fr' } as never);
      await next();
    });
    api.route('/api/clients', clientRoutes(db));
  });

  afterAll(async () => {
    await db?.$client.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.close();
  });

  /**
   * Reads the company's clients by Stripe id
   *
   * @returns {Promise<Map<string | null, typeof clients.$inferSelect>>} - clients
   */
  const byStripe = async () =>
    new Map(
      (await db.select().from(clients).where(eq(clients.companyId, companyId))).map((row) => [
        row.stripeId,
        row,
      ]),
    );

  test('customers become clients, receipts are linked, an edit in Almanach is kept, nothing is deleted', async () => {
    const sync = new StripeSync(db, secretsKey, fake, true);
    expect(await new StripeSync(db, secretsKey, fake).allowed()).toBe(false);
    expect(await sync.allowed()).toBe(true);
    stripe.customers = [ACME, customer('cus_2', 'Jane Doe'), customer('cus_3', 'Gone Ltd')];
    stripe.invoices = [
      {
        id: 'in_1',
        number: 'SEK-1',
        currency: 'eur',
        total: 12_000,
        total_excluding_tax: 10_000,
        amount_paid: 12_000,
        customer_name: 'Acme SAS',
        customer_email: null,
        customer: 'cus_1',
        created: Date.UTC(2026, 5, 1) / 1000,
        charge: null,
      },
    ];
    stripe.charges = [
      {
        id: 'ch_9',
        amount: 500,
        currency: 'eur',
        paid: true,
        status: 'succeeded',
        created: Date.UTC(2026, 5, 2) / 1000,
        invoice: null,
        customer: { id: 'cus_3' },
        billing_details: { name: 'Gone Ltd', email: null },
        balance_transaction: null,
      },
    ];
    // Imported before customers were: linked by the next sync, not counted again.
    await db.insert(externalRevenues).values({
      companyId,
      source: 'stripe',
      externalId: 'in_1',
      date: '2026-06-01',
      amountCents: 10_000,
      currency: 'EUR',
    });

    await sync.tick();
    let rows = await byStripe();
    expect(rows.get('cus_1')).toMatchObject({
      kind: 'company',
      name: 'Acme SAS',
      address: '1 rue de la Paix\nBât. B\n75002 Paris',
      country: 'FR',
      vatNumber: 'FR40303265045',
      siret: '73282932000074',
      currency: 'EUR',
      language: 'en',
      paymentTermsDays: 30,
      stripeEdited: false,
      stripeDeletedAt: null,
    });
    expect(rows.get('cus_2')).toMatchObject({ kind: 'individual', name: 'Jane Doe', language: 'fr' });
    const receipts = await db.select().from(externalRevenues);
    expect(new Map(receipts.map((row) => [row.externalId, row.clientId]))).toEqual(
      new Map([
        ['in_1', rows.get('cus_1')?.id ?? ''],
        ['ch_9', rows.get('cus_3')?.id ?? ''],
      ]),
    );
    expect(await sync.syncCompany(companyId)).toEqual({ imported: 0 });

    // The client record lists its receipts; editing it in Almanach stops the sync from overwriting it.
    const jane = rows.get('cus_2');
    const page = await api.request(`/api/clients/${rows.get('cus_1')?.id}`);
    expect(((await page.json()) as { receipts: unknown[] }).receipts).toEqual([
      expect.objectContaining({ date: '2026-06-01', amountCents: 10_000, reference: null }),
    ]);
    const edited = await api.request(`/api/clients/${jane?.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'individual',
        name: 'Jane (typed)',
        email: null,
        country: 'FR',
        currency: 'EUR',
        language: 'fr',
        paymentTermsDays: 15,
        contacts: [],
      }),
    });
    expect(edited.status).toBe(200);

    stripe.customers = [
      { ...ACME, name: 'Acme Group', tax_ids: { data: [] } },
      customer('cus_2', 'Jane Stripe'),
    ];
    expect(await sync.syncCompany(companyId)).toEqual({ imported: 0 });
    rows = await byStripe();
    expect(rows.get('cus_1')).toMatchObject({ name: 'Acme Group', vatNumber: null, kind: 'company' });
    expect(rows.get('cus_2')).toMatchObject({
      name: 'Jane (typed)',
      paymentTermsDays: 15,
      stripeEdited: true,
    });
    expect(rows.get('cus_3')?.stripeDeletedAt).toBeInstanceOf(Date);
    expect(rows.get('cus_1')?.stripeDeletedAt).toBeNull();
    expect((await db.select().from(externalRevenues)).every((row) => row.clientId !== null)).toBe(true);
    // A client with receipts cannot be deleted: archiving keeps its history.
    const gone = await api.request(`/api/clients/${rows.get('cus_3')?.id}`, { method: 'DELETE' });
    expect(gone.status).toBe(409);
  });
});
