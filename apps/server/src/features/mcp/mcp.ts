import {
  type ApiToken,
  apiTokenInputSchema,
  clientInputSchema,
  documentDraftSchema,
  idSchema,
  isoDateSchema,
  type LinkedRecords,
  type TokenScope,
} from '@almanach/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import type { Database } from '../../db/client.ts';
import { apiTokens, auditLog, instance, users } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import { type ActiveCompany, type AppEnv, requestContext, type SessionUser } from '../../http/request.ts';
import { sameOrigin } from '../../http/same-origin.ts';
import { RateLimiter, rateLimit } from '../../security/rate-limit.ts';
import { randomToken, sha256 } from '../../security/tokens.ts';
import { mountAssistant } from '../assistant.ts';
import { clientRoutes } from '../clients/clients.routes.ts';
import { listCompanies } from '../companies/companies.ts';
import { documentRoutes } from '../documents/documents.routes.ts';
import { linkedRecords } from '../federation/linked.ts';
import { planningRoutes } from '../planning/planning.routes.ts';
import { readOnlyAfterCessation } from '../profile/situation.routes.ts';
import { APP_VERSION } from '../system/system.ts';

/** Protocol revisions this server speaks, newest first. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** Who a tool call acts for: the token owner, its scope and the company it works on. */
interface Caller {
  user: SessionUser;
  scope: TokenScope;
}

/** The parts of internal API answers the tools read. */
// biome-ignore lint/suspicious/noExplicitAny: answers of the existing routes, passed through.
type Json = any;

/** A tool error shown to the model, with a stable code. */
class ToolError extends Error {}

/**
 * Tells whether the /mcp endpoint is allowed, by the configuration or by an administrator
 *
 * @param db {Database} - Drizzle database
 * @param preset {boolean} - MCP=true
 * @returns {Promise<boolean>} - true once allowed
 */
export async function mcpAllowed(db: Database, preset: boolean): Promise<boolean> {
  if (preset) return true;
  const [row] = await db.select({ on: instance.mcp }).from(instance).limit(1);
  return row?.on ?? false;
}

/**
 * Builds /api/settings/tokens: personal access tokens of the signed-in person for /mcp. A token is shown once and
 * only its SHA-256 is stored. Mount behind requireUser.
 *
 * @param db {Database} - Drizzle database
 * @param preset {boolean} - MCP=true
 * @returns {Hono<AppEnv>} - the router
 */
export function tokenRoutes(db: Database, preset: boolean): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const rows = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, c.var.user.id))
      .orderBy(desc(apiTokens.createdAt));
    const tokens: ApiToken[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      scope: row.scope,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    }));
    return c.json({ allowed: await mcpAllowed(db, preset), tokens });
  });

  router.post('/', async (c) => {
    const { data, response } = await parseBody(c, apiTokenInputSchema);
    if (response) return response;
    if (!(await mcpAllowed(db, preset))) return c.json({ error: 'mcp_not_allowed' }, 409);
    if ((await db.$count(apiTokens, eq(apiTokens.userId, c.var.user.id))) >= 20)
      return c.json({ error: 'too_many_tokens' }, 409);
    const token = `alm_${randomToken(32)}`;
    const [row] = await db
      .insert(apiTokens)
      .values({ userId: c.var.user.id, name: data.name, scope: data.scope, tokenHash: sha256(token) })
      .returning({ id: apiTokens.id });
    await db
      .insert(auditLog)
      .values({ userId: c.var.user.id, action: 'token.created', meta: { id: row?.id, scope: data.scope } });
    return c.json({ id: row?.id, token }, 201);
  });

  router.delete('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const removed = await db
      .delete(apiTokens)
      .where(and(eq(apiTokens.id, id.data), eq(apiTokens.userId, c.var.user.id)))
      .returning({ id: apiTokens.id });
    if (removed.length === 0) return c.json({ error: 'not_found' }, 404);
    await db
      .insert(auditLog)
      .values({ userId: c.var.user.id, action: 'token.revoked', meta: { id: id.data } });
    return c.body(null, 204);
  });

  return router;
}

const company = z
  .string()
  .max(200)
  .optional()
  .describe('Company id or name, from list_companies. Defaults to the first company of the account.');
const includeTest = z
  .boolean()
  .default(false)
  .describe(
    'Include test data (Stripe test mode, test sources). Test records are always marked `test: true`.',
  );
const period = {
  from: isoDateSchema.optional().describe('First day, YYYY-MM-DD, inclusive.'),
  to: isoDateSchema.optional().describe('Last day, YYYY-MM-DD, inclusive.'),
};

/** A tool: its scope, description, arguments and what it does. */
interface Tool<S extends z.ZodObject = z.ZodObject> {
  scope: TokenScope;
  description: string;
  input: S;
  run: (call: { api: Api; args: z.output<S>; records: () => Promise<LinkedRecords> }) => Promise<unknown>;
}

/** Calls an existing API route of the company, as the token owner. */
/** Calls the API as the token's owner, in the chosen company or in another company of the same account. */
type Api = (path: string, init?: { method?: string; body?: unknown; company?: string }) => Promise<Json>;

/**
 * Declares a tool with its argument types inferred
 *
 * @param tool {Tool<S>} - the tool
 * @returns {Tool<S>} - the same tool
 */
const tool = <S extends z.ZodObject>(tool: Tool<S>): Tool<S> => tool;

/**
 * Tells whether a date is within an optional period
 *
 * @param date {string | null} - YYYY-MM-DD
 * @param range {{ from?: string; to?: string }} - period
 * @returns {boolean} - true when inside, or when no period is given
 */
const within = (date: string | null, range: { from?: string; to?: string }) =>
  (!range.from || (date !== null && date >= range.from)) &&
  (!range.to || (date !== null && date <= range.to));

/**
 * Names of the sources of linked records
 *
 * @param linked {LinkedRecords} - linked records
 * @returns {(linkId: string) => { name: string; kind: string }} - source of a record
 */
const sourceOf = (linked: LinkedRecords) => {
  const sources = new Map(linked.sources.map((source) => [source.id, source]));
  return (linkId: string) => {
    const source = sources.get(linkId);
    return { name: source?.label ?? '', kind: source?.kind === 'external' ? 'external' : 'linked' };
  };
};

const DOCUMENT_TYPES: Record<string, string[]> = {
  quote: ['quote'],
  invoice: ['invoice', 'deposit'],
  credit_note: ['credit_note'],
};

/** Every tool, read-only first; tools with the read_drafts scope never issue, send, delete or change settings. */
const TOOLS = {
  list_companies: tool({
    scope: 'read',
    description:
      'List the companies (business structures) of the account, each with its `activities`: the main one (`main: true`, the profile status) and the secondary ones of a mixed activity (e.g. BNC + BIC services), with the linked instance that created them. Other tools take one as `company`.',
    input: z.object({}),
    run: async ({ api }) => api('/api/companies'),
  }),
  search_clients: tool({
    scope: 'read',
    description:
      'Search the clients of a company by name, e-mail, SIRET or VAT number. Includes read-only clients of linked instances and external sources, with their `source`.',
    input: z.object({
      company,
      query: z.string().max(200).optional().describe('Text to look for; omit to list every client.'),
      includeArchived: z.boolean().default(false),
      includeTest,
    }),
    run: async ({ api, args, records }) => {
      const needle = args.query?.toLowerCase() ?? '';
      const matches = (values: (string | null | undefined)[]) =>
        !needle || values.some((value) => value?.toLowerCase().includes(needle));
      const local = ((await api('/api/clients')).clients as Json[])
        .filter((client) => args.includeArchived || !client.archived)
        .map((client) => ({ ...client, source: null, test: client.livemode === false }));
      const linked = await records();
      const source = sourceOf(linked);
      return [
        ...local,
        ...linked.clients.map((client) => ({
          ...client,
          source: source(client.linkId),
          test: client.test === true,
        })),
      ]
        .filter(
          (client) =>
            (args.includeTest || !client.test) &&
            matches([client.name, client.email, client.siret, client.vatNumber]),
        )
        .slice(0, 200);
    },
  }),
  list_documents: tool({
    scope: 'read',
    description:
      'List quotes, invoices (with deposit invoices) or credit notes, newest first. Covers local documents and the read-only ones of linked instances and external sources (`source` set, `test` marks test data). Amounts are integer minor units (cents).',
    input: z.object({
      company,
      type: z.enum(['quote', 'invoice', 'credit_note']).optional(),
      status: z
        .string()
        .max(30)
        .optional()
        .describe(
          'draft, issued, sent, accepted, declined, expired, partially_paid, paid, overdue or cancelled.',
        ),
      ...period,
      activity: z
        .string()
        .max(100)
        .default('all')
        .describe(
          '"all", "local" (this instance only), "linked" (linked and external only) or a source name.',
        ),
      includeTest,
      limit: z.number().int().min(1).max(500).default(100),
    }),
    run: async ({ api, args, records }) => {
      const wanted = args.type ? DOCUMENT_TYPES[args.type] : undefined;
      const local = ((await api('/api/documents')).documents as Json[]).map((doc) => ({
        id: doc.id,
        type: doc.type,
        number: doc.number,
        status: doc.status,
        clientId: doc.clientId,
        clientName: doc.clientName,
        issueDate: doc.issueDate,
        dueDate: doc.dueDate,
        validUntil: doc.validUntil,
        currency: doc.currency,
        netCents: doc.totals.netCents,
        vatCents: doc.totals.vatCents,
        totalCents: doc.totals.totalCents,
        paidCents: doc.paidCents,
        source: null as { name: string; kind: string } | null,
        test: false,
      }));
      const linked = await records();
      const source = sourceOf(linked);
      const remote = linked.documents.map(({ lines: _lines, linkId, ...doc }) => ({
        ...doc,
        source: { ...source(linkId), ...(doc.origin && { origin: doc.origin }) },
        test: doc.test === true,
      }));
      const activity = args.activity.toLowerCase();
      return [...local, ...remote]
        .filter(
          (doc) =>
            (!wanted || wanted.includes(doc.type)) &&
            (!args.status || doc.status === args.status) &&
            within(doc.issueDate, args) &&
            (args.includeTest || !doc.test) &&
            (activity === 'all' ||
              (activity === 'local'
                ? !doc.source
                : activity === 'linked'
                  ? Boolean(doc.source)
                  : doc.source?.name.toLowerCase() === activity)),
        )
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
        .slice(0, args.limit);
    },
  }),
  get_document: tool({
    scope: 'read',
    description:
      'Get one document with its lines, totals and payments, local or read-only from a linked instance or external source.',
    input: z.object({ company, id: idSchema.describe('Document id, from list_documents.') }),
    run: async ({ api, args, records }) => {
      try {
        return await api(`/api/documents/${args.id}`);
      } catch (error) {
        if (!(error instanceof ToolError) || error.message !== 'not_found') throw error;
      }
      const linked = await records();
      const doc = linked.documents.find((item) => item.id === args.id);
      if (!doc) throw new ToolError('not_found');
      return {
        document: { ...doc, source: sourceOf(linked)(doc.linkId), test: doc.test === true },
        readOnly: true,
      };
    },
  }),
  list_payments: tool({
    scope: 'read',
    description:
      'List payments received, newest first: invoice payments of this instance, and payments or Stripe receipts of linked instances (`source` set). Amounts in cents.',
    input: z.object({ company, ...period, includeTest }),
    run: async ({ api, args, records }) => {
      const linked = await records();
      const source = sourceOf(linked);
      return [
        ...((await api('/api/payments')).payments as Json[]).map((payment) => ({
          ...payment,
          source: null,
          test: false,
        })),
        ...linked.payments.map(({ linkId, ...payment }) => ({
          ...payment,
          source: source(linkId),
          test: payment.test === true,
        })),
      ]
        .filter((payment) => within(payment.date, args) && (args.includeTest || !payment.test))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 500);
    },
  }),
  weekly_review: tool({
    scope: 'read',
    description:
      'Weekly review (format weeklyReview/1) of the ISO week containing `date` (default today, instance time zone): start with `actions`, sorted by urgency, each self-contained with a link; then overdue and next 14 days deadlines with their prepared amount, cash collected this week and last week, overdue invoices and invoices due this week, quotes awaiting an answer, thresholds at 80 % or more, the tax reserve and its change this week, and notices. A section of a function the instance does not offer is absent. Amounts are in cents; test data is excluded. Present nothing as tax advice. `allCompanies: true` returns an array with one review per company of the account.',
    input: z.object({
      company,
      date: isoDateSchema.optional().describe('Any day of the week, YYYY-MM-DD.'),
      allCompanies: z.boolean().default(false),
    }),
    run: async ({ api, args }) => {
      const query = args.date ? `?date=${args.date}` : '';
      if (!args.allCompanies) return (await api(`/api/review/weekly${query}`)).review;
      const companies = (await api('/api/companies')) as { id: string }[];
      return Promise.all(
        companies.map(async (item) => (await api(`/api/review/weekly${query}`, { company: item.id })).review),
      );
    },
  }),
  prepare_declaration: tool({
    scope: 'read',
    description:
      'Prepare a declaration: for a deadline (`key` from list_deadlines, or by default the next one not done that has a prepared declaration), the figures to copy into each box of the official form (`prepared.lines`, null when Almanach does not track the figure) and the amount to pay (`prepared.amount`, with its method, steps and warning), plus `occurrence.link` to the official portal. Amounts in cents. Almanach never files anything: the person declares and pays on the portal. Not tax advice.',
    input: z.object({ company, key: z.string().max(120).optional() }),
    run: async ({ api, args }) =>
      api(args.key ? `/api/deadlines/${encodeURIComponent(args.key)}` : '/api/deadlines/next-prepared'),
  }),
  list_deadlines: tool({
    scope: 'read',
    description:
      'List fiscal and social deadlines, invoice due dates and custom deadlines: the upcoming ones within `days`, or the overdue ones.',
    input: z.object({
      company,
      when: z.enum(['upcoming', 'overdue']).default('upcoming'),
      days: z.number().int().min(1).max(366).default(60),
    }),
    run: async ({ api, args }) => {
      const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
      const upcoming = args.when === 'upcoming';
      const range = upcoming
        ? `from=${shift(-1)}&to=${shift(args.days)}`
        : `from=${shift(-366)}&to=${shift(1)}`;
      const { today, items } = await api(`/api/calendar?${range}`);
      return (items as Json[]).filter(
        (item) => !item.done && !item.hidden && (upcoming ? item.date >= today : item.overdue),
      );
    },
  }),
  get_thresholds: tool({
    scope: 'read',
    description:
      'Get revenue thresholds (micro-enterprise ceilings, VAT exemption, counted on every activity of the business), how far the company is from them, and the estimated social contributions and income tax. `activities` breaks revenue, estimates and the flat-rate tax allowance down per activity, each at its own rates (income tax and other estimates of the whole person are computed once on the total). A threshold with `direction: "below"` warns when revenue falls under it (`fellBelow`, e.g. UK VAT deregistration). `pack` gives the country maturity and `features`, the maturity of each function: absent means unavailable, anything but "verified" is experimental. `simulateCents` adds a hypothetical amount ("what if I invoice X").',
    input: z.object({ company, simulateCents: z.number().int().min(0).max(100_000_000_000).default(0) }),
    run: async ({ api, args }) => api(`/api/outlook?simulate=${args.simulateCents}`),
  }),
  get_dashboard: tool({
    scope: 'read',
    description:
      'Get the dashboard summary: revenue collected and invoiced this month, quarter and year, late invoices, overdue and upcoming deadlines, and the outlook with its per-activity breakdown (`outlook.activities`). Test data is never counted.',
    input: z.object({ company }),
    run: async ({ api }) => api('/api/dashboard'),
  }),
  get_reserve: tool({
    scope: 'read',
    description:
      'Get the tax reserve: how much to keep aside now for the social contributions and taxes of the current fiscal year not paid yet (estimates of the year to date × (1 + prudent margin) + the personal extra − what was already paid at the deadlines that settle them; never below 0). `components` lists each estimate with its steps, source and verification date; `maturity` is the maturity of this function in the country pack (anything but "verified" is experimental). Amounts in cents. An indicative estimate, never tax advice: present `warning` with it. Fails with feature_unavailable when the country pack has no reserve rules.',
    input: z.object({ company }),
    run: async ({ api }) => api('/api/reserve'),
  }),
  list_linked_activities: tool({
    scope: 'read',
    description:
      'List the linked instances (other activities of the same business) and external document sources of a company, with how many read-only records each brings and whether it is a test environment.',
    input: z.object({ company }),
    run: async ({ records }) => {
      const linked = await records();
      const count = (items: { linkId: string }[], id: string) =>
        items.filter((item) => item.linkId === id).length;
      return linked.sources.map((source) => ({
        id: source.id,
        name: source.label,
        kind: source.kind,
        test: source.test,
        clients: count(linked.clients, source.id),
        documents: count(linked.documents, source.id),
        payments: count(linked.payments, source.id),
      }));
    },
  }),
  create_client: tool({
    scope: 'read_drafts',
    description: 'Create a client in a company. Returns the client with its id.',
    input: z.object({ company, client: clientInputSchema }),
    run: async ({ api, args }) => api('/api/clients', { method: 'POST', body: args.client }),
  }),
  update_client: tool({
    scope: 'read_drafts',
    description:
      'Replace the details of an existing client of the company (all fields, as for create_client).',
    input: z.object({ company, id: idSchema, client: clientInputSchema }),
    run: async ({ api, args }) => api(`/api/clients/${args.id}`, { method: 'PUT', body: args.client }),
  }),
  create_draft_document: tool({
    scope: 'read_drafts',
    description:
      'Create a DRAFT quote or invoice. The draft is never issued, numbered or sent: the person reviews and issues it in Almanach. Quantities are in thousandths (1 day = 1000), prices in cents. Returns its id.',
    input: z.object({ company, document: documentDraftSchema }),
    run: async ({ api, args }) => {
      if (!['quote', 'invoice'].includes(args.document.type))
        throw new ToolError('only_quote_or_invoice_drafts');
      return api('/api/documents', { method: 'POST', body: args.document });
    },
  }),
} satisfies Record<string, Tool<z.ZodObject>>;

/**
 * JSON Schema of a tool's arguments, as the protocol describes them
 *
 * @param input {z.ZodObject} - argument schema
 * @returns {Record<string, unknown>} - JSON Schema object
 */
function inputSchema(input: z.ZodObject): Record<string, unknown> {
  const { $schema: _schema, ...schema } = z.toJSONSchema(input, { io: 'input', unrepresentable: 'any' });
  return schema;
}

/**
 * Builds /mcp: a stateless MCP server over the Streamable HTTP transport (JSON answers, no event stream),
 * authenticated by personal access tokens. It answers 404 until MCP is allowed. Tools reuse the API routes of
 * the token owner's companies, so the same checks and computations apply (docs/mcp.md).
 *
 * @param deps {AppDeps} - services
 * @returns {Hono<AppEnv>} - the router
 */
export function mcpRoutes(deps: AppDeps): Hono<AppEnv> {
  const { db } = deps;
  const router = new Hono<AppEnv>();
  const internal = new Hono<AppEnv>();
  internal.use('*', async (c, next) => {
    const scope = (c.env as unknown as { mcp: { user: SessionUser; company: ActiveCompany } }).mcp;
    c.set('user', scope.user);
    c.set('company', scope.company);
    await next();
  });
  const readOnly = readOnlyAfterCessation(db);
  internal.use('/api/clients/*', readOnly);
  internal.use('/api/documents/*', readOnly);
  internal.route('/api/clients', clientRoutes(db));
  const { reserve } = mountAssistant(internal, deps);
  internal.route('/api', documentRoutes(db, deps.documents));
  internal.route('/api', planningRoutes(db, deps.planning, deps.packs, deps.reminders, reserve).api);

  const byIp = new RateLimiter(120, 60_000);
  const byToken = new RateLimiter(120, 60_000);
  const callers = new WeakMap<Request, Caller>();

  router.use('*', async (c, next) => {
    if (!(await mcpAllowed(db, deps.config.mcp))) return c.json({ error: 'not_found' }, 404);
    await next();
  });
  router.use(
    '*',
    rateLimit(byIp, (c) => requestContext(c, deps.config.trustProxy).ip ?? 'unknown'),
  );
  // A browser page of another site must not reach the endpoint (DNS rebinding); command-line clients send no Origin.
  router.use('*', sameOrigin(deps.config.trustProxy));
  router.use(
    '*',
    bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
  );
  const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
    const token = /^Bearer (alm_[A-Za-z0-9_-]{20,100})$/.exec(c.req.header('authorization') ?? '')?.[1];
    const [row] = token
      ? await db
          .select({ id: apiTokens.id, scope: apiTokens.scope, user: users })
          .from(apiTokens)
          .innerJoin(users, eq(users.id, apiTokens.userId))
          .where(eq(apiTokens.tokenHash, sha256(token)))
      : [];
    if (!row) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ error: 'unauthorized' }, 401);
    }
    const { allowed, retryAfterSeconds } = byToken.hit(row.id);
    if (!allowed) {
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json({ error: 'rate_limited' }, 429);
    }
    await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
    callers.set(c.req.raw, {
      user: { id: row.user.id, email: row.user.email, role: row.user.role, locale: row.user.locale },
      scope: row.scope,
    });
    await next();
  };

  router.on(['GET', 'DELETE'], '/', authenticate, (c) => c.body(null, 405, { Allow: 'POST' }));

  router.post('/', authenticate, async (c) => {
    const caller = callers.get(c.req.raw) as Caller;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
    }
    const messages = Array.isArray(body) ? body : [body];
    const answers = [];
    for (const message of messages) {
      const answer = await handle(message, caller);
      if (answer) answers.push(answer);
    }
    if (answers.length === 0) return c.body(null, 202);
    return c.json(Array.isArray(body) ? answers : answers[0]);
  });

  /**
   * Answers one JSON-RPC message; notifications get no answer
   *
   * @param message {unknown} - JSON-RPC request or notification
   * @param caller {Caller} - token owner and scope
   * @returns {Promise<Record<string, unknown> | null>} - the answer, or null for a notification
   */
  async function handle(message: unknown, caller: Caller): Promise<Record<string, unknown> | null> {
    const request = z
      .object({
        jsonrpc: z.literal('2.0'),
        id: z.union([z.string(), z.number()]).optional(),
        method: z.string(),
        params: z.record(z.string(), z.unknown()).optional(),
      })
      .safeParse(message);
    if (!request.success)
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    const { id, method, params = {} } = request.data;
    if (id === undefined) return null;
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, text: string) => ({ jsonrpc: '2.0', id, error: { code, message: text } });
    const tools = Object.entries(TOOLS).filter(
      ([, item]) => item.scope === 'read' || caller.scope === 'read_drafts',
    );
    if (method === 'initialize') {
      const asked = String(params.protocolVersion ?? '');
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'almanach', version: APP_VERSION },
        instructions:
          'Almanach: deadlines, quotes, invoices, payments and revenue thresholds of a freelancer. Amounts are integer cents. Records with `test: true` are test data and never count in totals.',
      });
    }
    if (method === 'ping') return reply({});
    if (method === 'tools/list')
      return reply({
        tools: tools.map(([name, item]) => ({
          name,
          description: item.description,
          inputSchema: inputSchema(item.input),
        })),
      });
    if (method !== 'tools/call') return fail(-32601, 'Method not found');
    const entry = tools.find(([name]) => name === params.name)?.[1] as Tool | undefined;
    if (!entry) return fail(-32602, `Unknown tool: ${String(params.name)}`);
    const args = entry.input.safeParse(params.arguments ?? {});
    if (!args.success)
      return reply(toolResult({ error: 'invalid_arguments', issues: args.error.issues }, true));
    try {
      const companies = await listCompanies(db, caller.user.id);
      const wanted = (args.data as { company?: string }).company?.toLowerCase();
      const company = wanted
        ? companies.find((item) => item.id === wanted || item.name.toLowerCase() === wanted)
        : companies[0];
      if (!company) throw new ToolError('unknown_company');
      const scope = { user: caller.user, company: { id: company.id, name: company.name } };
      const api: Api = async (path, init = {}) => {
        if (path === '/api/companies') return companies;
        const response = await internal.request(
          path,
          {
            method: init.method ?? 'GET',
            headers: { 'content-type': 'application/json' },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
          },
          {
            mcp: init.company
              ? {
                  user: caller.user,
                  company: companies.find((item) => item.id === init.company) ?? scope.company,
                }
              : scope,
          },
        );
        const text = await response.text();
        const json = text ? JSON.parse(text) : null;
        if (!response.ok) throw new ToolError(json?.error ?? `http_${response.status}`);
        return json;
      };
      const result = await entry.run({ api, args: args.data, records: () => linkedRecords(db, company.id) });
      if (entry.scope === 'read_drafts')
        await db.insert(auditLog).values({
          userId: caller.user.id,
          action: 'mcp.write',
          meta: { tool: params.name, company: company.id },
        });
      return reply(toolResult(result, false));
    } catch (error) {
      if (error instanceof ToolError) return reply(toolResult({ error: error.message }, true));
      throw error;
    }
  }

  return router;
}

/**
 * Wraps a tool answer as MCP content
 *
 * @param value {unknown} - answer
 * @param isError {boolean} - whether the call failed
 * @returns {Record<string, unknown>} - tool result
 */
function toolResult(value: unknown, isError: boolean): Record<string, unknown> {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], isError };
}
