import type { LinkedDetail, LinkedDocument, LinkedRecords } from '@almanach/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import {
  companies,
  externalClients,
  externalDocuments,
  externalSources,
  federationClients,
  federationDocuments,
  federationLinks,
  federationPayments,
} from '../../db/schema.ts';
import type { AppEnv } from '../../http/request.ts';

type Writer = Pick<Database, 'delete' | 'insert'>;

const TABLES = [
  ['clients', federationClients],
  ['documents', federationDocuments],
  ['payments', federationPayments],
] as const;

/**
 * Replaces the read-only copies kept for a link; null forgets them (either side stopped sharing the detail)
 *
 * @param db {Writer} - database or transaction
 * @param linkId {string} - link
 * @param detail {LinkedDetail | null} - snapshot received
 * @returns {Promise<void>} - resolves once stored
 */
export async function storeDetail(db: Writer, linkId: string, detail: LinkedDetail | null): Promise<void> {
  for (const [key, table] of TABLES) {
    await db.delete(table).where(eq(table.linkId, linkId));
    const rows = detail?.[key] ?? [];
    for (let start = 0; start < rows.length; start += 500) {
      await db
        .insert(table)
        .values(rows.slice(start, start + 500).map((data) => ({ linkId, remoteId: data.id, data })) as never)
        .onConflictDoNothing();
    }
  }
}

/**
 * Records received from the linked instances of a company whose detail this side keeps, and from its external
 * sources, tagged with their link or source; every record of a test source carries `test`
 *
 * @param db {Database} - Drizzle database
 * @param companyId {string} - company
 * @returns {Promise<LinkedRecords>} - sources and records, documents and payments newest first
 */
export async function linkedRecords(db: Database, companyId: string): Promise<LinkedRecords> {
  const links = (
    await db
      .select({ id: federationLinks.id, label: federationLinks.peerLabel, url: federationLinks.peerUrl })
      .from(federationLinks)
      .innerJoin(companies, and(eq(companies.id, federationLinks.companyId), eq(companies.federation, true)))
      .where(
        and(
          eq(federationLinks.companyId, companyId),
          eq(federationLinks.state, 'active'),
          eq(federationLinks.receive, true),
          eq(federationLinks.receiveDetail, true),
        ),
      )
  ).map((row) => ({
    id: row.id,
    label: row.label ?? row.url ?? '',
    url: row.url,
    kind: 'link' as const,
    test: false,
  }));
  const external = (
    await db
      .select({ id: externalSources.id, label: externalSources.name, test: externalSources.test })
      .from(externalSources)
      .where(eq(externalSources.companyId, companyId))
      .orderBy(externalSources.createdAt)
  ).map((row) => ({ ...row, url: null, kind: 'external' as const }));
  const testIds = new Set(external.filter((source) => source.test).map((source) => source.id));
  const read = async <T>(
    table: (typeof TABLES)[number][1] | typeof externalClients | typeof externalDocuments,
    sources: { id: string }[],
  ) =>
    sources.length === 0
      ? []
      : (
          await db
            .select()
            .from(table)
            .where(
              inArray(
                table.linkId,
                sources.map((source) => source.id),
              ),
            )
        ).map(
          (row) =>
            ({
              ...(row.data as T),
              linkId: row.linkId,
              ...(testIds.has(row.linkId) && { test: true }),
            }) as T & { linkId: string },
        );
  type Client = LinkedRecords['clients'][number];
  type Doc = LinkedRecords['documents'][number];
  return {
    sources: [...links, ...external],
    clients: [
      ...(await read<Client>(federationClients, links)),
      ...(await read<Client>(externalClients, external)),
    ],
    documents: [
      ...(await read<Doc>(federationDocuments, links)),
      ...(await read<Doc>(externalDocuments, external)),
    ].sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
    payments: (await read<LinkedRecords['payments'][number]>(federationPayments, links)).sort((a, b) =>
      b.date.localeCompare(a.date),
    ),
  };
}

/**
 * Tells whether a linked invoice is late on a date (test data never is); the status received may be a few minutes old
 *
 * @param doc {LinkedDocument} - linked document
 * @param today {string} - YYYY-MM-DD
 * @returns {boolean} - true for an unpaid invoice past its due date
 */
export function linkedOverdue(doc: LinkedDocument, today: string): boolean {
  return (
    !doc.test &&
    (doc.type === 'invoice' || doc.type === 'deposit') &&
    doc.dueCents > 0 &&
    doc.dueDate !== null &&
    doc.dueDate < today &&
    !['draft', 'paid', 'cancelled'].includes(doc.status)
  );
}

/**
 * Builds /api/linked: read-only records of the linked instances of the active company. There is no write route.
 * Mount behind requireUser and requireCompany.
 *
 * @param db {Database} - Drizzle database
 * @returns {Hono<AppEnv>} - the router
 */
export function linkedRoutes(db: Database): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  router.get('/', async (c) => c.json(await linkedRecords(db, c.var.company.id)));
  return router;
}
