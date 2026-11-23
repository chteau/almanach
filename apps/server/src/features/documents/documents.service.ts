import {
  addDays,
  computeTotals,
  type DocumentDraft,
  type DocumentType,
  type DocumentView,
  formatNumber,
  invoiceStatus,
  type Line,
  type NumberFamily,
  quoteStatus,
  sequenceYear,
  type VatMode,
  vatSituation,
} from '@almanach/shared';
import { and, eq, inArray, max, ne, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import {
  auditLog,
  clients,
  documents,
  numberSequences,
  type PartySnapshot,
  payments,
  profiles,
} from '../../db/schema.ts';
import { loadBilling, numberingFor } from '../billing/billing.ts';
import { ownerOf } from '../companies/companies.ts';
import type { PackRegistry } from '../packs/packs.ts';
import { mentionsFor, vatModeFor, vatRateFor } from './vat.ts';

export type DocumentRow = typeof documents.$inferSelect;
type ClientRow = typeof clients.$inferSelect;
type ProfileRow = typeof profiles.$inferSelect;

/** Families sharing one chronological number series. */
const FAMILY: Record<DocumentType, NumberFamily> = {
  invoice: 'invoice',
  deposit: 'invoice',
  credit_note: 'credit',
  quote: 'quote',
};

/** Reasons an issue request is refused, returned to the interface as-is. */
export type IssueError =
  | { error: 'not_draft' }
  | { error: 'missing_fields'; missing: string[] }
  | { error: 'date_before_last'; lastDate: string }
  | { error: 'credit_exceeds_invoice'; availableCents: number };

/** Document rules that need the database: drafts, computed fields, issuing and money received. */
export class DocumentService {
  /**
   * Creates the service
   *
   * @param db {Database} - Drizzle database
   * @param packs {PackRegistry} - country packs
   */
  constructor(
    private readonly db: Database,
    private readonly packs: PackRegistry,
  ) {}

  /**
   * Loads the profile of a user, which every document needs
   *
   * @param companyId {string} - user id
   * @returns {Promise<ProfileRow | undefined>} - profile, undefined before onboarding
   */
  async profile(companyId: string): Promise<ProfileRow | undefined> {
    const [row] = await this.db.select().from(profiles).where(eq(profiles.companyId, companyId)).limit(1);
    return row;
  }

  /**
   * Loads one of the user's clients
   *
   * @param companyId {string} - owner
   * @param clientId {string} - client id
   * @returns {Promise<ClientRow | undefined>} - client, undefined when absent or not owned
   */
  async client(companyId: string, clientId: string): Promise<ClientRow | undefined> {
    const [row] = await this.db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
      .limit(1);
    return row;
  }

  /**
   * Computes everything derived from a draft: VAT treatment, mentions and totals (never trusted from
   * the browser). Deposits deducted must be issued deposit invoices of the same client.
   *
   * @param companyId {string} - owner
   * @param draft {DocumentDraft} - validated draft
   * @param profile {ProfileRow} - seller profile
   * @param client {ClientRow} - client
   * @returns {Promise<Pick<DocumentRow, 'vatMode' | 'mentions' | 'totals' | 'depositIds'>>} - derived fields
   */
  async derive(companyId: string, draft: DocumentDraft, profile: ProfileRow, client: ClientRow) {
    const pack = this.packs.get(profile.country);
    const vatMode = vatModeFor(pack, profile.options, vatSituation(profile.country, client), client.kind);
    let depositIds: string[] = [];
    let depositsCents = 0;
    if (draft.type === 'invoice' && draft.depositIds.length > 0) {
      const deposits = await this.db
        .select({ id: documents.id, totals: documents.totals })
        .from(documents)
        .where(
          and(
            eq(documents.companyId, companyId),
            eq(documents.clientId, client.id),
            eq(documents.type, 'deposit'),
            eq(documents.state, 'issued'),
            inArray(documents.id, draft.depositIds),
          ),
        );
      depositIds = deposits.map((deposit) => deposit.id);
      depositsCents = deposits.reduce((sum, deposit) => sum + deposit.totals.totalCents, 0);
    }
    return {
      vatMode,
      mentions: mentionsFor(pack, vatMode, client.kind, draft.language),
      totals: computeTotals(
        draft.lines as Line[],
        draft.discountBp,
        vatRateFor(pack, vatMode),
        depositsCents,
      ),
      depositIds,
    };
  }

  /**
   * Builds the frozen seller and buyer snapshots printed on a document; the seller name gets the
   * pack's mandatory mention ("EI" in France, art. R526-27 Code de commerce) when missing
   *
   * @param profile {ProfileRow} - seller profile
   * @param client {ClientRow} - client
   * @returns {{ seller: PartySnapshot; buyer: PartySnapshot }} - snapshots
   */
  snapshots(profile: ProfileRow, client: ClientRow): { seller: PartySnapshot; buyer: PartySnapshot } {
    const mention = this.packs.get(profile.country)?.invoice.sellerNameMention;
    const named =
      mention && !profile.company.name.toLowerCase().includes(mention.toLowerCase())
        ? `${profile.company.name} ${mention}`
        : profile.company.name;
    return {
      seller: {
        name: named,
        address: profile.company.address,
        country: profile.country,
        email: profile.company.email,
        vatNumber: profile.identifiers.vat ?? null,
        identifiers: profile.identifiers,
        bank: profile.bank,
      },
      buyer: {
        name: client.name,
        address: client.address,
        country: client.country,
        email: client.contacts.find((contact) => contact.billing)?.email ?? client.email,
        vatNumber: client.vatNumber,
        identifiers: {},
      },
    };
  }

  /**
   * Lists what prevents issuing: lines, the pack's mandatory seller identifiers, addresses, and both VAT
   * numbers when the client accounts for VAT (reverse charge, art. 226 of Directive 2006/112/EC)
   *
   * @param profile {ProfileRow} - seller profile
   * @param client {ClientRow} - client
   * @param lines {Line[]} - document lines
   * @param vatMode {VatMode} - VAT treatment of the document
   * @returns {string[]} - missing items as stable codes, empty when complete
   */
  missing(profile: ProfileRow, client: ClientRow, lines: Line[], vatMode: VatMode): string[] {
    const pack = this.packs.get(profile.country);
    const missing: string[] = [];
    if (lines.length === 0) missing.push('lines');
    for (const identifier of pack?.invoice.requiredIdentifiers ?? []) {
      if (!profile.identifiers[identifier]) missing.push(`seller.${identifier}`);
    }
    if (!profile.company.address) missing.push('seller.address');
    if (pack?.invoice.requireClientAddress && !client.address) missing.push('client.address');
    if (vatMode === 'reverse_charge') {
      if (!profile.identifiers.vat) missing.push('seller.vat');
      if (!client.vatNumber) missing.push('client.vat');
    }
    return missing;
  }

  /**
   * Issues a draft: checks completeness and chronology, assigns the next number of its series under
   * a row lock, freezes seller and client details and recomputes every amount (S-166, S-171, S-174)
   *
   * @param companyId {string} - owner
   * @param id {string} - draft id
   * @returns {Promise<{ ok: true } | IssueError>} - success or why it was refused
   */
  async issue(companyId: string, id: string): Promise<{ ok: true } | IssueError> {
    return this.db.transaction(async (tx) => {
      const [doc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, id), eq(documents.companyId, companyId)))
        .for('update');
      if (doc?.state !== 'draft') return { error: 'not_draft' as const };
      const profile = await this.profile(companyId);
      const client = await this.client(companyId, doc.clientId);
      if (!profile || !client) return { error: 'missing_fields' as const, missing: ['profile'] };

      const missing = this.missing(profile, client, doc.lines, doc.vatMode);
      if (missing.length > 0) return { error: 'missing_fields' as const, missing };

      const family = FAMILY[doc.type];
      if (family !== 'quote') {
        const familyTypes =
          family === 'invoice' ? (['invoice', 'deposit'] as const) : (['credit_note'] as const);
        const [last] = await tx
          .select({ lastDate: max(documents.issueDate) })
          .from(documents)
          .where(
            and(
              eq(documents.companyId, companyId),
              inArray(documents.type, [...familyTypes]),
              ne(documents.state, 'draft'),
            ),
          );
        if (last?.lastDate && doc.issueDate < last.lastDate) {
          return { error: 'date_before_last' as const, lastDate: last.lastDate };
        }
      }

      const draft: DocumentDraft = {
        type: doc.type,
        clientId: doc.clientId,
        missionId: doc.missionId,
        issueDate: doc.issueDate,
        validUntil: doc.validUntil,
        language: doc.language,
        currency: doc.currency,
        lines: doc.lines,
        discountBp: doc.discountBp,
        note: doc.note,
        depositIds: doc.depositIds,
      };
      const derived = await this.derive(companyId, draft, profile, client);

      if (doc.type === 'credit_note' && doc.relatedId) {
        const [invoice] = await tx
          .select()
          .from(documents)
          .where(eq(documents.id, doc.relatedId))
          .for('update');
        const credited = await this.creditedCents(doc.relatedId);
        const available = (invoice?.totals.totalCents ?? 0) - credited;
        if (derived.totals.totalCents > available) {
          return { error: 'credit_exceeds_invoice' as const, availableCents: available };
        }
      }

      const year = Number(doc.issueDate.slice(0, 4));
      const format = numberingFor(
        (await loadBilling(tx, companyId, profile.country)).numbering,
        year,
        profile.country,
      );
      const [sequence] = await tx
        .insert(numberSequences)
        .values({ companyId, family, year: sequenceYear(format, year), last: 1 })
        .onConflictDoUpdate({
          target: [numberSequences.companyId, numberSequences.family, numberSequences.year],
          set: { last: sql`${numberSequences.last} + 1` },
        })
        .returning({ last: numberSequences.last });
      const number = formatNumber(format, family, year, sequence?.last ?? 1);

      await tx
        .update(documents)
        .set({
          ...derived,
          ...this.snapshots(profile, client),
          number,
          state: doc.type === 'quote' ? 'sent' : 'issued',
          dueDate:
            doc.type === 'quote' || doc.type === 'credit_note'
              ? null
              : addDays(doc.issueDate, client.paymentTermsDays),
          issuedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(documents.id, doc.id));
      await tx
        .insert(auditLog)
        .values({ userId: ownerOf(companyId), action: 'document.issued', meta: { id: doc.id, number } });
      return { ok: true as const };
    });
  }

  /**
   * Sum of issued credit notes against an invoice
   *
   * @param invoiceId {string} - invoice id
   * @returns {Promise<number>} - credited amount in cents
   */
  async creditedCents(invoiceId: string): Promise<number> {
    const rows = await this.db
      .select({ totals: documents.totals })
      .from(documents)
      .where(
        and(
          eq(documents.relatedId, invoiceId),
          eq(documents.type, 'credit_note'),
          eq(documents.state, 'issued'),
        ),
      );
    return rows.reduce((sum, row) => sum + row.totals.totalCents, 0);
  }

  /**
   * Lists documents with client names, payments and credits folded in
   *
   * @param companyId {string} - owner
   * @param today {string} - today, for overdue and expiry
   * @param id {string} - optional single document id
   * @returns {Promise<DocumentView[]>} - documents, newest first
   */
  async views(companyId: string, today: string, id?: string): Promise<DocumentView[]> {
    const rows = await this.db
      .select({ doc: documents, clientName: clients.name })
      .from(documents)
      .innerJoin(clients, eq(clients.id, documents.clientId))
      .where(and(eq(documents.companyId, companyId), id ? eq(documents.id, id) : undefined))
      .orderBy(sql`${documents.issueDate} desc, ${documents.createdAt} desc`);
    const ids = rows.map((row) => row.doc.id);
    const paid = new Map<string, number>();
    const credited = new Map<string, number>();
    if (ids.length > 0) {
      for (const payment of await this.db
        .select({
          documentId: payments.documentId,
          amount: sql<number>`sum(${payments.amountCents})::bigint`,
        })
        .from(payments)
        .where(inArray(payments.documentId, ids))
        .groupBy(payments.documentId)) {
        paid.set(payment.documentId, Number(payment.amount));
      }
    }
    for (const row of await this.db
      .select({ relatedId: documents.relatedId, totals: documents.totals })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.type, 'credit_note'),
          eq(documents.state, 'issued'),
        ),
      )) {
      if (row.relatedId)
        credited.set(row.relatedId, (credited.get(row.relatedId) ?? 0) + row.totals.totalCents);
    }
    return rows.map(({ doc, clientName }) => {
      const paidCents = paid.get(doc.id) ?? 0;
      const creditedCents = credited.get(doc.id) ?? 0;
      const status =
        doc.type === 'quote'
          ? quoteStatus(doc, today)
          : invoiceStatus(
              {
                state: doc.state,
                totalCents: doc.totals.totalCents,
                paidCents,
                creditedCents,
                dueDate: doc.dueDate,
              },
              today,
            );
      return {
        id: doc.id,
        type: doc.type,
        state: doc.state,
        status,
        number: doc.number,
        clientId: doc.clientId,
        clientName,
        missionId: doc.missionId,
        relatedId: doc.relatedId,
        issueDate: doc.issueDate,
        dueDate: doc.dueDate,
        validUntil: doc.validUntil,
        language: doc.language,
        currency: doc.currency,
        lines: doc.lines,
        discountBp: doc.discountBp,
        note: doc.note,
        vatMode: doc.vatMode,
        mentions: doc.mentions,
        totals: doc.totals,
        paidCents,
        creditedCents,
        depositIds: doc.depositIds,
        sentAt: doc.sentAt?.toISOString() ?? null,
        createdAt: doc.createdAt.toISOString(),
      };
    });
  }
}
