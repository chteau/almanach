import {
  addDays,
  daysBetween,
  type ReviewAction,
  type ReviewDeadline,
  type WeeklyReview,
} from '@almanach/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { clients, documents, instance, packBundles } from '../../db/schema.ts';
import type { AppEnv } from '../../http/request.ts';
import { instanceToday } from '../planning/planning.routes.ts';
import type { PlanningService } from '../planning/planning.service.ts';
import type { ReserveService } from '../planning/reserve.ts';

/** A quote without answer is worth a follow-up after this many days. */
const QUOTE_FOLLOW_UP_DAYS = 7;

/** Optional sections added by later functions (pipeline, vault). */
export interface ReviewSections {
  deals?: (companyId: string, today: string) => Promise<WeeklyReview['deals']>;
  vault?: (companyId: string, today: string) => Promise<WeeklyReview['vault']>;
}

/**
 * Monday and Sunday of the ISO week containing a date
 *
 * @param date {string} - YYYY-MM-DD
 * @returns {{ start: string; end: string }} - first and last day
 */
export function isoWeek(date: string): { start: string; end: string } {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const start = addDays(date, -((day + 6) % 7));
  return { start, end: addDays(start, 6) };
}

/** Builds the weekly review from the existing services; it computes nothing new. */
export class ReviewService {
  /**
   * Creates the service
   *
   * @param db {Database} - Drizzle database
   * @param planning {PlanningService} - calendar, receipts, invoices, outlook
   * @param reserve {ReserveService} - tax reserve
   * @param sections {ReviewSections} - sections of later functions
   */
  constructor(
    private readonly db: Database,
    private readonly planning: PlanningService,
    private readonly reserve: ReserveService,
    private readonly sections: ReviewSections = {},
  ) {}

  /**
   * Review of the week containing a date
   *
   * @param company {{ id: string; name: string }} - the company
   * @param date {string} - any day of the week, YYYY-MM-DD
   * @returns {Promise<WeeklyReview | null>} - null without profile
   */
  async weekly(company: { id: string; name: string }, date: string): Promise<WeeklyReview | null> {
    const profile = await this.planning.profile(company.id);
    if (!profile) return null;
    const [settings] = await this.db.select({ timezone: instance.timezone }).from(instance).limit(1);
    const today = await instanceToday(this.db);
    const week = isoWeek(date);
    const currency = profile.currency;

    const items = await this.planning.calendar(company.id, addDays(today, -366), addDays(today, 14), today);
    const pending = items.filter(
      (item) => !item.done && !item.hidden && ['tax', 'social', 'custom'].includes(item.type),
    );
    const deadline = async (item: (typeof items)[number]): Promise<ReviewDeadline> => {
      const detail = item.type === 'custom' ? undefined : await this.planning.deadline(company.id, item.key);
      return {
        key: item.key,
        type: item.type,
        title: item.title,
        date: item.date,
        link: item.type === 'custom' ? '/calendar' : `/calendar/${encodeURIComponent(item.key)}`,
        preparedAmountCents: detail?.prepared?.amount?.cents ?? null,
      };
    };
    const overdue = await Promise.all(pending.filter((item) => item.date < today).map(deadline));
    const next14Days = await Promise.all(pending.filter((item) => item.date >= today).map(deadline));

    const sum = async (from: string, to: string) =>
      (await this.planning.receipts(company.id, currency, from, to)).receipts.reduce(
        (total, receipt) => total + receipt.cents,
        0,
      );
    const invoices = (await this.planning.openInvoices(company.id, today)).map(
      ({ id, number, clientName, dueDate, currency: own, dueCents, status }) => ({
        id,
        number,
        clientName,
        dueDate,
        currency: own,
        dueCents,
        status,
      }),
    );
    const strip = ({ status: _status, ...invoice }: (typeof invoices)[number]) => invoice;
    const invoicesOverdue = invoices.filter((invoice) => invoice.status === 'overdue').map(strip);
    const invoicesDueThisWeek = invoices
      .filter((invoice) => invoice.status !== 'overdue' && invoice.dueDate && invoice.dueDate <= week.end)
      .map(strip);

    const quoteRows = await this.db
      .select({
        id: documents.id,
        number: documents.number,
        clientName: clients.name,
        issueDate: documents.issueDate,
        totals: documents.totals,
        currency: documents.currency,
      })
      .from(documents)
      .innerJoin(clients, eq(clients.id, documents.clientId))
      .where(
        and(
          eq(documents.companyId, company.id),
          eq(documents.type, 'quote'),
          inArray(documents.state, ['issued', 'sent']),
        ),
      );
    const awaitingAnswer = quoteRows
      .map((row) => ({
        id: row.id,
        number: row.number,
        clientName: row.clientName,
        issueDate: row.issueDate,
        ageDays: daysBetween(row.issueDate, today),
        totalCents: row.totals.totalCents,
        currency: row.currency,
      }))
      .sort((a, b) => b.ageDays - a.ageDays);

    const outlook = await this.planning.outlook(company.id, today);
    const thresholds = (outlook?.thresholds ?? [])
      .filter((item) => item.exceeded || item.reachedBp >= 8000)
      .map((item) => ({
        id: item.id,
        label: item.label,
        reachedBp: item.reachedBp,
        exceeded: item.exceeded,
      }));

    const reserveNow = await this.reserve.compute(company.id, today);
    const reserveBefore =
      reserveNow && (await this.reserve.compute(company.id, today, undefined, addDays(week.start, -1)));
    const deals = await this.sections.deals?.(company.id, today);
    const vault = await this.sections.vault?.(company.id, today);

    const actions: ReviewAction[] = [
      ...[...overdue, ...next14Days].map((item) => ({
        id: `deadline:${item.key}`,
        type: (item.preparedAmountCents ? 'payment' : 'declaration') as ReviewAction['type'],
        due: item.date,
        title: item.title,
        why: item.date < today ? 'deadline_overdue' : 'deadline_soon',
        amountCents: item.preparedAmountCents,
        currency: item.preparedAmountCents === null ? null : currency,
        link: item.link,
        source: null,
      })),
      ...invoicesOverdue.map((invoice) => ({
        id: `invoice:${invoice.id}`,
        type: 'invoice_overdue' as const,
        due: invoice.dueDate,
        title: `${invoice.number} · ${invoice.clientName}`,
        why: 'invoice_overdue',
        amountCents: invoice.dueCents,
        currency: invoice.currency,
        link: `/documents/${invoice.id}`,
        source: null,
      })),
      ...awaitingAnswer
        .filter((quote) => quote.ageDays >= QUOTE_FOLLOW_UP_DAYS)
        .map((quote) => ({
          id: `quote:${quote.id}`,
          type: 'quote_follow_up' as const,
          due: addDays(quote.issueDate, QUOTE_FOLLOW_UP_DAYS),
          title: `${quote.number ?? ''} · ${quote.clientName}`,
          why: 'quote_no_answer',
          amountCents: quote.totalCents,
          currency: quote.currency,
          link: `/documents/${quote.id}`,
          source: null,
        })),
      ...thresholds
        .filter((item) => item.exceeded)
        .map((item) => ({
          id: `threshold:${item.id}`,
          type: 'threshold' as const,
          due: null,
          title: item.label,
          why: 'threshold_exceeded',
          amountCents: null,
          currency: null,
          link: '/thresholds',
          source: null,
        })),
      ...[...(deals?.followUpsLate ?? []), ...(deals?.followUpsDue ?? [])].map((deal) => ({
        id: `deal:${deal.id}`,
        type: 'deal_follow_up' as const,
        due: deal.nextActionOn,
        title: `${deal.title} · ${deal.name}`,
        why: deal.nextActionOn < today ? 'deal_follow_up_late' : 'deal_follow_up',
        amountCents: null,
        currency: null,
        link: '/pipeline',
        source: null,
      })),
      ...[...(vault?.expired ?? []), ...(vault?.expiringWithin60Days ?? [])].map((item) => ({
        id: `vault:${item.id}`,
        type: 'vault_expiring' as const,
        due: item.expiresOn,
        title: item.title,
        why: item.expiresOn < today ? 'vault_expired' : 'vault_expiring',
        amountCents: null,
        currency: null,
        link: `/vault/${item.id}`,
        source: null,
      })),
    ];
    // Dated actions first, the earliest (most overdue) on top; undated ones (thresholds) after.
    actions.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.id.localeCompare(b.id));

    const notices: WeeklyReview['notices'] = [];
    const [bundle] = await this.db
      .select({ id: packBundles.id })
      .from(packBundles)
      .where(and(eq(packBundles.country, profile.country), isNull(packBundles.appliedAt)))
      .limit(1);
    if (bundle) notices.push('pack_update_available');
    if ((outlook?.unconverted ?? 0) > 0) notices.push('unconverted_payments');

    return {
      format: 'weeklyReview/1',
      company,
      week: { ...week, today, timezone: settings?.timezone ?? 'UTC' },
      currency,
      actions,
      deadlines: { overdue, next14Days },
      cash: {
        collectedThisWeekCents: await sum(week.start, week.end),
        collectedLastWeekCents: await sum(addDays(week.start, -7), addDays(week.start, -1)),
        invoicesOverdue,
        invoicesDueThisWeek,
      },
      quotes: { awaitingAnswer },
      thresholds,
      ...(reserveNow && {
        reserve: {
          reserveCents: reserveNow.reserveCents,
          deltaThisWeekCents: reserveNow.reserveCents - (reserveBefore?.reserveCents ?? 0),
          warning: reserveNow.warning,
        },
      }),
      ...(deals && { deals }),
      ...(vault && { vault }),
      notices,
      testDataExcluded: true,
    };
  }
}

/**
 * Builds /api/review: the weekly review of the active company. Mount behind requireUser and requireCompany.
 *
 * @param db {Database} - Drizzle database
 * @param review {ReviewService} - weekly review
 * @returns {Hono<AppEnv>} - the router
 */
export function reviewRoutes(db: Database, review: ReviewService): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  router.get('/weekly', async (c) => {
    const date = c.req.query('date') ?? (await instanceToday(db));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))
      return c.json({ error: 'invalid_date' }, 422);
    const result = await review.weekly({ id: c.var.company.id, name: c.var.company.name }, date);
    return result ? c.json({ review: result }) : c.json({ error: 'not_found' }, 404);
  });
  return router;
}
