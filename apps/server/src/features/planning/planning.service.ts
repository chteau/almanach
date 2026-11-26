import {
  activityBreakdown,
  addDays,
  computeEstimates,
  type DeadlineNotice,
  type DeadlineOccurrence,
  deductibleCents,
  type EstimateResult,
  type ExpenseItem,
  expandDeadlines,
  fiscalYearOf,
  type InvoicedItem,
  invoiceStatus,
  type Localized,
  measureThresholds,
  type PackMeta,
  type PreparedDeclaration,
  type PrepareMethod,
  packFeatures,
  prepareDeclaration,
  type Receipt,
  type RuleProfile,
  type Situation,
  type ThresholdProgress,
  type Totals,
} from '@almanach/shared';
import { and, asc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import {
  clients,
  companies,
  companyActivities,
  customDeadlines,
  deadlineMarks,
  deadlineNotices,
  documents,
  expenses,
  externalRevenues,
  federationLinks,
  federationTotals,
  instance,
  missions,
  payments,
  profiles,
  reserveSettings,
  situationChanges,
} from '../../db/schema.ts';
import { vatModeFor } from '../documents/vat.ts';
import type { PackRegistry } from '../packs/packs.ts';

type ProfileRow = typeof profiles.$inferSelect;
type MarkRow = typeof deadlineMarks.$inferSelect;

export const CALENDAR_TYPES = ['tax', 'social', 'mission', 'invoice', 'custom'] as const;
export type CalendarType = (typeof CALENDAR_TYPES)[number];

/** One entry of the calendar, whatever its origin (S-061). */
export interface CalendarItem {
  key: string;
  type: CalendarType;
  /** Localized label for pack deadlines, plain text otherwise. */
  title: Localized | string;
  date: string;
  movedFrom: string | null;
  link: string | null;
  done: boolean;
  hidden: boolean;
  overdue: boolean;
}

/** Revenue collected and what is still missing to convert it (S-047, section 8 partial data). */
export interface ReceiptSet {
  receipts: Receipt[];
  /** Payments in a foreign currency without the amount received in the main currency. */
  unconverted: number;
}

/**
 * Splits an activity into periods with one situation each: before the first change, between changes,
 * and up to the cessation (S-231 to S-233)
 *
 * @param profile {ProfileRow} - current profile, holding the latest situation
 * @param changes {{ effectiveOn: string; before: Situation; after: Situation }[]} - changes in date order
 * @returns {{ from: string; to: string | null; profile: ProfileRow }[]} - periods
 */
export function situationPeriods(
  profile: ProfileRow,
  changes: { effectiveOn: string; before: Situation; after: Situation }[],
): { from: string; to: string | null; profile: ProfileRow }[] {
  const list: { from: string; to: string | null; profile: ProfileRow }[] = [];
  let from = profile.activityStart;
  let current: ProfileRow = changes[0] ? { ...profile, ...changes[0].before } : profile;
  for (const change of changes) {
    list.push({ from, to: addDays(change.effectiveOn, -1), profile: current });
    from = change.effectiveOn;
    current = { ...profile, ...change.after };
  }
  list.push({ from, to: profile.ceasedOn, profile: current });
  return list;
}

/**
 * Turns a person's profile into the facts rules depend on
 *
 * @param profile {ProfileRow} - stored profile
 * @param activities {string[]} - statuses of the secondary activities
 * @param household {RuleProfile['household']} - tax household from the reserve settings, when known
 * @returns {RuleProfile} - status, options, period, activity start, secondary activities and household
 */
export function ruleProfile(
  profile: ProfileRow,
  activities: string[] = [],
  household?: RuleProfile['household'],
): RuleProfile {
  return {
    status: profile.status,
    options: profile.options,
    declarationPeriod: profile.declarationPeriod,
    activityStart: profile.activityStart,
    activities,
    ...(household && { household }),
  };
}

/** Revenue of a linked instance, attached or not to an activity of the company. */
export interface LinkedRevenue {
  id: string;
  label: string;
  receivedAt: string | null;
  error: string | null;
  /** Activity the revenue counts as ("main" or a secondary status); null: thresholds only, by category. */
  activity: string | null;
  receipts: Receipt[];
}

/** Deadlines, revenue, estimates and thresholds for one person (P04, P05, P06, P18). */
export class PlanningService {
  /**
   * Creates the service
   *
   * @param db {Database} - Drizzle database
   * @param packs {PackRegistry} - country packs and their yearly rules
   * @param federationPreset {boolean} - links allowed by the server configuration (FEDERATION=true)
   */
  constructor(
    private readonly db: Database,
    readonly packs: PackRegistry,
    private readonly federationPreset = false,
  ) {}

  /**
   * Loads a profile
   *
   * @param companyId {string} - owner
   * @returns {Promise<ProfileRow | undefined>} - the profile once onboarding is done
   */
  async profile(companyId: string): Promise<ProfileRow | undefined> {
    const [row] = await this.db.select().from(profiles).where(eq(profiles.companyId, companyId)).limit(1);
    return row;
  }

  /**
   * Tells whether a status exists in the pack of a country
   *
   * @param country {string} - country code
   * @param status {string} - status id
   * @returns {boolean} - true when the pack lists it
   */
  knownStatus(country: string, status: string): boolean {
    return this.packs.get(country)?.statuses.some((item) => item.id === status) ?? false;
  }

  /**
   * Statuses of the secondary activities of a company
   *
   * @param companyId {string} - company
   * @returns {Promise<string[]>} - statuses, oldest first
   */
  async activities(companyId: string): Promise<string[]> {
    const rows = await this.db
      .select({ status: companyActivities.status })
      .from(companyActivities)
      .where(eq(companyActivities.companyId, companyId))
      .orderBy(asc(companyActivities.createdAt));
    return rows.map((row) => row.status);
  }

  /**
   * Tax household of a company (French income tax parts), from its reserve settings
   *
   * @param companyId {string} - company
   * @returns {Promise<NonNullable<RuleProfile['household']>>} - parts in quarters and joint taxation; one part by default
   */
  async household(companyId: string): Promise<NonNullable<RuleProfile['household']>> {
    const [row] = await this.db
      .select({ partsQuarters: reserveSettings.taxPartsQuarters, joint: reserveSettings.jointTaxation })
      .from(reserveSettings)
      .where(eq(reserveSettings.companyId, companyId));
    return row ?? { partsQuarters: 4, joint: false };
  }

  /**
   * Money collected between two dates, in the main currency
   *
   * @param companyId {string} - owner
   * @param mainCurrency {string} - profile currency
   * @param from {string} - first day, inclusive
   * @param to {string} - last day, inclusive
   * @returns {Promise<ReceiptSet>} - receipts, with the status of their secondary activity, and the count of
   * payments that could not be converted
   */
  async receipts(companyId: string, mainCurrency: string, from: string, to: string): Promise<ReceiptSet> {
    const rows = await this.db
      .select({
        date: payments.date,
        amount: payments.amountCents,
        received: payments.receivedCents,
        currency: documents.currency,
        totals: documents.totals,
        category: companyActivities.status,
      })
      .from(payments)
      .innerJoin(documents, eq(documents.id, payments.documentId))
      // A payment without activity follows its document; a document without activity is the main one's.
      .leftJoin(
        companyActivities,
        eq(companyActivities.id, sql`coalesce(${payments.activityId}, ${documents.activityId})`),
      )
      .where(and(eq(payments.companyId, companyId), gte(payments.date, from), lte(payments.date, to)));
    const external = await this.db
      .select({
        date: externalRevenues.date,
        amount: externalRevenues.amountCents,
        received: externalRevenues.receivedCents,
        currency: externalRevenues.currency,
        totals: sql<Totals | null>`null`,
        category: sql<string | null>`null`,
      })
      .from(externalRevenues)
      .where(
        and(
          eq(externalRevenues.companyId, companyId),
          gte(externalRevenues.date, from),
          lte(externalRevenues.date, to),
          // Stripe test mode is never revenue.
          sql`${externalRevenues.livemode} is not false`,
        ),
      );
    const receipts: Receipt[] = [];
    let unconverted = 0;
    for (const row of [...rows, ...external]) {
      const category = row.category ? { category: row.category } : {};
      if (row.currency === mainCurrency) {
        receipts.push({ date: row.date, cents: netOfVat(row.amount, row.totals), ...category });
      } else if (row.received !== null) {
        receipts.push({ date: row.date, cents: netOfVat(row.received, row.totals), ...category });
      } else unconverted += 1;
    }
    return { receipts, unconverted };
  }

  /**
   * Revenue of the other activities of the same business, received from linked instances (docs/federation.md);
   * empty unless links are allowed and on for the company
   *
   * @param companyId {string} - owner
   * @param mainCurrency {string} - profile currency; totals in another currency are never stored
   * @param from {string} - first day; totals are monthly, dated on the first of their month
   * @returns {Promise<LinkedRevenue[]>} - one entry per link; an attached link's receipts take its activity's status
   */
  async linkedRevenue(companyId: string, mainCurrency: string, from: string): Promise<LinkedRevenue[]> {
    if (!this.federationPreset) {
      const [row] = await this.db.select({ on: instance.federation }).from(instance).limit(1);
      if (!row?.on) return [];
    }
    const rows = await this.db
      .select({
        id: federationLinks.id,
        label: federationLinks.peerLabel,
        receivedAt: federationLinks.receivedAt,
        error: federationLinks.error,
        activityMain: federationLinks.activityMain,
        activityStatus: companyActivities.status,
        month: federationTotals.month,
        category: federationTotals.category,
        cents: federationTotals.cents,
      })
      .from(federationLinks)
      .innerJoin(companies, and(eq(companies.id, federationLinks.companyId), eq(companies.federation, true)))
      .innerJoin(federationTotals, eq(federationTotals.linkId, federationLinks.id))
      .leftJoin(companyActivities, eq(companyActivities.id, federationLinks.activityId))
      .where(
        and(
          eq(federationLinks.companyId, companyId),
          eq(federationLinks.state, 'active'),
          eq(federationLinks.receive, true),
          eq(federationLinks.peerCurrency, mainCurrency),
          gte(federationTotals.month, from.slice(0, 7)),
        ),
      );
    const links = new Map<string, LinkedRevenue>();
    for (const row of rows) {
      const link = links.get(row.id) ?? {
        id: row.id,
        label: row.label ?? '',
        receivedAt: row.receivedAt?.toISOString() ?? null,
        error: row.error,
        activity: row.activityMain ? 'main' : row.activityStatus,
        receipts: [],
      };
      // Attached to the main activity: no category, as for local receipts.
      const category = row.activityMain ? {} : { category: row.activityStatus ?? row.category };
      link.receipts.push({ date: `${row.month}-01`, cents: row.cents, ...category, linked: true });
      links.set(row.id, link);
    }
    return [...links.values()];
  }

  /**
   * Pack obligations of every fiscal year overlapping a date range, with fallback information
   *
   * @param profile {ProfileRow} - stored profile
   * @param pack {PackMeta} - country pack
   * @param from {string} - first day
   * @param to {string} - last day
   * @param activities {string[]} - statuses of the secondary activities
   * @returns {DeadlineOccurrence[]} - occurrences due within the range
   */
  packDeadlines(
    profile: ProfileRow,
    pack: PackMeta,
    from: string,
    to: string,
    activities: string[] = [],
  ): DeadlineOccurrence[] {
    const holidays = this.packs.holidays(pack.country);
    const facts = ruleProfile(profile, activities);
    const first = fiscalYearOf(from, pack.fiscalYearStart).year - 1;
    const last = fiscalYearOf(to, pack.fiscalYearStart).year;
    const out: DeadlineOccurrence[] = [];
    for (let year = first; year <= last; year += 1) {
      const found = this.packs.rules(pack.country, year);
      if (!found || found.fallback) continue;
      for (const item of expandDeadlines(found.rules, facts, holidays)) {
        if (item.due >= from && item.due <= to && item.due >= profile.activityStart) out.push(item);
      }
    }
    return out;
  }

  /**
   * Successive situations of a person: each status or country change starts a new one, and a cessation
   * ends the last one (S-231 to S-233)
   *
   * @param profile {ProfileRow} - current profile
   * @returns {Promise<{ from: string; to: string | null; profile: ProfileRow }[]>} - periods in date order
   */
  async segments(profile: ProfileRow): Promise<{ from: string; to: string | null; profile: ProfileRow }[]> {
    const changes = await this.db
      .select()
      .from(situationChanges)
      .where(eq(situationChanges.companyId, profile.companyId))
      .orderBy(asc(situationChanges.effectiveOn));
    return situationPeriods(profile, changes);
  }

  /**
   * Pack obligations across every situation: each occurrence follows the situation of the period it covers
   *
   * @param profile {ProfileRow} - current profile
   * @param from {string} - first day
   * @param to {string} - last day
   * @returns {Promise<{ occurrence: DeadlineOccurrence; profile: ProfileRow; pack: PackMeta }[]>} - occurrences
   */
  async situationDeadlines(
    profile: ProfileRow,
    from: string,
    to: string,
  ): Promise<{ occurrence: DeadlineOccurrence; profile: ProfileRow; pack: PackMeta }[]> {
    const out: { occurrence: DeadlineOccurrence; profile: ProfileRow; pack: PackMeta }[] = [];
    const activities = await this.activities(profile.companyId);
    for (const [index, segment] of (await this.segments(profile)).entries()) {
      const pack = this.packs.get(segment.profile.country);
      // The first situation keeps every obligation due after the start, as before any change existed.
      const lower = index === 0 ? '' : segment.from;
      if (!pack || (segment.to !== null && segment.to < segment.from)) continue;
      for (const occurrence of this.packDeadlines(segment.profile, pack, from, to, activities)) {
        // A declaration belongs to the situation of the period it covers, even when due after a change.
        const anchor = occurrence.periodStart ?? occurrence.due;
        if (anchor >= lower && (segment.to === null || anchor <= segment.to)) {
          out.push({ occurrence, profile: segment.profile, pack });
        }
      }
    }
    return out;
  }

  /**
   * Calendar entries between two dates (P05)
   *
   * @param companyId {string} - owner
   * @param from {string} - first day
   * @param to {string} - last day
   * @param today {string} - today, to flag overdue entries
   * @returns {Promise<CalendarItem[]>} - entries sorted by date
   */
  async calendar(companyId: string, from: string, to: string, today: string): Promise<CalendarItem[]> {
    const profile = await this.profile(companyId);
    if (!profile) return [];
    const marks = await this.marks(companyId);
    const items: CalendarItem[] = [];
    const mark = (key: string) => marks.get(key);
    // Obligations that fell due before the company was added were handled elsewhere: never flag them late.
    const [account] = await this.db
      .select({ createdAt: companies.createdAt })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    const since = account?.createdAt.toISOString().slice(0, 10) ?? today;
    for (const { occurrence } of await this.situationDeadlines(profile, from, to)) {
      const state = mark(occurrence.key);
      items.push({
        key: occurrence.key,
        type: occurrence.kind,
        title: occurrence.label,
        date: occurrence.due,
        movedFrom: occurrence.movedFrom,
        link: occurrence.link,
        done: Boolean(state?.doneOn),
        hidden: state?.hidden ?? false,
        overdue: !state?.doneOn && occurrence.due < today && occurrence.due >= since,
      });
    }

    for (const custom of await this.db
      .select()
      .from(customDeadlines)
      .where(eq(customDeadlines.companyId, companyId))) {
      for (const date of occurrencesOf(custom, from, to)) {
        const key = `custom:${custom.id}:${date}`;
        const state = mark(key);
        items.push({
          key,
          type: 'custom',
          title: custom.title,
          date,
          movedFrom: null,
          link: null,
          done: Boolean(state?.doneOn),
          hidden: state?.hidden ?? false,
          overdue: !state?.doneOn && date < today,
        });
      }
    }

    const missionRows = await this.db
      .select({ id: missions.id, name: missions.name, endDate: missions.endDate, status: missions.status })
      .from(missions)
      .where(and(eq(missions.companyId, companyId), gte(missions.endDate, from), lte(missions.endDate, to)));
    for (const mission of missionRows) {
      if (!mission.endDate || mission.status === 'cancelled') continue;
      items.push({
        key: `mission:${mission.id}`,
        type: 'mission',
        title: mission.name,
        date: mission.endDate,
        movedFrom: null,
        link: `/missions/${mission.id}`,
        done: mission.status === 'done',
        hidden: false,
        overdue: false,
      });
    }

    for (const invoice of await this.openInvoices(companyId, today)) {
      if (!invoice.dueDate || invoice.dueDate < from || invoice.dueDate > to) continue;
      items.push({
        key: `invoice:${invoice.id}`,
        type: 'invoice',
        title: `${invoice.number} · ${invoice.clientName}`,
        date: invoice.dueDate,
        movedFrom: null,
        link: `/documents/${invoice.id}`,
        done: false,
        hidden: false,
        overdue: invoice.dueDate < today,
      });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  }

  /**
   * Issued invoices not yet settled, with their status
   *
   * @param companyId {string} - owner
   * @param today {string} - YYYY-MM-DD
   * @returns {Promise<{ id: string; number: string; clientName: string; dueDate: string | null; currency: string; dueCents: number; status: string }[]>} - open invoices
   */
  async openInvoices(companyId: string, today: string) {
    const rows = await this.db
      .select({
        id: documents.id,
        number: documents.number,
        type: documents.type,
        dueDate: documents.dueDate,
        currency: documents.currency,
        totals: documents.totals,
        relatedId: documents.relatedId,
        clientName: clients.name,
      })
      .from(documents)
      .innerJoin(clients, eq(clients.id, documents.clientId))
      .where(
        and(
          eq(documents.companyId, companyId),
          ne(documents.state, 'draft'),
          inArray(documents.type, ['invoice', 'deposit', 'credit_note']),
        ),
      );
    const paid = new Map<string, number>();
    for (const row of await this.db
      .select({ documentId: payments.documentId, amount: payments.amountCents })
      .from(payments)
      .where(eq(payments.companyId, companyId))) {
      paid.set(row.documentId, (paid.get(row.documentId) ?? 0) + row.amount);
    }
    const credited = new Map<string, number>();
    for (const row of rows) {
      if (row.type === 'credit_note' && row.relatedId) {
        credited.set(row.relatedId, (credited.get(row.relatedId) ?? 0) + row.totals.totalCents);
      }
    }
    return rows
      .filter((row) => row.type !== 'credit_note')
      .map((row) => {
        const paidCents = paid.get(row.id) ?? 0;
        const creditedCents = credited.get(row.id) ?? 0;
        const status = invoiceStatus(
          {
            state: 'issued',
            totalCents: row.totals.totalCents,
            paidCents,
            creditedCents,
            dueDate: row.dueDate,
          },
          today,
        );
        return {
          id: row.id,
          number: row.number ?? '',
          clientName: row.clientName,
          dueDate: row.dueDate,
          currency: row.currency,
          dueCents: Math.max(0, row.totals.totalCents - creditedCents - paidCents),
          status,
        };
      })
      .filter((row) => row.status !== 'paid' && row.status !== 'cancelled');
  }

  /**
   * Every mark of a person, keyed by deadline key
   *
   * @param companyId {string} - owner
   * @returns {Promise<Map<string, MarkRow>>} - marks
   */
  async marks(companyId: string): Promise<Map<string, MarkRow>> {
    const rows = await this.db.select().from(deadlineMarks).where(eq(deadlineMarks.companyId, companyId));
    return new Map(rows.map((row) => [row.key, row]));
  }

  /**
   * Full detail of a pack deadline: revenue of the period and estimated amounts (P06)
   *
   * @param companyId {string} - owner
   * @param key {string} - occurrence key
   * @returns {Promise<object | undefined>} - detail, undefined when unknown
   */
  async deadline(companyId: string, key: string) {
    const current = await this.profile(companyId);
    if (!current) return undefined;
    const [ruleId, anchor] = key.split(':');
    if (!ruleId || !anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return undefined;
    const year = Number(anchor.slice(0, 4));
    const span = await this.situationDeadlines(current, `${year - 1}-01-01`, `${year + 2}-12-31`);
    const found = span.find((item) => item.occurrence.key === key);
    if (!found) return undefined;
    const { occurrence, profile, pack } = found;
    const [mark] = await this.db
      .select()
      .from(deadlineMarks)
      .where(and(eq(deadlineMarks.companyId, companyId), eq(deadlineMarks.key, key)))
      .limit(1);
    let revenue: ReceiptSet | null = null;
    let estimates: EstimateResult[] = [];
    let activities: ReturnType<typeof activityBreakdown> = [];
    if (occurrence.periodStart && occurrence.periodEnd) {
      const { periodStart, periodEnd } = occurrence;
      const local = await this.receipts(companyId, profile.currency, periodStart, periodEnd);
      // One declaration covers every activity of the business, linked ones attached to an activity included.
      const linked = attachedReceipts(
        await this.linkedRevenue(companyId, profile.currency, periodStart),
      ).filter((receipt) => receipt.date <= periodEnd);
      revenue = { ...local, receipts: [...local.receipts, ...linked] };
      const rules = this.packs.rules(pack.country, fiscalYearOf(periodStart, pack.fiscalYearStart).year);
      const facts = {
        ...ruleProfile(profile, await this.activities(companyId), await this.household(companyId)),
        expensesCents: await this.expenseTotal(companyId, profile.currency, periodStart, periodEnd),
      };
      if (rules && occurrence.estimates.length > 0) {
        estimates = computeEstimates(rules.rules, facts, revenue.receipts, occurrence.estimates);
        if (facts.activities?.length)
          activities = activityBreakdown(rules.rules, facts, revenue.receipts, occurrence.estimates);
      }
    }
    const prepared = await this.prepared(companyId, occurrence, profile, pack, estimates);
    return {
      occurrence,
      prepared,
      revenueCents: revenue ? revenue.receipts.reduce((sum, receipt) => sum + receipt.cents, 0) : null,
      unconverted: revenue?.unconverted ?? 0,
      estimates,
      activities,
      currency: profile.currency,
      mark: mark
        ? {
            doneOn: mark.doneOn,
            note: mark.note,
            actualCents: mark.actualCents,
            declared: mark.declared,
            hidden: mark.hidden,
          }
        : null,
    };
  }

  /**
   * Notice entered for a deadline rule and fiscal year
   *
   * @param companyId {string} - owner
   * @param ruleId {string} - deadline rule
   * @param fiscalYear {number} - fiscal year
   * @returns {Promise<(DeadlineNotice & { note: string | null }) | null>} - the notice, null when none
   */
  async notice(
    companyId: string,
    ruleId: string,
    fiscalYear: number,
  ): Promise<(DeadlineNotice & { note: string | null }) | null> {
    const [row] = await this.db
      .select()
      .from(deadlineNotices)
      .where(
        and(
          eq(deadlineNotices.companyId, companyId),
          eq(deadlineNotices.ruleId, ruleId),
          eq(deadlineNotices.fiscalYear, fiscalYear),
        ),
      );
    if (!row) return null;
    return {
      perOccurrenceCents: row.perOccurrenceCents,
      priorYearTaxCents: row.priorYearTaxCents,
      priorYearIncomeCents: row.priorYearIncomeCents,
      method: row.method as PrepareMethod | null,
      note: row.note,
    };
  }

  /**
   * Invoices and credit notes issued between two dates, in the main currency (other currencies are left out)
   *
   * @param companyId {string} - owner
   * @param currency {string} - main currency
   * @param from {string} - first day
   * @param to {string} - last day
   * @returns {Promise<InvoicedItem[]>} - credit notes negative; deposits left out (the final invoice counts)
   */
  async invoiced(companyId: string, currency: string, from: string, to: string): Promise<InvoicedItem[]> {
    const rows = await this.db
      .select({
        date: documents.issueDate,
        type: documents.type,
        totals: documents.totals,
        vatMode: documents.vatMode,
        category: companyActivities.status,
      })
      .from(documents)
      .leftJoin(companyActivities, eq(companyActivities.id, documents.activityId))
      .where(
        and(
          eq(documents.companyId, companyId),
          ne(documents.state, 'draft'),
          inArray(documents.type, ['invoice', 'credit_note']),
          eq(documents.currency, currency),
          gte(documents.issueDate, from),
          lte(documents.issueDate, to),
        ),
      );
    return rows.map((row) => {
      const sign = row.type === 'credit_note' ? -1 : 1;
      return {
        date: row.date,
        netCents: sign * row.totals.netCents,
        vatRateBp: row.totals.vatRateBp,
        vatCents: sign * row.totals.vatCents,
        vatMode: row.vatMode,
        ...(row.category ? { category: row.category } : {}),
      };
    });
  }

  /**
   * Net and VAT of invoices and deposits split over the payments received between two dates, dated by payment, for
   * VAT on money collected (German Ist-Versteuerung); documents in another currency are left out
   *
   * @param companyId {string} - owner
   * @param currency {string} - main currency
   * @param from {string} - first day
   * @param to {string} - last day
   * @returns {Promise<InvoicedItem[]>} - one item per payment, its share of the document's net and VAT
   */
  async collected(companyId: string, currency: string, from: string, to: string): Promise<InvoicedItem[]> {
    const rows = await this.db
      .select({
        date: payments.date,
        amount: payments.amountCents,
        totals: documents.totals,
        vatMode: documents.vatMode,
        category: companyActivities.status,
      })
      .from(payments)
      .innerJoin(documents, eq(documents.id, payments.documentId))
      .leftJoin(
        companyActivities,
        eq(companyActivities.id, sql`coalesce(${payments.activityId}, ${documents.activityId})`),
      )
      .where(
        and(
          eq(payments.companyId, companyId),
          eq(documents.currency, currency),
          gte(payments.date, from),
          lte(payments.date, to),
        ),
      );
    return rows.map((row) => {
      // Deposits deducted from a final invoice were taxed when paid: each payment carries the document's VAT share.
      const gross = row.totals.netCents + row.totals.vatCents;
      const netCents = gross === 0 ? 0 : Math.round((row.amount * row.totals.netCents) / gross);
      return {
        date: row.date,
        netCents,
        vatRateBp: row.totals.vatRateBp,
        vatCents: row.amount - netCents,
        vatMode: row.vatMode,
        ...(row.category ? { category: row.category } : {}),
      };
    });
  }

  /**
   * Prepared declaration of an occurrence whose rule has a prepare block
   *
   * @param companyId {string} - owner
   * @param occurrence {DeadlineOccurrence} - the occurrence
   * @param profile {ProfileRow} - profile in force for it
   * @param pack {PackMeta} - country pack
   * @param estimates {EstimateResult[]} - estimates of its period
   * @returns {Promise<PreparedDeclaration | null>} - null when the rule prepares nothing
   */
  private async prepared(
    companyId: string,
    occurrence: DeadlineOccurrence,
    profile: ProfileRow,
    pack: PackMeta,
    estimates: EstimateResult[],
  ): Promise<PreparedDeclaration | null> {
    const periodStart = occurrence.periodStart ?? occurrence.due;
    const periodEnd = occurrence.periodEnd ?? occurrence.due;
    const fiscal = fiscalYearOf(periodStart, pack.fiscalYearStart);
    const found = this.packs.rules(pack.country, fiscal.year);
    const prepare = found?.rules.deadlines.find((rule) => rule.id === occurrence.ruleId)?.prepare;
    if (!found || !prepare || !packFeatures(pack).prepare) return null;
    const local = await this.receipts(companyId, profile.currency, fiscal.start, periodEnd);
    const linked = attachedReceipts(
      await this.linkedRevenue(companyId, profile.currency, fiscal.start),
    ).filter((receipt) => receipt.date <= periodEnd);
    // Earlier occurrences of the same rule this fiscal year, for the annualized method.
    const marks = await this.marks(companyId);
    const paidBeforeCents = [...marks.values()]
      .filter((mark) => {
        const [rule, anchor = ''] = mark.key.split(':');
        return rule === occurrence.ruleId && anchor >= fiscal.start && anchor < periodStart;
      })
      .reduce((sum, mark) => sum + (mark.actualCents ?? 0), 0);
    return prepareDeclaration({
      rules: found.rules,
      prepare,
      profile: ruleProfile(profile, await this.activities(companyId), await this.household(companyId)),
      receipts: [...local.receipts, ...linked],
      invoiced: await this.invoiced(companyId, profile.currency, fiscal.start, periodEnd),
      ...(prepare.collectedWithOption
        ? { collected: await this.collected(companyId, profile.currency, fiscal.start, periodEnd) }
        : {}),
      expenses: await this.expenses(companyId, profile.currency, fiscal.start, periodEnd),
      fiscalStart: fiscal.start,
      fiscalYear: fiscal.year,
      periodStart,
      periodEnd,
      estimatesCents: estimates.reduce((sum, item) => sum + item.cents, 0),
      notice: await this.notice(companyId, occurrence.ruleId, fiscal.year),
      paidBeforeCents,
    });
  }

  /**
   * Expenses recorded between two dates in the main currency; null when the country pack does not use expenses or
   * none was ever recorded, so a form box shows "to enter" rather than 0
   *
   * @param companyId {string} - owner
   * @param currency {string} - main currency
   * @param from {string} - first day
   * @param to {string} - last day
   * @returns {Promise<ExpenseItem[] | null>} - expenses, or null when not tracked
   */
  async expenses(
    companyId: string,
    currency: string,
    from: string,
    to: string,
  ): Promise<ExpenseItem[] | null> {
    const profile = await this.profile(companyId);
    const pack = profile && this.packs.get(profile.country);
    if (!pack || !packFeatures(pack).expenses) return null;
    const [any] = await this.db
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.companyId, companyId))
      .limit(1);
    if (!any) return null;
    const rows = await this.db
      .select({
        date: expenses.date,
        netCents: expenses.amountCents,
        vatCents: expenses.vatCents,
        category: expenses.category,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.companyId, companyId),
          eq(expenses.currency, currency),
          gte(expenses.date, from),
          lte(expenses.date, to),
        ),
      );
    return allowableExpenses(pack, profile.options, rows);
  }

  /**
   * Deductible total of the expenses between two dates, before reclaimable VAT, for the "profit" base of the
   * estimates (a category the pack only partly allows, such as US business meals, counts for its deductible share)
   *
   * @param companyId {string} - owner
   * @param currency {string} - main currency
   * @param from {string} - first day
   * @param to {string} - last day
   * @returns {Promise<number>} - cents, 0 when expenses are not tracked
   */
  async expenseTotal(companyId: string, currency: string, from: string, to: string): Promise<number> {
    const items = (await this.expenses(companyId, currency, from, to)) ?? [];
    const profile = await this.profile(companyId);
    const pack = profile && this.packs.get(profile.country);
    const rules =
      pack && this.packs.rules(pack.country, fiscalYearOf(from, pack.fiscalYearStart).year)?.rules;
    return items.reduce((sum, item) => sum + (rules ? deductibleCents(rules, item) : item.netCents), 0);
  }

  /**
   * Thresholds and yearly estimates, optionally with simulated extra revenue today (P18, S-213)
   *
   * @param companyId {string} - owner
   * @param today {string} - YYYY-MM-DD
   * @param simulateCents {number} - extra revenue to add on today's date
   * @returns {Promise<object | null>} - null when the country has no rules
   */
  async outlook(companyId: string, today: string, simulateCents = 0) {
    const profile = await this.profile(companyId);
    const pack = profile && this.packs.get(profile.country);
    if (!profile || !pack) return null;
    const fiscal = fiscalYearOf(today, pack.fiscalYearStart);
    const found = this.packs.rules(pack.country, fiscal.year);
    if (!found) return null;
    const previousStart = `${fiscal.year - 1}${fiscal.start.slice(4)}`;
    const rollingStart = addDays(`${Number(today.slice(0, 4)) - 1}${today.slice(4)}`, 1);
    const from = previousStart < rollingStart ? previousStart : rollingStart;
    const set = await this.receipts(companyId, profile.currency, from, fiscal.end);
    const receipts =
      simulateCents > 0 ? [...set.receipts, { date: today, cents: simulateCents }] : set.receipts;
    const facts = ruleProfile(profile, await this.activities(companyId), await this.household(companyId));
    // Thresholds count the whole business, linked activities included; estimates count the local activities and
    // the links attached to one of them.
    const linked = await this.linkedRevenue(companyId, profile.currency, from);
    const thresholds: ThresholdProgress[] = measureThresholds(
      found.rules,
      facts,
      [...receipts, ...linked.flatMap((link) => link.receipts)],
      fiscal,
      today,
      profile.priorRevenueCents,
    );
    const inYear = (receipt: Receipt) => receipt.date >= fiscal.start && receipt.date <= fiscal.end;
    const yearReceipts = receipts.filter(inYear);
    const estimated = [...yearReceipts, ...attachedReceipts(linked).filter(inYear)];
    // Expenses of the fiscal year lower the profit of the estimates to date; the projection keeps revenue only.
    const withExpenses = {
      ...facts,
      expensesCents: await this.expenseTotal(companyId, profile.currency, fiscal.start, fiscal.end),
    };
    const toDate = computeEstimates(found.rules, withExpenses, estimated);
    const elapsed = Math.max(1, Math.round((Date.parse(today) - Date.parse(fiscal.start)) / 86_400_000) + 1);
    const length = Math.round((Date.parse(fiscal.end) - Date.parse(fiscal.start)) / 86_400_000) + 1;
    const collected = yearReceipts.reduce((sum, receipt) => sum + receipt.cents, 0);
    const projectedRevenue = Math.round((collected * length) / elapsed);
    const projection = computeEstimates(
      found.rules,
      facts,
      scaleReceipts(estimated, length / elapsed, today),
    );
    const months = monthlyEstimates(found.rules, facts, estimated, fiscal.start);
    return {
      year: fiscal.year,
      fiscalYear: fiscal,
      rulesYear: found.rules.year,
      fallback: found.fallback,
      // Maturity of the country and of each function; a function absent from `features` is unavailable.
      pack: { country: pack.country, maturity: pack.maturity, features: packFeatures(pack) },
      currency: profile.currency,
      collectedCents: collected,
      projectedRevenueCents: projectedRevenue,
      unconverted: set.unconverted,
      thresholds,
      activities: activityBreakdown(found.rules, withExpenses, estimated),
      linked: linked.map(({ receipts: list, id: _id, ...link }) => ({
        ...link,
        cents: list
          .filter((receipt) => receipt.date >= fiscal.start && receipt.date <= fiscal.end)
          .reduce((sum, receipt) => sum + receipt.cents, 0),
      })),
      estimates: toDate,
      projection,
      months,
    };
  }
}

/**
 * Dates of a custom deadline within a range
 *
 * @param custom {typeof customDeadlines.$inferSelect} - the deadline
 * @param from {string} - first day
 * @param to {string} - last day
 * @returns {string[]} - occurrence dates
 */
export function occurrencesOf(
  custom: typeof customDeadlines.$inferSelect,
  from: string,
  to: string,
): string[] {
  if (custom.recurrence === 'none') return custom.date >= from && custom.date <= to ? [custom.date] : [];
  const step = custom.recurrence === 'monthly' ? 1 : custom.recurrence === 'quarterly' ? 3 : 12;
  const [year, month, day] = custom.date.split('-').map(Number) as [number, number, number];
  const dates: string[] = [];
  for (let index = 0; index < 600; index += 1) {
    const target = new Date(Date.UTC(year, month - 1 + index * step, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, last));
    const date = target.toISOString().slice(0, 10);
    if (date > to || (custom.until && date > custom.until)) break;
    if (date >= from) dates.push(date);
  }
  return dates;
}

/**
 * Receipts of the links attached to an activity of the company, the only linked revenue estimates count
 *
 * @param links {LinkedRevenue[]} - revenue of the linked instances
 * @returns {Receipt[]} - their receipts, with the status of the activity they are attached to
 */
export function attachedReceipts(links: LinkedRevenue[]): Receipt[] {
  return links.filter((link) => link.activity !== null).flatMap((link) => link.receipts);
}

/**
 * Projects each activity's revenue over the whole year at its current pace, so flat-rate segments keep their
 * dates and every activity its own rates
 *
 * @param receipts {Receipt[]} - receipts so far
 * @param factor {number} - length of the year divided by the days elapsed
 * @param today {string} - date the rest is assumed to arrive from
 * @returns {Receipt[]} - receipts plus one remainder per activity
 */
function scaleReceipts(receipts: Receipt[], factor: number, today: string): Receipt[] {
  const totals = new Map<string | undefined, number>();
  for (const receipt of receipts)
    totals.set(receipt.category, (totals.get(receipt.category) ?? 0) + receipt.cents);
  const rest = [...totals].flatMap(([category, cents]) => {
    const remainder = Math.round(cents * factor) - cents;
    return remainder > 0
      ? [{ date: today, cents: remainder, ...(category === undefined ? {} : { category }) }]
      : [];
  });
  return [...receipts, ...rest];
}

/**
 * Month-by-month estimates of the fiscal year so far (S-214)
 *
 * @param rules {Parameters<typeof computeEstimates>[0]} - rules of the year
 * @param facts {RuleProfile} - profile facts
 * @param receipts {Receipt[]} - receipts of the fiscal year
 * @param start {string} - first day of the fiscal year
 * @returns {{ month: string; revenueCents: number; estimateCents: number }[]} - twelve months
 */
function monthlyEstimates(
  rules: Parameters<typeof computeEstimates>[0],
  facts: RuleProfile,
  receipts: Receipt[],
  start: string,
): { month: string; revenueCents: number; estimateCents: number }[] {
  const out: { month: string; revenueCents: number; estimateCents: number }[] = [];
  const flatIds = rules.estimates.filter((rule) => rule.formula.kind === 'flat').map((rule) => rule.id);
  for (let index = 0; index < 12; index += 1) {
    const first = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1 + index, 1));
    const month = first.toISOString().slice(0, 7);
    const inMonth = receipts.filter((receipt) => receipt.date.startsWith(month));
    const estimate = computeEstimates(rules, facts, inMonth, flatIds).reduce(
      (sum, item) => sum + item.cents,
      0,
    );
    out.push({
      month,
      revenueCents: inMonth.reduce((sum, receipt) => sum + receipt.cents, 0),
      estimateCents: estimate,
    });
  }
  return out;
}

/**
 * Part of a payment that is revenue: the VAT the invoice charged is collected for the State, never income, so a
 * payment counts in proportion of the document's amount before VAT (a deposit deduction keeps that proportion)
 *
 * @param cents {number} - amount paid, VAT included
 * @param totals {Totals | null} - totals of the paid document; null when the source already gives the amount before VAT
 * @returns {number} - the amount before VAT, in minor units
 */
export function netOfVat(cents: number, totals: Totals | null): number {
  if (!totals || totals.vatCents === 0) return cents;
  const gross = totals.netCents + totals.vatCents;
  return gross === 0 ? cents : Math.round((cents * totals.netCents) / gross);
}

/**
 * Expenses as the profit sees them: without VAT registration the VAT paid cannot be reclaimed and is part of the
 * cost (UK: https://www.gov.uk/hmrc-internal-manuals/business-income-manual/bim31535), so it moves to the net
 * amount and nothing is left to deduct as VAT
 *
 * @param pack {PackMeta} - country pack of the company
 * @param options {string[]} - options of the profile
 * @param rows {ExpenseItem[]} - expenses with the amount before VAT and the VAT paid
 * @returns {ExpenseItem[]} - the same expenses, VAT added to the net amount when it cannot be reclaimed
 */
export function allowableExpenses(pack: PackMeta, options: string[], rows: ExpenseItem[]): ExpenseItem[] {
  if (vatModeFor(pack, options, 'domestic', 'company') === 'standard') return rows;
  return rows.map((row) => ({ ...row, netCents: row.netCents + row.vatCents, vatCents: 0 }));
}
