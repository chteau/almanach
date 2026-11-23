import {
  countrySchema,
  currencySchema,
  isEuVatNumber,
  isLuhnValid,
  LOCALES,
  type Locale,
  stripeSettingsSchema,
} from '@almanach/shared';
import { and, count, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { auditLog, clients, companies, externalRevenues, instance, profiles } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import { decryptSecret, encryptSecret } from '../../security/secrets.ts';
import { loadBilling } from '../billing/billing.ts';

/** Stripe API version the parsing below was written for; pinned so Stripe never changes the shapes. */
export const STRIPE_VERSION = '2024-06-20';
const STRIPE_API = 'https://api.stripe.com/v1';
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
/** Invoices may be paid weeks after they are created: each sync looks back this far again. */
const LOOKBACK_S = 60 * 86_400;

/** A receipt to store, with the Stripe customer who paid it. */
type Revenue = Omit<typeof externalRevenues.$inferInsert, 'id' | 'companyId' | 'createdAt' | 'clientId'> & {
  customer: string | null;
};
/** Client fields the sync keeps in step with Stripe until the client is edited in Almanach. */
export type CustomerFields = Pick<
  typeof clients.$inferInsert,
  'kind' | 'name' | 'email' | 'address' | 'country' | 'vatNumber' | 'siret'
>;

interface StripeBalance {
  amount: number;
  currency: string;
}
interface StripeInvoice {
  id: string;
  number: string | null;
  currency: string;
  total: number;
  total_excluding_tax: number | null;
  amount_paid: number;
  customer_name: string | null;
  customer_email: string | null;
  customer?: string | { id: string } | null;
  created: number;
  status_transitions?: { paid_at: number | null };
  charge: string | StripeCharge | null;
}
interface StripeCharge {
  id: string;
  amount: number;
  currency: string;
  paid: boolean;
  status: string;
  created: number;
  invoice: string | StripeInvoice | null;
  customer?: string | { id: string } | null;
  billing_details?: { name: string | null; email: string | null };
  balance_transaction: string | StripeBalance | null;
}
interface StripeRefund {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  charge: string | StripeCharge | null;
  balance_transaction: string | StripeBalance | null;
}

export interface StripeCustomer {
  id: string;
  name: string | null;
  email: string | null;
  currency?: string | null;
  preferred_locales?: string[];
  address: {
    line1: string | null;
    line2: string | null;
    postal_code: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
  } | null;
  metadata?: Record<string, string>;
  tax_ids?: { data: { type: string; value: string }[] };
}

/** A Stripe failure, with a code the interface translates. */
export class StripeError extends Error {}

/**
 * Keeps an expanded Stripe object, dropping bare ids
 *
 * @param value {string | T | null | undefined} - expandable field
 * @returns {T | null} - the object, or null
 */
function expanded<T>(value: string | T | null | undefined): T | null {
  return value && typeof value === 'object' ? value : null;
}

/**
 * Reads the id of an expandable Stripe reference
 *
 * @param value {string | { id: string } | null | undefined} - id or expanded object
 * @returns {string | null} - the id, or null
 */
function idOf(value: string | { id: string } | null | undefined): string | null {
  return typeof value === 'string' ? value : (value?.id ?? null);
}

/**
 * Turns a Stripe customer into client fields: name, e-mail, postal address, EU VAT number from its tax ids
 * and SIRET from its metadata. Values Almanach would refuse on a form are left out.
 *
 * @param customer {StripeCustomer} - Stripe customer
 * @param fallbackCountry {string} - company country, when the customer has no address
 * @returns {CustomerFields} - client fields
 */
export function toClientFields(customer: StripeCustomer, fallbackCountry: string): CustomerFields {
  const address = customer.address;
  const country = address?.country?.toUpperCase() ?? '';
  const vat = customer.tax_ids?.data
    .find((tax) => tax.type === 'eu_vat')
    ?.value.replace(/[\s.-]/g, '')
    .toUpperCase();
  const siret = (customer.metadata?.siret ?? customer.metadata?.SIRET)?.replace(/\s/g, '');
  const vatNumber = vat && isEuVatNumber(vat) ? vat : null;
  const validSiret = siret?.length === 14 && isLuhnValid(siret) ? siret : null;
  const lines = [
    address?.line1,
    address?.line2,
    `${address?.postal_code ?? ''} ${address?.city ?? ''}`,
    address?.state,
  ];
  const email = customer.email?.trim() ?? '';
  return {
    kind: vatNumber || validSiret ? 'company' : 'individual',
    name: (customer.name?.trim() || email || customer.id).slice(0, 160),
    email: email && email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null,
    address:
      lines
        .map((line) => line?.trim())
        .filter(Boolean)
        .join('\n')
        .slice(0, 500) || null,
    country: countrySchema.safeParse(country).success ? country : fallbackCountry,
    vatNumber,
    siret: validSiret,
  };
}

/**
 * Reads every page of a Stripe list
 *
 * @param key {string} - restricted read-only key
 * @param path {string} - list path, such as "invoices"
 * @param params {[string, string][]} - filters and expansions
 * @param fetcher {typeof fetch} - HTTP client
 * @returns {Promise<{ items: T[]; complete: boolean }>} - objects, and whether the list was read to its end
 * @throws {StripeError} - when Stripe refuses the key or cannot be reached
 */
async function stripeList<T extends { id: string }>(
  key: string,
  path: string,
  params: [string, string][],
  fetcher: typeof fetch,
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams([...params, ['limit', '100']]);
    if (after) query.set('starting_after', after);
    const response = await fetcher(`${STRIPE_API}/${path}?${query}`, {
      headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_VERSION },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    }).catch(() => {
      throw new StripeError('stripe_unreachable');
    });
    if (response.status === 401) throw new StripeError('stripe_unauthorized');
    if (response.status === 403) throw new StripeError('stripe_forbidden');
    if (!response.ok) throw new StripeError('stripe_failed');
    const body = (await response.json()) as { data: T[]; has_more: boolean };
    items.push(...body.data);
    after = body.data.at(-1)?.id;
    if (!body.has_more || !after) return { items, complete: true };
  }
  return { items, complete: false };
}

/**
 * Reads every customer of a Stripe account with its tax ids; Stripe lists only customers not deleted
 *
 * @param key {string} - restricted read-only key
 * @param fetcher {typeof fetch} - HTTP client, replaced in tests
 * @returns {Promise<{ items: StripeCustomer[]; complete: boolean }>} - customers, and whether all were read
 * @throws {StripeError} - when Stripe refuses the key or cannot be reached
 */
export function fetchStripeCustomers(
  key: string,
  fetcher: typeof fetch = fetch,
): Promise<{ items: StripeCustomer[]; complete: boolean }> {
  return stripeList<StripeCustomer>(key, 'customers', [['expand[]', 'data.tax_ids']], fetcher);
}

/**
 * Builds one receipt from Stripe amounts; the converted amount is kept only when Stripe settled in the
 * company currency
 *
 * @param input {object} - Stripe id, date, gross and pre-tax amounts, currency, balance transaction, client, reference
 * @param main {string} - company currency
 * @param timezone {string} - instance time zone, for the collection day
 * @returns {Revenue} - the receipt
 */
function toRevenue(
  input: {
    id: string;
    at: number;
    gross: number;
    net: number;
    currency: string;
    balance: StripeBalance | null;
    client: string | null;
    reference: string | null;
    customer: string | null;
  },
  main: string,
  timezone: string,
): Revenue {
  const currency = input.currency.toUpperCase();
  const settled = input.balance && input.balance.currency.toUpperCase() === main ? input.balance : null;
  return {
    source: 'stripe',
    externalId: input.id,
    date: new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(input.at * 1000)),
    amountCents: input.net,
    currency,
    receivedCents:
      currency === main || !settled ? null : Math.round((settled.amount * input.net) / input.gross),
    client: input.client?.slice(0, 200) ?? null,
    reference: input.reference?.slice(0, 100) ?? null,
    customer: input.customer,
  };
}

/**
 * Pre-tax share of an amount, from an invoice that gives its total before tax
 *
 * @param amount {number} - amount paid or refunded
 * @param invoice {StripeInvoice | null} - related invoice
 * @returns {number} - amount before tax, or the amount itself when the invoice does not say
 */
function preTax(amount: number, invoice: StripeInvoice | null): number {
  if (!invoice || invoice.total <= 0 || invoice.total_excluding_tax === null) return amount;
  return Math.round((amount * invoice.total_excluding_tax) / invoice.total);
}

/**
 * Reads the receipts of a Stripe account: paid invoices, paid charges without an invoice, and refunds as
 * negative amounts. Only amounts, dates, customer names and invoice numbers are kept, never card data.
 *
 * @param key {string} - restricted read-only key
 * @param since {number} - Unix time of the oldest object to read
 * @param main {string} - company currency
 * @param timezone {string} - instance time zone
 * @param fetcher {typeof fetch} - HTTP client, replaced in tests
 * @returns {Promise<Revenue[]>} - receipts
 * @throws {StripeError} - when Stripe refuses the key or cannot be reached
 */
export async function fetchStripeRevenues(
  key: string,
  since: number,
  main: string,
  timezone: string,
  fetcher: typeof fetch = fetch,
): Promise<Revenue[]> {
  const list = async <T extends { id: string }>(path: string, params: [string, string][]) =>
    (await stripeList<T>(key, path, [...params, ['created[gte]', String(since)]], fetcher)).items;

  const out: Revenue[] = [];
  const invoices = await list<StripeInvoice>('invoices', [
    ['status', 'paid'],
    ['expand[]', 'data.charge.balance_transaction'],
  ]);
  for (const invoice of invoices) {
    if (invoice.amount_paid <= 0) continue;
    const charge = expanded(invoice.charge);
    out.push(
      toRevenue(
        {
          id: invoice.id,
          at: invoice.status_transitions?.paid_at ?? invoice.created,
          gross: charge?.amount || invoice.amount_paid,
          net: preTax(invoice.amount_paid, invoice),
          currency: invoice.currency,
          balance: expanded(charge?.balance_transaction),
          client: invoice.customer_name ?? invoice.customer_email,
          reference: invoice.number,
          customer: idOf(invoice.customer),
        },
        main,
        timezone,
      ),
    );
  }
  const charges = await list<StripeCharge>('charges', [['expand[]', 'data.balance_transaction']]);
  for (const charge of charges) {
    // Charges of an invoice are already counted through the invoice.
    if (!charge.paid || charge.status !== 'succeeded' || charge.invoice || charge.amount <= 0) continue;
    out.push(
      toRevenue(
        {
          id: charge.id,
          at: charge.created,
          gross: charge.amount,
          net: charge.amount,
          currency: charge.currency,
          balance: expanded(charge.balance_transaction),
          client: charge.billing_details?.name ?? charge.billing_details?.email ?? null,
          reference: null,
          customer: idOf(charge.customer),
        },
        main,
        timezone,
      ),
    );
  }
  const refunds = await list<StripeRefund>('refunds', [
    ['expand[]', 'data.charge.invoice'],
    ['expand[]', 'data.balance_transaction'],
  ]);
  for (const refund of refunds) {
    if (refund.status !== 'succeeded' || refund.amount <= 0) continue;
    const charge = expanded(refund.charge);
    const invoice = expanded(charge?.invoice);
    out.push(
      toRevenue(
        {
          id: refund.id,
          at: refund.created,
          gross: -refund.amount,
          net: -preTax(refund.amount, invoice),
          currency: refund.currency,
          balance: expanded(refund.balance_transaction),
          client: invoice?.customer_name ?? charge?.billing_details?.name ?? null,
          reference: invoice?.number ?? null,
          customer: idOf(charge?.customer ?? invoice?.customer),
        },
        main,
        timezone,
      ),
    );
  }
  return out;
}

/** Scheduled and on-demand Stripe sync; runs only for companies whose owner turned it on, once allowed. */
export class StripeSync {
  private timer: ReturnType<typeof setInterval> | undefined;

  /**
   * Creates the job
   *
   * @param db {Database} - Drizzle database
   * @param secretsKey {Buffer | undefined} - key decrypting stored Stripe keys
   * @param fetcher {typeof fetch} - HTTP client, replaced in tests
   * @param preset {boolean} - STRIPE_SYNC=true: the server administrator allowed syncs in the configuration
   */
  constructor(
    private readonly db: Database,
    private readonly secretsKey: Buffer | undefined,
    private readonly fetcher: typeof fetch = fetch,
    private readonly preset = false,
  ) {}

  /**
   * Syncs every enabled company now and then every six hours
   *
   * @returns {void}
   */
  start(): void {
    const run = () => void this.tick().catch((error) => console.warn('Stripe sync failed:', error));
    setTimeout(run, 60_000);
    this.timer = setInterval(run, SIX_HOURS_MS);
  }

  /**
   * Stops the schedule
   *
   * @returns {void}
   */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Tells whether an administrator allowed Stripe syncs on this instance
   *
   * @returns {Promise<boolean>} - true once allowed
   */
  async allowed(): Promise<boolean> {
    if (this.preset) return true;
    const [row] = await this.db.select({ on: instance.stripeSync }).from(instance).limit(1);
    return row?.on ?? false;
  }

  /**
   * Syncs every company with the sync turned on
   *
   * @returns {Promise<void>} - resolves once done; failures are stored on each company
   */
  async tick(): Promise<void> {
    if (!(await this.allowed())) return;
    const rows = await this.db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.stripeSync, true));
    for (const row of rows) await this.syncCompany(row.id);
  }

  /**
   * Creates or updates the clients of a company from its Stripe customers. Clients edited in Almanach keep
   * their fields; clients whose customer is gone are only marked, never deleted.
   *
   * @param companyId {string} - company
   * @param customers {{ items: StripeCustomer[]; complete: boolean }} - every customer of the Stripe account
   * @param defaults {{ country: string; currency: string; language: Locale }} - company country and currency, instance language
   * @returns {Promise<Map<string, string>>} - Almanach client id by Stripe customer id
   */
  private async syncCustomers(
    companyId: string,
    customers: { items: StripeCustomer[]; complete: boolean },
    defaults: { country: string; currency: string; language: Locale },
  ): Promise<Map<string, string>> {
    const rows = await this.db
      .select({
        id: clients.id,
        name: clients.name,
        vat: clients.vatNumber,
        stripeId: clients.stripeId,
        edited: clients.stripeEdited,
      })
      .from(clients)
      .where(eq(clients.companyId, companyId));
    const linked = new Map(rows.flatMap((row) => (row.stripeId ? [[row.stripeId, row] as const] : [])));
    const unlinked = rows.filter((row) => !row.stripeId);
    const { defaultTermsDays } = await loadBilling(this.db, companyId, defaults.country);
    const ids = new Map<string, string>();
    for (const customer of customers.items) {
      const fields = toClientFields(customer, defaults.country);
      const row = linked.get(customer.id);
      if (row) {
        await this.db
          .update(clients)
          .set({ ...(row.edited ? {} : fields), stripeDeletedAt: null })
          .where(eq(clients.id, row.id));
        ids.set(customer.id, row.id);
        continue;
      }
      // A client typed in before the sync is adopted rather than duplicated, and keeps what was typed.
      const same = unlinked.find(
        (client) =>
          (fields.vatNumber && client.vat === fields.vatNumber) ||
          client.name.toLowerCase() === fields.name.toLowerCase(),
      );
      if (same) {
        unlinked.splice(unlinked.indexOf(same), 1);
        await this.db
          .update(clients)
          .set({ stripeId: customer.id, stripeEdited: true })
          .where(eq(clients.id, same.id));
        ids.set(customer.id, same.id);
        continue;
      }
      const locale = customer.preferred_locales?.[0]?.slice(0, 2);
      const currency = customer.currency?.toUpperCase();
      const [created] = await this.db
        .insert(clients)
        .values({
          ...fields,
          companyId,
          stripeId: customer.id,
          currency: currency && currencySchema.safeParse(currency).success ? currency : defaults.currency,
          language: LOCALES.find((code) => code === locale) ?? defaults.language,
          paymentTermsDays: defaultTermsDays,
          contacts: [],
        })
        .returning({ id: clients.id });
      if (created) ids.set(customer.id, created.id);
    }
    if (customers.complete) {
      await this.db
        .update(clients)
        .set({ stripeDeletedAt: new Date() })
        .where(
          and(
            eq(clients.companyId, companyId),
            isNotNull(clients.stripeId),
            isNull(clients.stripeDeletedAt),
            notInArray(clients.stripeId, [...ids.keys()]),
          ),
        );
    }
    return ids;
  }

  /**
   * Imports the Stripe customers and receipts of one company; known Stripe ids are skipped, so running twice is
   * harmless. Receipts are linked to the client of their customer.
   *
   * @param companyId {string} - company to sync
   * @returns {Promise<{ imported: number } | { error: string }>} - new receipts, or the failure code
   */
  async syncCompany(companyId: string): Promise<{ imported: number } | { error: string }> {
    const [row] = await this.db
      .select({
        company: companies,
        profile: profiles,
        timezone: instance.timezone,
        language: instance.defaultLocale,
      })
      .from(companies)
      .leftJoin(profiles, eq(profiles.companyId, companies.id))
      .innerJoin(instance, eq(instance.id, 1))
      .where(eq(companies.id, companyId))
      .limit(1);
    if (!row?.company.stripeSync || !row.company.stripeKey) return { error: 'stripe_off' };
    if (!row.profile) return { error: 'no_profile' };
    if (!this.secretsKey) return { error: 'secrets_key_missing' };
    const started = new Date();
    try {
      const key = decryptSecret(row.company.stripeKey, this.secretsKey);
      const last = row.company.stripeSyncedAt;
      const since = last
        ? Math.floor(last.getTime() / 1000) - LOOKBACK_S
        : Math.floor(Date.parse(row.profile.activityStart) / 1000);
      const customers = await fetchStripeCustomers(key, this.fetcher);
      const revenues = await fetchStripeRevenues(
        key,
        since,
        row.profile.currency,
        row.timezone,
        this.fetcher,
      );
      const clientIds = await this.syncCustomers(companyId, customers, {
        country: row.profile.country,
        currency: row.profile.currency,
        language: row.language as Locale,
      });
      let imported = 0;
      for (let start = 0; start < revenues.length; start += 500) {
        const rows = await this.db
          .insert(externalRevenues)
          .values(
            revenues.slice(start, start + 500).map(({ customer, ...revenue }) => ({
              ...revenue,
              companyId,
              clientId: (customer && clientIds.get(customer)) || null,
            })),
          )
          // Receipts imported before their client existed get it now; `xmax = 0` tells a new row from an update.
          .onConflictDoUpdate({
            target: [externalRevenues.companyId, externalRevenues.source, externalRevenues.externalId],
            set: { clientId: sql`excluded.client_id` },
            setWhere: sql`${externalRevenues.clientId} is null and excluded.client_id is not null`,
          })
          .returning({ inserted: sql<boolean>`xmax = 0` });
        imported += rows.filter((inserted) => inserted.inserted).length;
      }
      await this.db
        .update(companies)
        .set({ stripeSyncedAt: started, stripeError: null })
        .where(eq(companies.id, companyId));
      return { imported };
    } catch (error) {
      const code = error instanceof StripeError ? error.message : 'stripe_failed';
      if (!(error instanceof StripeError)) console.warn('Stripe sync failed:', error);
      await this.db.update(companies).set({ stripeError: code }).where(eq(companies.id, companyId));
      return { error: code };
    }
  }
}

/**
 * Builds /api/settings/stripe for the active company: status, key and switch, and a sync on demand.
 * Mount behind requireUser and requireCompany.
 *
 * @param db {Database} - Drizzle database
 * @param sync {StripeSync} - sync job
 * @param secretsKey {Buffer | undefined} - key encrypting stored Stripe keys
 * @returns {Hono<AppEnv>} - the router
 */
export function stripeRoutes(db: Database, sync: StripeSync, secretsKey: Buffer | undefined): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const id = c.var.company.id;
    const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    const [stored] = await db
      .select({ count: count() })
      .from(externalRevenues)
      .where(and(eq(externalRevenues.companyId, id), eq(externalRevenues.source, 'stripe')));
    return c.json({
      allowed: await sync.allowed(),
      secretsKey: Boolean(secretsKey),
      keySet: Boolean(company?.stripeKey),
      enabled: company?.stripeSync ?? false,
      syncedAt: company?.stripeSyncedAt?.toISOString() ?? null,
      error: company?.stripeError ?? null,
      imported: stored?.count ?? 0,
    });
  });

  router.put('/', async (c) => {
    const { data, response } = await parseBody(c, stripeSettingsSchema);
    if (response) return response;
    const id = c.var.company.id;
    if (data.key && !secretsKey) return c.json({ error: 'secrets_key_missing' }, 409);
    if (data.enabled && !(await sync.allowed())) return c.json({ error: 'stripe_not_allowed' }, 409);
    const [company] = await db
      .select({ key: companies.stripeKey })
      .from(companies)
      .where(eq(companies.id, id));
    if (data.enabled && !data.key && !company?.key) return c.json({ error: 'stripe_key_missing' }, 409);
    await db
      .update(companies)
      .set({
        stripeSync: data.enabled,
        stripeError: null,
        ...(data.key && secretsKey
          ? { stripeKey: encryptSecret(data.key, secretsKey), stripeSyncedAt: null }
          : {}),
      })
      .where(eq(companies.id, id));
    await db.insert(auditLog).values({
      userId: c.var.user.id,
      action: 'stripe.updated',
      meta: { company: id, enabled: data.enabled },
    });
    return c.body(null, 204);
  });

  router.delete('/', async (c) => {
    await db
      .update(companies)
      .set({ stripeKey: null, stripeSync: false, stripeError: null, stripeSyncedAt: null })
      .where(eq(companies.id, c.var.company.id));
    return c.body(null, 204);
  });

  router.post('/sync', async (c) => {
    if (!(await sync.allowed())) return c.json({ error: 'stripe_not_allowed' }, 409);
    const result = await sync.syncCompany(c.var.company.id);
    return 'error' in result ? c.json(result, 409) : c.json(result);
  });

  return router;
}
