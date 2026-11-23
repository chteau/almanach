import { createHash } from 'node:crypto';
import {
  type ExternalSource,
  externalSourceInputSchema,
  FEED_LIMITS,
  type Feed,
  feedSchema,
  type LinkedClient,
  type LinkedDocument,
  QUANTITY_SCALE,
} from '@almanach/shared';
import { and, count, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import { auditLog, externalClients, externalDocuments, externalSources, instance } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import { decryptSecret, encryptSecret } from '../../security/secrets.ts';
import { FederationError, readLimited } from '../federation/crypto.ts';

/** Minutes between two scheduled polls of every source. */
const INTERVAL_MINUTES = 15;

/** A feed failure, with a code the interface translates. */
export class FeedError extends Error {}

/**
 * Derives a stable UUID for a record of a source from its id there, so links to the read-only page survive polls
 *
 * @param sourceId {string} - source
 * @param remoteId {string} - kind and id of the record in the feed
 * @returns {string} - name-based UUID (version 5 layout)
 */
export function externalId(sourceId: string, remoteId: string): string {
  const hex = createHash('sha256').update(`${sourceId}:${remoteId}`).digest('hex');
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Converts a feed to the read-only record shapes the linked lists already show
 *
 * @param feed {Feed} - validated feed
 * @param sourceId {string} - source
 * @returns {{ clients: LinkedClient[]; documents: LinkedDocument[] }} - one client per feed client, and the documents
 */
export function toLinked(
  feed: Feed,
  sourceId: string,
): { clients: LinkedClient[]; documents: LinkedDocument[] } {
  const clients = new Map<string, LinkedClient>();
  const documents = feed.documents.map((doc): LinkedDocument => {
    const clientId = externalId(sourceId, `client:${doc.client.id}`);
    clients.set(clientId, {
      id: clientId,
      kind: doc.client.siret || doc.client.vat ? 'company' : 'individual',
      name: doc.client.name,
      email: doc.client.email ?? null,
      country: doc.client.country ?? '',
      siret: doc.client.siret ?? null,
      vatNumber: doc.client.vat ?? null,
    });
    const status = doc.status === 'refused' ? 'declined' : doc.status;
    const open = doc.type === 'invoice' && !['draft', 'paid', 'cancelled'].includes(status);
    return {
      id: externalId(sourceId, `${doc.type}:${doc.id}`),
      type: doc.type,
      status,
      number: doc.number,
      clientId,
      clientName: doc.client.name,
      issueDate: doc.issuedAt,
      dueDate: null,
      validUntil: doc.validUntil ?? null,
      currency: doc.currency,
      netCents: doc.totalExclTaxCents,
      vatCents: doc.taxCents,
      totalCents: doc.totalInclTaxCents,
      paidCents: status === 'paid' ? doc.totalInclTaxCents : 0,
      dueCents: open ? doc.totalInclTaxCents : 0,
      lines:
        doc.lines?.map((line) => ({
          description: line.label,
          quantity: Math.round(line.quantity * QUANTITY_SCALE),
          unit: 'unit',
          unitPriceCents: line.unitPriceCents,
        })) ?? null,
    };
  });
  return { clients: [...clients.values()], documents };
}

/**
 * Fetches and validates a feed: HTTPS address checked by the input schema, Bearer token, no redirect, 10 s,
 * answer bounded to FEED_LIMITS.bytes
 *
 * @param url {string} - feed address
 * @param token {string} - Bearer token
 * @param fetcher {typeof fetch} - HTTP client
 * @returns {Promise<Feed>} - the feed
 * @throws {FeedError} - feed_unreachable, feed_unauthorized, feed_http, feed_too_large or feed_invalid
 */
export async function fetchFeed(url: string, token: string, fetcher: typeof fetch = fetch): Promise<Feed> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'Almanach' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new FeedError('feed_unreachable');
  }
  if (response.status === 401 || response.status === 403) throw new FeedError('feed_unauthorized');
  if (!response.ok) throw new FeedError('feed_http');
  let text: string;
  try {
    text = await readLimited(response, FEED_LIMITS.bytes);
  } catch (error) {
    throw new FeedError(error instanceof FederationError ? 'feed_too_large' : 'feed_unreachable');
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FeedError('feed_invalid');
  }
  const parsed = feedSchema.safeParse(body);
  if (!parsed.success) throw new FeedError('feed_invalid');
  return parsed.data;
}

/**
 * External document sources: an HTTPS feed per source, polled every 15 minutes and on demand once an
 * administrator allowed them; the records are kept read-only apart from local data (docs/external-sources.md)
 */
export class ExternalSources {
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Called after a poll stored records, so linked instances hear about them. */
  onChange: ((companyId: string) => void) | undefined;

  /**
   * Creates the service
   *
   * @param db {Database} - Drizzle database
   * @param secretsKey {Buffer | undefined} - key decrypting the stored tokens
   * @param fetcher {typeof fetch} - HTTP client, replaced in tests
   * @param preset {boolean} - EXTERNAL_SOURCES=true: allowed by the server configuration
   */
  constructor(
    private readonly db: Database,
    private readonly secretsKey: Buffer | undefined,
    private readonly fetcher: typeof fetch = fetch,
    private readonly preset = false,
  ) {}

  /**
   * Polls every source in a minute, then every 15 minutes
   *
   * @returns {void}
   */
  start(): void {
    const run = () => void this.tick().catch((error) => console.warn('External sources failed:', error));
    setTimeout(run, 60_000);
    this.timer = setInterval(run, INTERVAL_MINUTES * 60_000);
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
   * Tells whether an administrator allowed external sources on this instance
   *
   * @returns {Promise<boolean>} - true once allowed
   */
  async allowed(): Promise<boolean> {
    if (this.preset) return true;
    const [row] = await this.db.select({ on: instance.externalSources }).from(instance).limit(1);
    return row?.on ?? false;
  }

  /**
   * Polls every source of the instance
   *
   * @returns {Promise<void>} - resolves once done; failures are stored on each source
   */
  async tick(): Promise<void> {
    if (!(await this.allowed())) return;
    for (const row of await this.db.select({ id: externalSources.id }).from(externalSources)) {
      await this.sync(row.id);
    }
  }

  /**
   * Fetches one source and replaces its copies; on failure the last copies stay and the error is stored
   *
   * @param id {string} - source
   * @returns {Promise<{ documents: number } | { error: string }>} - documents kept, or the failure code
   */
  async sync(id: string): Promise<{ documents: number } | { error: string }> {
    if (!(await this.allowed())) return { error: 'external_not_allowed' };
    if (!this.secretsKey) return { error: 'secrets_key_missing' };
    const [row] = await this.db.select().from(externalSources).where(eq(externalSources.id, id));
    if (!row) return { error: 'not_found' };
    try {
      const feed = await fetchFeed(row.url, decryptSecret(row.token, this.secretsKey), this.fetcher);
      const records = toLinked(feed, row.id);
      await this.db.transaction(async (tx) => {
        for (const [table, items] of [
          [externalClients, records.clients],
          [externalDocuments, records.documents],
        ] as const) {
          await tx.delete(table).where(eq(table.linkId, row.id));
          for (let start = 0; start < items.length; start += 500) {
            await tx
              .insert(table)
              .values(
                items
                  .slice(start, start + 500)
                  .map((data) => ({ linkId: row.id, remoteId: data.id, data })) as never,
              )
              .onConflictDoNothing();
          }
        }
        await tx
          .update(externalSources)
          .set({ syncedAt: new Date(), error: null })
          .where(eq(externalSources.id, row.id));
      });
      this.onChange?.(row.companyId);
      return { documents: records.documents.length };
    } catch (error) {
      const code = error instanceof FeedError ? error.message : 'feed_failed';
      if (!(error instanceof FeedError)) console.warn('External source failed:', error);
      await this.db.update(externalSources).set({ error: code }).where(eq(externalSources.id, row.id));
      return { error: code };
    }
  }
}

/**
 * Builds /api/settings/external-sources for the active company: list, add, edit, remove and poll on demand.
 * Tokens are stored encrypted and never sent back. Mount behind requireUser and requireCompany.
 *
 * @param db {Database} - Drizzle database
 * @param sources {ExternalSources} - polling service
 * @param secretsKey {Buffer | undefined} - key encrypting the tokens
 * @returns {Hono<AppEnv>} - the router
 */
export function externalSourceRoutes(
  db: Database,
  sources: ExternalSources,
  secretsKey: Buffer | undefined,
): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * Loads the source of the path, checked to belong to the active company
   *
   * @param c {Context<AppEnv>} - request
   * @returns {Promise<typeof externalSources.$inferSelect | undefined>} - the row
   */
  const owned = async (c: Context<AppEnv>) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return undefined;
    const [row] = await db
      .select()
      .from(externalSources)
      .where(and(eq(externalSources.id, id.data), eq(externalSources.companyId, c.var.company.id)));
    return row;
  };

  /**
   * Writes an audit entry for the active company
   *
   * @param c {Context<AppEnv>} - request
   * @param action {string} - audit action
   * @param source {string} - source id
   * @returns {Promise<void>} - resolves once written
   */
  const audit = async (c: Context<AppEnv>, action: string, source: string) => {
    await db
      .insert(auditLog)
      .values({ userId: c.var.user.id, action, meta: { company: c.var.company.id, source } });
  };

  /**
   * Refuses changes until an administrator allowed sources and SECRETS_KEY is set
   *
   * @returns {Promise<string | null>} - failure code, or null
   */
  const problem = async (): Promise<string | null> => {
    if (!(await sources.allowed())) return 'external_not_allowed';
    return secretsKey ? null : 'secrets_key_missing';
  };

  router.get('/', async (c) => {
    const rows = await db
      .select({ source: externalSources, documents: count(externalDocuments.remoteId) })
      .from(externalSources)
      .leftJoin(externalDocuments, eq(externalDocuments.linkId, externalSources.id))
      .where(eq(externalSources.companyId, c.var.company.id))
      .groupBy(externalSources.id)
      .orderBy(externalSources.createdAt);
    const list: ExternalSource[] = rows.map(({ source, documents }) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      test: source.test,
      syncedAt: source.syncedAt?.toISOString() ?? null,
      error: source.error,
      documents,
    }));
    return c.json({ allowed: await sources.allowed(), secretsKey: Boolean(secretsKey), sources: list });
  });

  router.post('/', async (c) => {
    const { data, response } = await parseBody(c, externalSourceInputSchema);
    if (response) return response;
    const failure = await problem();
    if (failure || !secretsKey) return c.json({ error: failure }, 409);
    if (!data.token) return c.json({ error: 'token_required' }, 422);
    const [row] = await db
      .insert(externalSources)
      .values({
        companyId: c.var.company.id,
        name: data.name,
        url: data.url,
        test: data.test,
        token: encryptSecret(data.token, secretsKey),
      })
      .returning({ id: externalSources.id });
    const id = row?.id ?? '';
    await audit(c, 'external.added', id);
    return c.json({ id, result: await sources.sync(id) }, 201);
  });

  router.patch('/:id', async (c) => {
    const { data, response } = await parseBody(c, externalSourceInputSchema);
    if (response) return response;
    const row = await owned(c);
    if (!row) return c.json({ error: 'not_found' }, 404);
    const failure = await problem();
    if (failure || !secretsKey) return c.json({ error: failure }, 409);
    // The token goes to the address: a new address needs the token typed again.
    if (data.url !== row.url && !data.token) return c.json({ error: 'token_required' }, 422);
    await db
      .update(externalSources)
      .set({
        name: data.name,
        url: data.url,
        test: data.test,
        ...(data.token && { token: encryptSecret(data.token, secretsKey) }),
      })
      .where(eq(externalSources.id, row.id));
    await audit(c, 'external.updated', row.id);
    return c.body(null, 204);
  });

  router.post('/:id/sync', async (c) => {
    const row = await owned(c);
    if (!row) return c.json({ error: 'not_found' }, 404);
    const result = await sources.sync(row.id);
    return 'error' in result ? c.json(result, 409) : c.json(result);
  });

  router.delete('/:id', async (c) => {
    const row = await owned(c);
    if (!row) return c.json({ error: 'not_found' }, 404);
    await db.delete(externalSources).where(eq(externalSources.id, row.id));
    await audit(c, 'external.removed', row.id);
    sources.onChange?.(row.companyId);
    return c.body(null, 204);
  });

  return router;
}
