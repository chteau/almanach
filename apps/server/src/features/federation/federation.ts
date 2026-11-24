import {
  activityStatusSchema,
  DETAIL_LIMITS,
  type FederationLink,
  federationCreateSchema,
  federationJoinSchema,
  federationLinkOptionsSchema,
  federationSettingsSchema,
  type LinkedDetail,
  linkActivitySchema,
  linkedDetailSchema,
  type MonthlyTotals,
  monthlyTotalsSchema,
  type Receipt,
} from '@almanach/shared';
import { and, desc, eq, gt, gte, isNull, lt, or } from 'drizzle-orm';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import {
  auditLog,
  clients,
  companies,
  documents,
  externalDocuments,
  externalRevenues,
  externalSources,
  federationLinks,
  federationNonces,
  federationTotals,
  instance,
  payments,
} from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import { type AppEnv, requestContext } from '../../http/request.ts';
import { RateLimiter, rateLimit } from '../../security/rate-limit.ts';
import { decryptSecret, encryptSecret } from '../../security/secrets.ts';
import { randomToken, sha256 } from '../../security/tokens.ts';
import { ensureActivity, ownsActivity } from '../activities/activities.ts';
import { ownerOf } from '../companies/companies.ts';
import type { DocumentService } from '../documents/documents.service.ts';
import { generateSigningKeys, keyIdOf } from '../packs/signing.ts';
import { instanceToday } from '../planning/planning.routes.ts';
import type { PlanningService } from '../planning/planning.service.ts';
import {
  checkSignature,
  decodePairingCode,
  encodePairingCode,
  FederationError,
  instanceUrl,
  PAIRING_TTL_MS,
  type RequestSignature,
  readLimited,
  readSignature,
  SIGNATURE_WINDOW_S,
  signRequest,
  signResponse,
  verifyResponse,
} from './crypto.ts';
import { storeDetail } from './linked.ts';

/** Prefix of the routes other instances call. */
export const FEDERATION_PATH = '/api/federation';
/** Answers carry the detail snapshot when shared; requests are bounded alike in app.ts. */
export const MAX_EXCHANGE_BYTES = 8 * 1024 * 1024;
/** Above this size a detail snapshot drops its document lines. */
const DETAIL_BUDGET_BYTES = 6 * 1024 * 1024;
/** Opening the dashboard refreshes links whose last exchange is older than this. */
const STALE_MS = 5 * 60 * 1000;
/** Calendar months shared, the current one included: enough for every threshold window. */
const SHARED_MONTHS = 36;

type LinkRow = typeof federationLinks.$inferSelect;

const publicKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const pairRequestSchema = z
  .object({
    secret: z.string().regex(/^[A-Za-z0-9_-]{14}$/),
    url: z.string().max(500),
    publicKey: publicKeySchema,
  })
  .strict();
const pairAnswerSchema = z.object({ publicKey: publicKeySchema }).strict();
// The detail fields are optional and only sent when used, so peers running an older version keep exchanging totals.
// `activity` is the status of the sender's main activity, null when it does not share its totals. An instance of
// an older version refuses it: the caller then sends again without it, and the other side only answers with it
// when the request carried it.
const exchangeRequestSchema = z
  .object({
    receive: z.boolean(),
    totals: monthlyTotalsSchema.nullable(),
    activity: activityStatusSchema.nullable().optional(),
    receiveDetail: z.literal(true).optional(),
    detail: linkedDetailSchema.optional(),
  })
  .strict();
const exchangeAnswerSchema = z
  .object({
    totals: monthlyTotalsSchema.nullable(),
    activity: activityStatusSchema.nullable().optional(),
    receiveDetail: z.literal(true).optional(),
    detail: linkedDetailSchema.optional(),
  })
  .strict();

/**
 * Parses JSON without throwing
 *
 * @param text {string} - raw text
 * @returns {unknown} - parsed value, or undefined when malformed
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Sums receipts per calendar month and fiscal category: the only figures a link ever shares
 *
 * @param receipts {Receipt[]} - receipts in the company currency; those of a secondary activity carry its status
 * @param statusOn {(date: string) => string} - status of the main activity on a date
 * @returns {MonthlyTotals['months']} - totals in month order, without any client, invoice or unit amount
 */
export function monthlyTotals(
  receipts: Receipt[],
  statusOn: (date: string) => string,
): MonthlyTotals['months'] {
  const sums = new Map<string, number>();
  for (const receipt of receipts) {
    const key = `${receipt.date.slice(0, 7)}|${receipt.category ?? statusOn(receipt.date)}`;
    sums.set(key, (sums.get(key) ?? 0) + receipt.cents);
  }
  return [...sums.keys()].sort().map((key) => {
    const [month = '', category = ''] = key.split('|');
    return { month, category, cents: sums.get(key) ?? 0 };
  });
}

/** Whether a link sends its detail: shared on this side and kept on the other one. */
const sendsDetail = (link: LinkRow, peerReceives: boolean) => link.share && link.shareDetail && peerReceives;
/** Whether a link keeps the detail the peer shares. */
const keepsDetail = (link: LinkRow) => link.receive && link.receiveDetail;

/**
 * Links between instances tracking activities of the same business: pairing, signed exchanges of monthly
 * totals and of the optional read-only detail, revocation, and the automatic sync of the links this side
 * calls: on a schedule, shortly after a local change, and when the dashboard opens (docs/federation.md)
 */
export class Federation {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly running = new Set<string>();
  private readonly queued = new Set<string>();
  /** Delay gathering a burst of local changes into one exchange. */
  debounceMs = 30_000;

  /**
   * Creates the service
   *
   * @param db {Database} - Drizzle database
   * @param planning {PlanningService} - source of the local receipts
   * @param secretsKey {Buffer | undefined} - key encrypting the private keys of links
   * @param fetcher {typeof fetch} - HTTP client, replaced in tests
   * @param preset {boolean} - FEDERATION=true: the server administrator allowed links in the configuration
   * @param options {{ documents?: DocumentService; intervalMinutes?: number }} - source of the shared detail, and
   * minutes between scheduled syncs (FEDERATION_INTERVAL_MINUTES)
   */
  constructor(
    private readonly db: Database,
    private readonly planning: PlanningService,
    private readonly secretsKey: Buffer | undefined,
    private readonly fetcher: typeof fetch = fetch,
    private readonly preset = false,
    private readonly options: { documents?: DocumentService; intervalMinutes?: number } = {},
  ) {}

  /** Minutes between two scheduled syncs. */
  get intervalMinutes(): number {
    return this.options.intervalMinutes ?? 15;
  }

  /**
   * Syncs the links this side calls in a minute, then every FEDERATION_INTERVAL_MINUTES
   *
   * @returns {void}
   */
  start(): void {
    const run = () => void this.tick().catch((error) => console.warn('Federation sync failed:', error));
    setTimeout(run, 60_000);
    this.timer = setInterval(run, this.intervalMinutes * 60_000);
  }

  /**
   * Stops the schedule and the pending syncs
   *
   * @returns {void}
   */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  /**
   * Schedules a sync of a company's links after a local change (document, payment, Stripe receipt); a burst of
   * changes within the debounce delay leads to a single exchange
   *
   * @param companyId {string} - company whose records changed
   * @returns {void}
   */
  touch(companyId: string): void {
    clearTimeout(this.pending.get(companyId));
    const timer = setTimeout(() => {
      this.pending.delete(companyId);
      void this.syncCompany(companyId);
    }, this.debounceMs);
    timer.unref?.();
    this.pending.set(companyId, timer);
  }

  /**
   * Syncs, without waiting, the links of a company whose last exchange is more than five minutes old
   *
   * @param companyId {string} - company whose dashboard opens
   * @returns {void}
   */
  refresh(companyId: string): void {
    void this.syncCompany(companyId, new Date(Date.now() - STALE_MS));
  }

  /**
   * Exchanges with the peers a company calls, skipping links synced since a date; nothing leaves the
   * instance unless links are allowed, and a company is never synced twice at once (a change arriving
   * meanwhile runs once more afterwards)
   *
   * @param companyId {string} - company
   * @param staleBefore {Date} - only links last synced before this date, or never
   * @returns {Promise<void>} - resolves once done; failures are stored on each link
   */
  async syncCompany(companyId: string, staleBefore?: Date): Promise<void> {
    if (this.running.has(companyId)) {
      if (!staleBefore) this.queued.add(companyId);
      return;
    }
    this.running.add(companyId);
    try {
      if (!(await this.allowed())) return;
      const rows = await this.db
        .select({ id: federationLinks.id })
        .from(federationLinks)
        .innerJoin(
          companies,
          and(eq(companies.id, federationLinks.companyId), eq(companies.federation, true)),
        )
        .where(
          and(
            eq(federationLinks.companyId, companyId),
            eq(federationLinks.state, 'active'),
            eq(federationLinks.pulls, true),
            staleBefore
              ? or(isNull(federationLinks.syncedAt), lt(federationLinks.syncedAt, staleBefore))
              : undefined,
          ),
        );
      for (const row of rows) await this.exchange(row.id);
    } catch (error) {
      console.warn('Federation sync failed:', error);
    } finally {
      this.running.delete(companyId);
    }
    if (this.queued.delete(companyId)) await this.syncCompany(companyId);
  }

  /**
   * Tells whether an administrator allowed links on this instance
   *
   * @returns {Promise<boolean>} - true once allowed
   */
  async allowed(): Promise<boolean> {
    if (this.preset) return true;
    const [row] = await this.db.select({ on: instance.federation }).from(instance).limit(1);
    return row?.on ?? false;
  }

  /**
   * Forgets expired pairing codes and nonces, then exchanges with every peer this side calls
   *
   * @returns {Promise<void>} - resolves once done; failures are stored on each link
   */
  async tick(): Promise<void> {
    await this.db
      .delete(federationLinks)
      .where(and(eq(federationLinks.state, 'pending'), lt(federationLinks.codeExpiresAt, new Date())));
    if (!(await this.allowed())) return;
    const rows = await this.db
      .select({ id: federationLinks.id })
      .from(federationLinks)
      .innerJoin(companies, and(eq(companies.id, federationLinks.companyId), eq(companies.federation, true)))
      .where(and(eq(federationLinks.state, 'active'), eq(federationLinks.pulls, true)));
    for (const row of rows) await this.exchange(row.id);
  }

  /**
   * Middleware answering 404 on the federation routes unless links are allowed and one is active or
   * waiting for its pairing
   *
   * @returns {MiddlewareHandler} - the middleware
   */
  open(): MiddlewareHandler {
    return async (c, next) => {
      if (!(await this.allowed())) return c.json({ error: 'not_found' }, 404);
      const [row] = await this.db
        .select({ id: federationLinks.id })
        .from(federationLinks)
        .where(
          or(
            eq(federationLinks.state, 'active'),
            and(eq(federationLinks.state, 'pending'), gt(federationLinks.codeExpiresAt, new Date())),
          ),
        )
        .limit(1);
      if (!row) return c.json({ error: 'not_found' }, 404);
      await next();
    };
  }

  /**
   * Records the nonce of a verified request, refusing one already seen within the signature window
   *
   * @param signed {RequestSignature} - request signature
   * @returns {Promise<boolean>} - false for a replay
   */
  async useNonce(signed: RequestSignature): Promise<boolean> {
    await this.db.delete(federationNonces).where(lt(federationNonces.expiresAt, new Date()));
    const rows = await this.db
      .insert(federationNonces)
      .values({
        keyId: signed.keyId,
        nonce: signed.nonce,
        expiresAt: new Date(Date.now() + 2 * SIGNATURE_WINDOW_S * 1000),
      })
      .onConflictDoNothing()
      .returning({ nonce: federationNonces.nonce });
    return rows.length === 1;
  }

  /**
   * Finds the active link a peer key belongs to, on a company that still has links turned on
   *
   * @param keyId {string} - fingerprint of the peer key
   * @returns {Promise<LinkRow | undefined>} - the link
   */
  async findLink(keyId: string): Promise<LinkRow | undefined> {
    const [row] = await this.db
      .select({ link: federationLinks })
      .from(federationLinks)
      .innerJoin(companies, and(eq(companies.id, federationLinks.companyId), eq(companies.federation, true)))
      .where(and(eq(federationLinks.peerKeyId, keyId), eq(federationLinks.state, 'active')))
      .limit(1);
    return row?.link;
  }

  /**
   * Lists the links of a company, without any key material
   *
   * @param companyId {string} - company
   * @returns {Promise<FederationLink[]>} - links, oldest first
   */
  async list(companyId: string): Promise<FederationLink[]> {
    const rows = await this.db
      .select()
      .from(federationLinks)
      .where(eq(federationLinks.companyId, companyId))
      .orderBy(federationLinks.createdAt);
    return rows.map((row) => ({
      id: row.id,
      state: row.state,
      peerUrl: row.peerUrl,
      peerLabel: row.peerLabel,
      fingerprint: row.publicKey ? keyIdOf(row.publicKey) : null,
      peerFingerprint: row.peerKeyId,
      share: row.share,
      receive: row.receive,
      pulls: row.pulls,
      shareDetail: row.shareDetail,
      receiveDetail: row.receiveDetail,
      syncedAt: row.syncedAt?.toISOString() ?? null,
      receivedAt: row.receivedAt?.toISOString() ?? null,
      error: row.error,
      codeExpiresAt: row.codeExpiresAt?.toISOString() ?? null,
      peerActivity: row.peerActivity,
      activityAuto: row.activityAuto,
      activity: row.activityMain ? 'main' : row.activityId,
    }));
  }

  /**
   * Issues a one-time pairing code for a new link, valid fifteen minutes
   *
   * @param companyId {string} - company
   * @param input {z.infer<typeof federationCreateSchema>} - this instance's address and what it shares
   * @returns {Promise<{ code: string; expiresAt: string; fingerprint: string } | { error: string }>} - code or failure
   */
  async create(
    companyId: string,
    input: z.infer<typeof federationCreateSchema>,
  ): Promise<{ code: string; expiresAt: string; fingerprint: string } | { error: string }> {
    if (!this.secretsKey) return { error: 'secrets_key_missing' };
    const url = instanceUrl(input.url);
    if (!url) return { error: 'invalid_url' };
    const keys = generateSigningKeys();
    const secret = randomToken(10);
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    await this.db.insert(federationLinks).values({
      companyId,
      state: 'pending',
      codeHash: sha256(secret),
      codeExpiresAt: expiresAt,
      publicKey: keys.publicKey,
      privateKey: encryptSecret(keys.privateKey, this.secretsKey),
      share: input.share,
      receive: input.receive,
    });
    return {
      code: encodePairingCode(secret, keys.publicKey, url),
      expiresAt: expiresAt.toISOString(),
      fingerprint: keyIdOf(keys.publicKey),
    };
  }

  /**
   * Pairs with the instance that issued a code: sends this side's new public key, checks the answer is
   * signed by the key whose fingerprint the code holds, then stores the active link
   *
   * @param companyId {string} - company
   * @param input {z.infer<typeof federationJoinSchema>} - code, this instance's address, what it shares
   * @returns {Promise<{ id: string } | { error: string }>} - new link, or failure
   */
  async join(
    companyId: string,
    input: z.infer<typeof federationJoinSchema>,
  ): Promise<{ id: string } | { error: string }> {
    if (!this.secretsKey) return { error: 'secrets_key_missing' };
    const code = decodePairingCode(input.code);
    if (!code) return { error: 'invalid_code' };
    const url = instanceUrl(input.url);
    if (!url) return { error: 'invalid_url' };
    const keys = generateSigningKeys();
    try {
      const sent = await this.post(
        code.url,
        'pair',
        { secret: code.secret, url, publicKey: keys.publicKey },
        keys,
      );
      if (sent.status === 404) return { error: 'code_unknown' };
      if (sent.status === 410) return { error: 'code_expired' };
      if (sent.status !== 200) return { error: 'peer_failed' };
      const answer = pairAnswerSchema.safeParse(parseJson(sent.text));
      if (
        !answer.success ||
        keyIdOf(answer.data.publicKey) !== code.fingerprint ||
        !verifyResponse(sent.nonce, sent.text, sent.signature, answer.data.publicKey)
      )
        return { error: 'peer_bad_signature' };
      const [row] = await this.db
        .insert(federationLinks)
        .values({
          companyId,
          state: 'active',
          peerUrl: code.url,
          publicKey: keys.publicKey,
          privateKey: encryptSecret(keys.privateKey, this.secretsKey),
          peerPublicKey: answer.data.publicKey,
          peerKeyId: code.fingerprint,
          share: input.share,
          receive: input.receive,
          pulls: true,
          syncedAt: new Date(),
        })
        .returning({ id: federationLinks.id });
      return row ? { id: row.id } : { error: 'peer_failed' };
    } catch (error) {
      if (error instanceof FederationError) return { error: error.message };
      throw error;
    }
  }

  /**
   * Answers a pairing request: consumes the one-time code and stores the peer's key
   *
   * @param input {z.infer<typeof pairRequestSchema>} - secret, peer address and key
   * @returns {Promise<{ link: LinkRow } | { error: string }>} - the now active link, or why it is refused
   */
  async pair(input: z.infer<typeof pairRequestSchema>): Promise<{ link: LinkRow } | { error: string }> {
    const peerUrl = instanceUrl(input.url);
    if (!peerUrl) return { error: 'invalid_url' };
    const [found] = await this.db
      .select({ link: federationLinks })
      .from(federationLinks)
      .innerJoin(companies, and(eq(companies.id, federationLinks.companyId), eq(companies.federation, true)))
      .where(and(eq(federationLinks.codeHash, sha256(input.secret)), eq(federationLinks.state, 'pending')))
      .limit(1);
    if (!found) return { error: 'not_found' };
    if (!found.link.codeExpiresAt || found.link.codeExpiresAt < new Date()) return { error: 'code_expired' };
    // Consumed in the same statement that checks it: two concurrent uses cannot both succeed.
    const [link] = await this.db
      .update(federationLinks)
      .set({
        state: 'active',
        codeHash: null,
        codeExpiresAt: null,
        peerUrl,
        peerPublicKey: input.publicKey,
        peerKeyId: keyIdOf(input.publicKey),
        syncedAt: new Date(),
      })
      .where(and(eq(federationLinks.id, found.link.id), eq(federationLinks.state, 'pending')))
      .returning();
    return link ? { link } : { error: 'not_found' };
  }

  /**
   * Monthly totals of a company for its links: label, currency and revenue per month and fiscal category
   *
   * @param companyId {string} - company
   * @returns {Promise<MonthlyTotals | null>} - totals, or null before onboarding
   */
  async ownTotals(companyId: string): Promise<MonthlyTotals | null> {
    const profile = await this.planning.profile(companyId);
    const [company] = await this.db
      .select({ name: companies.name, label: companies.federationLabel })
      .from(companies)
      .where(eq(companies.id, companyId));
    if (!profile || !company) return null;
    const today = await instanceToday(this.db);
    const since = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - SHARED_MONTHS, 1))
      .toISOString()
      .slice(0, 10);
    const { receipts } = await this.planning.receipts(companyId, profile.currency, since, today);
    const segments = await this.planning.segments(profile);
    const statusOn = (date: string) =>
      (
        segments.find((segment) => segment.from <= date && (segment.to === null || date <= segment.to)) ??
        segments.at(-1)
      )?.profile.status ?? 'none';
    return {
      label: company.label ?? company.name.slice(0, 60),
      currency: profile.currency,
      months: monthlyTotals(receipts, statusOn),
    };
  }

  /**
   * Status of the main activity of a company, announced to its links with the totals
   *
   * @param companyId {string} - company
   * @returns {Promise<string | null>} - profile status, null before onboarding or for a generic profile
   */
  async ownActivity(companyId: string): Promise<string | null> {
    return (await this.planning.profile(companyId))?.status ?? null;
  }

  /**
   * Chooses the activity a link's revenue counts as: "auto" follows the announced one, "main", "none" (thresholds
   * only) or a secondary activity of the company
   *
   * @param link {LinkRow} - link of the company
   * @param choice {z.infer<typeof linkActivitySchema>['activity']} - wanted attachment
   * @returns {Promise<boolean>} - false when the secondary activity is not the company's
   */
  async attach(link: LinkRow, choice: z.infer<typeof linkActivitySchema>['activity']): Promise<boolean> {
    if (choice === 'auto') {
      const profile = await this.planning.profile(link.companyId);
      const status = link.peerActivity;
      const target =
        status && profile && this.planning.knownStatus(profile.country, status)
          ? await ensureActivity(this.db, link.companyId, status, link.id)
          : { main: false, id: null };
      await this.db
        .update(federationLinks)
        .set({ activityAuto: true, activityMain: target.main, activityId: target.id })
        .where(eq(federationLinks.id, link.id));
      return true;
    }
    const secondary = choice !== 'main' && choice !== 'none' ? choice : null;
    if (!(await ownsActivity(this.db, link.companyId, secondary))) return false;
    await this.db
      .update(federationLinks)
      .set({ activityAuto: false, activityMain: choice === 'main', activityId: secondary })
      .where(eq(federationLinks.id, link.id));
    return true;
  }

  /**
   * Read-only detail of a company for its links: active clients, issued documents and payments (invoice
   * payments and Stripe receipts) of the current and previous calendar years, newest first and bounded by
   * DETAIL_LIMITS; document lines are left out when the snapshot would be too large
   *
   * @param companyId {string} - company
   * @returns {Promise<LinkedDetail | null>} - snapshot, or null when the document service is not wired
   */
  async ownDetail(companyId: string): Promise<LinkedDetail | null> {
    if (!this.options.documents) return null;
    const today = await instanceToday(this.db);
    const since = `${Number(today.slice(0, 4)) - 1}-01-01`;
    const docs = (await this.options.documents.views(companyId, today))
      .filter((doc) => doc.state !== 'draft' && doc.issueDate >= since)
      .slice(0, DETAIL_LIMITS.documents);
    const people = await this.db
      .select({
        id: clients.id,
        kind: clients.kind,
        name: clients.name,
        email: clients.email,
        country: clients.country,
        siret: clients.siret,
        vatNumber: clients.vatNumber,
        livemode: clients.livemode,
      })
      .from(clients)
      .where(and(eq(clients.companyId, companyId), eq(clients.archived, false)))
      .orderBy(clients.name)
      .limit(DETAIL_LIMITS.clients);
    const invoicePayments = await this.db
      .select({
        id: payments.id,
        date: payments.date,
        amountCents: payments.amountCents,
        currency: documents.currency,
        documentId: payments.documentId,
        documentNumber: documents.number,
        clientName: clients.name,
        reference: payments.reference,
      })
      .from(payments)
      .innerJoin(documents, eq(documents.id, payments.documentId))
      .innerJoin(clients, eq(clients.id, documents.clientId))
      .where(and(eq(payments.companyId, companyId), gte(payments.date, since)))
      .orderBy(desc(payments.date))
      .limit(DETAIL_LIMITS.payments);
    const receipts = await this.db
      .select({ revenue: externalRevenues, clientName: clients.name })
      .from(externalRevenues)
      .leftJoin(clients, eq(clients.id, externalRevenues.clientId))
      .where(and(eq(externalRevenues.companyId, companyId), gte(externalRevenues.date, since)))
      .orderBy(desc(externalRevenues.date))
      .limit(DETAIL_LIMITS.payments);
    // Records of the external sources travel too, marked with their source, after the local ones.
    const relayed = await this.db
      .select({ data: externalDocuments.data, origin: externalSources.name, test: externalSources.test })
      .from(externalDocuments)
      .innerJoin(externalSources, eq(externalSources.id, externalDocuments.linkId))
      .where(eq(externalSources.companyId, companyId));
    const detail: LinkedDetail = {
      clients: people.map(({ livemode, ...client }) => ({
        ...client,
        ...(livemode === false && { test: true }),
      })),
      documents: docs.map((doc) => ({
        id: doc.id,
        type: doc.type,
        status: doc.status,
        number: doc.number,
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
        dueCents:
          doc.type === 'invoice' || doc.type === 'deposit'
            ? Math.max(0, doc.totals.totalCents - doc.creditedCents - doc.paidCents)
            : 0,
        lines:
          doc.lines.length <= DETAIL_LIMITS.lines
            ? doc.lines.map(({ description, quantity, unit, unitPriceCents }) => ({
                description,
                quantity,
                unit,
                unitPriceCents,
              }))
            : null,
      })),
      payments: [
        ...invoicePayments.map((row) => ({ ...row, source: 'payment' as const })),
        ...receipts.map(({ revenue, clientName }) => ({
          id: revenue.id,
          source: 'stripe' as const,
          date: revenue.date,
          amountCents: revenue.amountCents,
          currency: revenue.currency,
          documentId: null,
          documentNumber: null,
          clientName: clientName ?? revenue.client,
          reference: revenue.reference,
          ...(revenue.livemode === false && { test: true as const }),
        })),
      ]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, DETAIL_LIMITS.payments),
    };
    detail.documents = [
      ...detail.documents,
      ...relayed
        .filter((row) => row.data.issueDate >= since)
        .sort((a, b) => b.data.issueDate.localeCompare(a.data.issueDate))
        .map((row) => ({ ...row.data, origin: row.origin, ...(row.test && { test: true as const }) })),
    ].slice(0, DETAIL_LIMITS.documents);
    if (JSON.stringify(detail).length > DETAIL_BUDGET_BYTES)
      detail.documents = detail.documents.map((doc) => ({ ...doc, lines: null }));
    return detail;
  }

  /**
   * Replaces the totals and the detail received on a link; null forgets them (the peer stopped sharing, or
   * this side stopped receiving)
   *
   * @param link {LinkRow} - link
   * @param totals {MonthlyTotals | null} - totals received
   * @param detail {LinkedDetail | null} - detail received, kept only when this side receives it
   * @param activity {string | null | undefined} - main activity the peer announces; undefined from an older peer
   * @returns {Promise<void>} - resolves once stored
   * @throws {FederationError} - currency_mismatch when the peer counts in another currency
   */
  private async store(
    link: LinkRow,
    totals: MonthlyTotals | null,
    detail: LinkedDetail | null = null,
    activity?: string | null,
  ): Promise<void> {
    const profile = await this.planning.profile(link.companyId);
    if (totals && totals.currency !== profile?.currency) {
      throw new FederationError('currency_mismatch');
    }
    const announced = totals && activity && profile && this.planning.knownStatus(profile.country, activity);
    const sums = new Map<string, MonthlyTotals['months'][number]>();
    for (const item of totals?.months ?? []) {
      const key = `${item.month}|${item.category}`;
      sums.set(key, { ...item, cents: (sums.get(key)?.cents ?? 0) + item.cents });
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(federationTotals).where(eq(federationTotals.linkId, link.id));
      if (sums.size > 0)
        await tx
          .insert(federationTotals)
          .values([...sums.values()].map((item) => ({ linkId: link.id, ...item })));
      await storeDetail(tx, link.id, keepsDetail(link) ? detail : null);
      await tx
        .update(federationLinks)
        .set(
          totals
            ? {
                peerLabel: totals.label,
                peerCurrency: totals.currency,
                receivedAt: new Date(),
                peerActivity: announced ? activity : null,
              }
            : { receivedAt: null },
        )
        .where(eq(federationLinks.id, link.id));
      // By default the link counts as the activity its peer announces, created as a secondary one when missing.
      if (announced && link.activityAuto) {
        const target = await ensureActivity(tx, link.companyId, activity, link.id);
        await tx
          .update(federationLinks)
          .set({ activityMain: target.main, activityId: target.id })
          .where(eq(federationLinks.id, link.id));
      }
    });
  }

  /**
   * Decrypts the key pair of a link
   *
   * @param link {LinkRow} - link
   * @returns {{ publicKey: string; privateKey: string }} - raw public key and PEM private key
   * @throws {FederationError} - when keys or SECRETS_KEY are missing
   */
  private keys(link: LinkRow): { publicKey: string; privateKey: string } {
    if (!this.secretsKey || !link.publicKey || !link.privateKey)
      throw new FederationError('secrets_key_missing');
    return { publicKey: link.publicKey, privateKey: decryptSecret(link.privateKey, this.secretsKey) };
  }

  /**
   * Private key of a link, to sign answers
   *
   * @param link {LinkRow} - link
   * @returns {string} - PEM private key
   */
  privateKeyOf(link: LinkRow): string {
    return this.keys(link).privateKey;
  }

  /**
   * Deletes a link the peer revoked, with the totals received through it
   *
   * @param link {LinkRow} - link
   * @returns {Promise<void>} - resolves once deleted
   */
  async revokedByPeer(link: LinkRow): Promise<void> {
    await this.db.delete(federationLinks).where(eq(federationLinks.id, link.id));
    await this.db.insert(auditLog).values({
      userId: ownerOf(link.companyId),
      action: 'federation.revoked_by_peer',
      meta: { link: link.id },
    });
  }

  /**
   * Sends a signed request to a peer: short timeout, no redirect, bounded answer
   *
   * @param base {string} - peer address
   * @param action {string} - route under /api/federation
   * @param payload {object} - JSON body
   * @param keys {{ publicKey: string; privateKey: string }} - this side's keys
   * @returns {Promise<{ status: number; text: string; nonce: string; signature: string | null }>} - answer
   * @throws {FederationError} - peer_unreachable or peer_too_large
   */
  private async post(
    base: string,
    action: string,
    payload: object,
    keys: { publicKey: string; privateKey: string },
  ): Promise<{ status: number; text: string; nonce: string; signature: string | null }> {
    const body = JSON.stringify(payload);
    const path = `${FEDERATION_PATH}/${action}`;
    const headers = signRequest('POST', path, body, keys);
    try {
      const response = await this.fetcher(`${base}${path}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      return {
        status: response.status,
        text: await readLimited(response, MAX_EXCHANGE_BYTES),
        nonce: headers['x-almanach-nonce'] ?? '',
        signature: response.headers.get('x-almanach-signature'),
      };
    } catch (error) {
      throw error instanceof FederationError ? error : new FederationError('peer_unreachable');
    }
  }

  /**
   * Calls the peer of a link: sends this side's totals when shared, keeps the peer's when received, and
   * likewise the detail when one side shares it and the other keeps it. On failure the last totals and detail
   * stay, with their date, and the error is stored.
   *
   * @param linkId {string} - link
   * @param again {boolean} - whether a second call may follow at once, when the peer just started keeping the detail
   * @returns {Promise<{ ok: true } | { error: string }>} - outcome
   */
  async exchange(linkId: string, again = true): Promise<{ ok: true } | { error: string }> {
    if (!(await this.allowed())) return { error: 'link_inactive' };
    const [row] = await this.db
      .select({ link: federationLinks })
      .from(federationLinks)
      .innerJoin(companies, and(eq(companies.id, federationLinks.companyId), eq(companies.federation, true)))
      .where(and(eq(federationLinks.id, linkId), eq(federationLinks.state, 'active')))
      .limit(1);
    const link = row?.link;
    if (!link?.peerUrl || !link.peerPublicKey) return { error: 'link_inactive' };
    try {
      const totals = link.share ? await this.ownTotals(link.companyId) : null;
      const detail = sendsDetail(link, link.peerReceivesDetail) ? await this.ownDetail(link.companyId) : null;
      const request = {
        receive: link.receive,
        totals,
        ...(keepsDetail(link) && { receiveDetail: true }),
        ...(detail && { detail }),
      };
      const activity = totals ? await this.ownActivity(link.companyId) : null;
      let sent = await this.post(link.peerUrl, 'exchange', { ...request, activity }, this.keys(link));
      // A peer of an older version refuses the unknown field: same exchange without it.
      if (sent.status === 422) sent = await this.post(link.peerUrl, 'exchange', request, this.keys(link));
      if (sent.status === 401 || sent.status === 404) throw new FederationError('peer_refused');
      if (sent.status !== 200) throw new FederationError('peer_failed');
      if (!verifyResponse(sent.nonce, sent.text, sent.signature, link.peerPublicKey))
        throw new FederationError('peer_bad_signature');
      const answer = exchangeAnswerSchema.safeParse(parseJson(sent.text));
      if (!answer.success) throw new FederationError('peer_invalid');
      await this.store(
        link,
        link.receive ? answer.data.totals : null,
        answer.data.detail ?? null,
        answer.data.activity,
      );
      const peerReceivesDetail = answer.data.receiveDetail === true;
      await this.db
        .update(federationLinks)
        .set({ syncedAt: new Date(), error: null, peerReceivesDetail })
        .where(eq(federationLinks.id, link.id));
      if (again && !detail && sendsDetail(link, peerReceivesDetail)) return this.exchange(link.id, false);
      return { ok: true };
    } catch (error) {
      const code = error instanceof FederationError ? error.message : 'peer_failed';
      if (!(error instanceof FederationError)) console.warn('Federation exchange failed:', error);
      await this.db.update(federationLinks).set({ error: code }).where(eq(federationLinks.id, link.id));
      return { error: code };
    }
  }

  /**
   * Answers an exchange from a verified peer
   *
   * @param link {LinkRow} - link of the calling peer
   * @param request {z.infer<typeof exchangeRequestSchema>} - peer totals and whether it wants this side's
   * @returns {Promise<string>} - JSON answer
   * @throws {FederationError} - currency_mismatch
   */
  async answer(link: LinkRow, request: z.infer<typeof exchangeRequestSchema>): Promise<string> {
    await this.store(link, link.receive ? request.totals : null, request.detail ?? null, request.activity);
    const peerReceivesDetail = request.receiveDetail === true;
    await this.db
      .update(federationLinks)
      .set({ syncedAt: new Date(), error: null, peerReceivesDetail })
      .where(eq(federationLinks.id, link.id));
    const detail = sendsDetail(link, peerReceivesDetail) ? await this.ownDetail(link.companyId) : null;
    const totals = link.share && request.receive ? await this.ownTotals(link.companyId) : null;
    // Only a caller that announced its own activity reads this field; an older one would refuse the answer.
    const activity = request.activity !== undefined && totals ? await this.ownActivity(link.companyId) : null;
    return JSON.stringify({
      totals,
      ...(activity && { activity }),
      ...(keepsDetail(link) && { receiveDetail: true }),
      ...(detail && { detail }),
    });
  }

  /**
   * Deletes a link and the totals received through it, telling the peer when it can be reached
   *
   * @param companyId {string} - company
   * @param linkId {string} - link
   * @returns {Promise<boolean>} - false when the link is not the company's
   */
  async revoke(companyId: string, linkId: string): Promise<boolean> {
    const [link] = await this.db
      .select()
      .from(federationLinks)
      .where(and(eq(federationLinks.id, linkId), eq(federationLinks.companyId, companyId)));
    if (!link) return false;
    if (link.state === 'active' && link.peerUrl && (await this.allowed())) {
      // Best effort: an unreachable peer finds out at its next exchange.
      const peerUrl = link.peerUrl;
      await Promise.resolve()
        .then(() => this.post(peerUrl, 'revoke', {}, this.keys(link)))
        .catch(() => undefined);
    }
    await this.db.delete(federationLinks).where(eq(federationLinks.id, link.id));
    return true;
  }
}

/**
 * Checks the signature of a request from a linked peer and records its nonce
 *
 * @param federation {Federation} - service
 * @param c {Context<AppEnv>} - request
 * @returns {Promise<{ link: LinkRow; raw: string; signed: RequestSignature } | Response>} - verified request, or the refusal
 */
async function verified(
  federation: Federation,
  c: Context<AppEnv>,
): Promise<{ link: LinkRow; raw: string; signed: RequestSignature } | Response> {
  const signed = readSignature((name) => c.req.header(name));
  if (!signed) return c.json({ error: 'bad_signature' }, 401);
  const link = await federation.findLink(signed.keyId);
  if (!link?.peerPublicKey) return c.json({ error: 'unknown_link' }, 401);
  const raw = await c.req.text();
  const problem = checkSignature(
    signed,
    { method: c.req.method, path: c.req.path, body: raw },
    link.peerPublicKey,
  );
  if (problem) return c.json({ error: problem }, 401);
  if (!(await federation.useNonce(signed))) return c.json({ error: 'replayed' }, 401);
  return { link, raw, signed };
}

/**
 * Builds /api/federation, called by other instances with signed requests: pairing, exchange, revocation.
 * Rate-limited, and 404 while no link is active or waiting for its pairing.
 *
 * @param federation {Federation} - service
 * @param trustProxy {boolean} - whether X-Forwarded-For names the client
 * @returns {Hono<AppEnv>} - the router
 */
export function federationRoutes(federation: Federation, trustProxy: boolean): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const limiter = new RateLimiter(30, 60_000);
  router.use(
    '*',
    rateLimit(limiter, (c) => requestContext(c as Context<AppEnv>, trustProxy).ip ?? 'unknown'),
  );
  router.use('*', federation.open());

  router.post('/pair', async (c) => {
    const signed = readSignature((name) => c.req.header(name));
    if (!signed) return c.json({ error: 'bad_signature' }, 401);
    const raw = await c.req.text();
    const body = pairRequestSchema.safeParse(parseJson(raw));
    if (!body.success) return c.json({ error: 'validation_failed' }, 422);
    // Proof that the caller holds the private key it sends.
    const problem = checkSignature(
      signed,
      { method: 'POST', path: c.req.path, body: raw },
      body.data.publicKey,
    );
    if (problem) return c.json({ error: problem }, 401);
    if (!(await federation.useNonce(signed))) return c.json({ error: 'replayed' }, 401);
    const result = await federation.pair(body.data);
    if ('error' in result) return c.json(result, result.error === 'code_expired' ? 410 : 404);
    const answer = JSON.stringify({ publicKey: result.link.publicKey });
    const privateKey = federation.privateKeyOf(result.link);
    return c.body(answer, 200, {
      'content-type': 'application/json',
      'x-almanach-signature': signResponse(signed.nonce, answer, privateKey),
    });
  });

  router.post('/exchange', async (c) => {
    const request = await verified(federation, c);
    if (request instanceof Response) return request;
    const body = exchangeRequestSchema.safeParse(parseJson(request.raw));
    if (!body.success) return c.json({ error: 'validation_failed' }, 422);
    let answer: string;
    try {
      answer = await federation.answer(request.link, body.data);
    } catch (error) {
      if (error instanceof FederationError) return c.json({ error: error.message }, 409);
      throw error;
    }
    return c.body(answer, 200, {
      'content-type': 'application/json',
      'x-almanach-signature': signResponse(
        request.signed.nonce,
        answer,
        federation.privateKeyOf(request.link),
      ),
    });
  });

  router.post('/revoke', async (c) => {
    const request = await verified(federation, c);
    if (request instanceof Response) return request;
    await federation.revokedByPeer(request.link);
    return c.body(null, 204);
  });

  return router;
}

/**
 * Builds /api/settings/federation for the active company: switch and label, links, pairing, sync and
 * revocation. Mount behind requireUser and requireCompany.
 *
 * @param db {Database} - Drizzle database
 * @param federation {Federation} - service
 * @param secretsKey {Buffer | undefined} - key encrypting the private keys of links
 * @returns {Hono<AppEnv>} - the router
 */
export function federationSettingsRoutes(
  db: Database,
  federation: Federation,
  secretsKey: Buffer | undefined,
): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * Refuses link operations until an administrator allowed links and the company turned them on
   *
   * @param companyId {string} - company
   * @returns {Promise<string | null>} - failure code, or null
   */
  const usable = async (companyId: string): Promise<string | null> => {
    if (!(await federation.allowed())) return 'federation_not_allowed';
    const [company] = await db
      .select({ on: companies.federation })
      .from(companies)
      .where(eq(companies.id, companyId));
    if (!company?.on) return 'federation_off';
    return secretsKey ? null : 'secrets_key_missing';
  };

  /**
   * Writes an audit entry for the active company
   *
   * @param c {Context<AppEnv>} - request
   * @param action {string} - audit action
   * @param meta {Record<string, unknown>} - details
   * @returns {Promise<void>} - resolves once written
   */
  const audit = async (c: Context<AppEnv>, action: string, meta: Record<string, unknown> = {}) => {
    await db
      .insert(auditLog)
      .values({ userId: c.var.user.id, action, meta: { company: c.var.company.id, ...meta } });
  };

  router.get('/', async (c) => {
    const [company] = await db
      .select({ enabled: companies.federation, label: companies.federationLabel, name: companies.name })
      .from(companies)
      .where(eq(companies.id, c.var.company.id));
    const [row] = await db.select({ url: instance.publicUrl }).from(instance).limit(1);
    return c.json({
      allowed: await federation.allowed(),
      secretsKey: Boolean(secretsKey),
      enabled: company?.enabled ?? false,
      label: company?.label ?? company?.name ?? '',
      publicUrl: row?.url ?? '',
      intervalMinutes: federation.intervalMinutes,
      links: await federation.list(c.var.company.id),
    });
  });

  router.put('/', async (c) => {
    const { data, response } = await parseBody(c, federationSettingsSchema);
    if (response) return response;
    if (data.enabled && !(await federation.allowed()))
      return c.json({ error: 'federation_not_allowed' }, 409);
    await db
      .update(companies)
      .set({ federation: data.enabled, federationLabel: data.label })
      .where(eq(companies.id, c.var.company.id));
    await audit(c, 'federation.updated', { enabled: data.enabled });
    return c.body(null, 204);
  });

  router.post('/links', async (c) => {
    const { data, response } = await parseBody(c, federationCreateSchema);
    if (response) return response;
    const problem = await usable(c.var.company.id);
    if (problem) return c.json({ error: problem }, 409);
    const result = await federation.create(c.var.company.id, data);
    if ('error' in result) return c.json(result, 422);
    await audit(c, 'federation.code_issued');
    return c.json(result, 201);
  });

  router.post('/links/join', async (c) => {
    const { data, response } = await parseBody(c, federationJoinSchema);
    if (response) return response;
    const problem = await usable(c.var.company.id);
    if (problem) return c.json({ error: problem }, 409);
    const result = await federation.join(c.var.company.id, data);
    if ('error' in result) return c.json(result, 409);
    await audit(c, 'federation.paired', { link: result.id });
    await federation.exchange(result.id);
    return c.json(result, 201);
  });

  /**
   * Reads the link id of the path, checked to belong to the active company
   *
   * @param c {Context<AppEnv>} - request
   * @returns {Promise<string | null>} - link id, or null
   */
  const ownedLink = async (c: Context<AppEnv>): Promise<string | null> => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return null;
    const [row] = await db
      .select({ id: federationLinks.id })
      .from(federationLinks)
      .where(and(eq(federationLinks.id, id.data), eq(federationLinks.companyId, c.var.company.id)));
    return row?.id ?? null;
  };

  router.patch('/links/:id', async (c) => {
    const { data, response } = await parseBody(c, federationLinkOptionsSchema);
    if (response) return response;
    const id = await ownedLink(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    await db.update(federationLinks).set(data).where(eq(federationLinks.id, id));
    if (!data.receive) await db.delete(federationTotals).where(eq(federationTotals.linkId, id));
    if (!(data.receive && data.receiveDetail)) await storeDetail(db, id, null);
    return c.body(null, 204);
  });

  router.put('/links/:id/activity', async (c) => {
    const { data, response } = await parseBody(c, linkActivitySchema);
    if (response) return response;
    const id = await ownedLink(c);
    const [link] = id ? await db.select().from(federationLinks).where(eq(federationLinks.id, id)) : [];
    if (!link) return c.json({ error: 'not_found' }, 404);
    if (!(await federation.attach(link, data.activity))) return c.json({ error: 'unknown_activity' }, 422);
    return c.body(null, 204);
  });

  router.post('/links/:id/sync', async (c) => {
    const id = await ownedLink(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const problem = await usable(c.var.company.id);
    if (problem) return c.json({ error: problem }, 409);
    const result = await federation.exchange(id);
    return 'error' in result ? c.json(result, 409) : c.json(result);
  });

  router.delete('/links/:id', async (c) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success || !(await federation.revoke(c.var.company.id, id.data)))
      return c.json({ error: 'not_found' }, 404);
    await audit(c, 'federation.revoked', { link: id.data });
    return c.body(null, 204);
  });

  return router;
}
