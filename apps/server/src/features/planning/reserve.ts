import {
  activityBreakdown,
  computeEstimates,
  computeReserve,
  expandDeadlines,
  fiscalYearOf,
  packFeatures,
  type Receipt,
  type ReserveView,
  reserveSettingsSchema,
} from '@almanach/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { documents, payments, reserveSettings } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import type { PackRegistry } from '../packs/packs.ts';
import { instanceToday } from './planning.routes.ts';
import { attachedReceipts, type PlanningService, ruleProfile } from './planning.service.ts';

/**
 * Number of months of a fiscal year started on a date, the current one included
 *
 * @param start {string} - first day of the fiscal year
 * @param today {string} - YYYY-MM-DD
 * @returns {number} - months from 1 to 12
 */
export function monthsElapsed(start: string, today: string): number {
  const months =
    (Number(today.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
    Number(today.slice(5, 7)) -
    Number(start.slice(5, 7)) +
    (today.slice(8) >= start.slice(8) ? 1 : 0);
  return Math.min(12, Math.max(1, months));
}

/** The tax reserve of a company: what to keep aside for the taxes of the fiscal year not paid yet. */
export class ReserveService {
  /**
   * Creates the service
   *
   * @param db {Database} - Drizzle database
   * @param planning {PlanningService} - receipts, marks and profile
   * @param packs {PackRegistry} - country packs
   */
  constructor(
    private readonly db: Database,
    private readonly planning: PlanningService,
    private readonly packs: PackRegistry,
  ) {}

  /**
   * Settings of the reserve, with their defaults
   *
   * @param companyId {string} - company
   * @returns {Promise<{ marginBp: number | null; extraRateBp: number; extraMonthlyCents: number; extraNote: string | null; taxPartsQuarters: number; jointTaxation: boolean }>} - settings
   */
  async settings(companyId: string) {
    const [row] = await this.db
      .select()
      .from(reserveSettings)
      .where(eq(reserveSettings.companyId, companyId));
    return {
      marginBp: row?.marginBp ?? null,
      extraRateBp: row?.extraRateBp ?? 0,
      extraMonthlyCents: row?.extraMonthlyCents ?? 0,
      extraNote: row?.extraNote ?? null,
      taxPartsQuarters: row?.taxPartsQuarters ?? 4,
      jointTaxation: row?.jointTaxation ?? false,
    };
  }

  /**
   * Computes the reserve on a date
   *
   * @param companyId {string} - company
   * @param today {string} - YYYY-MM-DD
   * @param withoutPayment {string | undefined} - payment left out, to measure its share of the reserve
   * @returns {Promise<ReserveView | null>} - the reserve, or null when the pack has no reserve rules
   */
  async compute(companyId: string, today: string, withoutPayment?: string): Promise<ReserveView | null> {
    const profile = await this.planning.profile(companyId);
    const pack = profile && this.packs.get(profile.country);
    if (!profile || !pack) return null;
    const fiscal = fiscalYearOf(today, pack.fiscalYearStart);
    const found = this.packs.rules(pack.country, fiscal.year);
    const reserve = found?.rules.reserve;
    if (!found || !reserve || !packFeatures(pack).reserve) return null;
    const rules = found.rules;
    const settings = await this.settings(companyId);
    const household = { partsQuarters: settings.taxPartsQuarters, joint: settings.jointTaxation };
    const facts = ruleProfile(profile, await this.planning.activities(companyId), household);
    const local = await this.planning.receipts(companyId, profile.currency, fiscal.start, fiscal.end);
    let receipts: Receipt[] = [
      ...local.receipts,
      ...attachedReceipts(
        await this.planning.linkedRevenue(companyId, profile.currency, fiscal.start),
      ).filter((receipt) => receipt.date <= fiscal.end),
    ];
    if (withoutPayment) receipts = await this.leaveOut(companyId, profile.currency, receipts, withoutPayment);

    // What was paid this fiscal year at the deadlines that settle the included estimates.
    const yearEstimates = computeEstimates(rules, facts, receipts, reserve.include);
    const marks = await this.planning.marks(companyId);
    const paid: Record<string, number> = {};
    const occurrences = expandDeadlines(rules, facts, this.packs.holidays(pack.country));
    for (const settle of reserve.settles) {
      if (settle.fiscalYear === 'previous') continue;
      for (const occurrence of occurrences) {
        if (occurrence.ruleId !== settle.deadline) continue;
        if (
          settle.fiscalYear === 'period' &&
          (!occurrence.periodStart ||
            occurrence.periodStart < fiscal.start ||
            occurrence.periodStart > fiscal.end)
        )
          continue;
        const mark = marks.get(occurrence.key);
        if (!mark?.doneOn) continue;
        const own = occurrence.estimates.filter((id) => reserve.include.includes(id));
        const ids = own.length > 0 ? own : reserve.include;
        const { periodStart, periodEnd } = occurrence;
        const periodEstimates =
          periodStart && periodEnd
            ? computeEstimates(
                rules,
                facts,
                receipts.filter((receipt) => receipt.date >= periodStart && receipt.date <= periodEnd),
                ids,
              )
            : null;
        const weights = (periodEstimates ?? yearEstimates.filter((item) => ids.includes(item.id))).filter(
          (item) => item.cents > 0,
        );
        if (mark.actualCents === null) {
          for (const item of periodEstimates ?? []) paid[item.id] = (paid[item.id] ?? 0) + item.cents;
          continue;
        }
        // The amount paid is shared between the estimates it settles in proportion to their size.
        const total = weights.reduce((sum, item) => sum + item.cents, 0);
        let left = mark.actualCents;
        weights.forEach((item, index) => {
          const share =
            index === weights.length - 1 ? left : Math.round((mark.actualCents ?? 0) * (item.cents / total));
          paid[item.id] = (paid[item.id] ?? 0) + share;
          left -= share;
        });
        const first = ids[0];
        if (weights.length === 0 && first) paid[first] = (paid[first] ?? 0) + mark.actualCents;
      }
    }

    const marginBp = settings.marginBp ?? reserve.marginBp;
    const result = computeReserve({
      rules,
      reserve,
      profile: facts,
      receipts,
      paid,
      marginBp,
      extraRateBp: settings.extraRateBp,
      extraMonthlyCents: settings.extraMonthlyCents,
      monthsElapsed: monthsElapsed(fiscal.start, today),
    });
    return {
      currency: profile.currency,
      reserveCents: result.reserveCents,
      estimatedCents: result.estimatedCents,
      marginCents: result.marginCents,
      paidCents: result.paidCents,
      revenueCents: result.revenueCents,
      byActivity: activityBreakdown(rules, facts, receipts, reserve.include).map((item) => ({
        status: item.status,
        main: item.main,
        revenueCents: item.revenueCents,
        estimateCents: item.estimateCents,
      })),
      components: result.components.map((item) => ({
        id: item.id,
        label: item.label,
        estimatedCents: item.cents,
        paidCents: item.paidCents,
        steps: item.steps,
        source: item.source,
        verifiedOn: item.verifiedOn,
      })),
      marginBp,
      packMarginBp: reserve.marginBp,
      extra: {
        rateBp: settings.extraRateBp,
        monthlyCents: settings.extraMonthlyCents,
        note: settings.extraNote,
        cents: result.extraCents,
      },
      household: {
        applies: rules.estimates.some(
          (rule) => reserve.include.includes(rule.id) && rule.formula.kind === 'fr_income_tax',
        ),
        ...household,
      },
      warning: reserve.warning,
      source: reserve.source,
      verifiedOn: reserve.verified_on,
      asOf: today,
      fiscalYear: { start: fiscal.start, end: fiscal.end },
      maturity: packFeatures(pack).reserve ?? null,
      unconverted: local.unconverted,
    };
  }

  /**
   * Removes the receipt of one payment from a list, to compute the reserve as if it had not been received
   *
   * @param companyId {string} - company
   * @param currency {string} - main currency
   * @param receipts {Receipt[]} - receipts
   * @param paymentId {string} - payment to leave out
   * @returns {Promise<Receipt[]>} - receipts without it
   */
  private async leaveOut(
    companyId: string,
    currency: string,
    receipts: Receipt[],
    paymentId: string,
  ): Promise<Receipt[]> {
    const [row] = await this.db
      .select({
        date: payments.date,
        amount: payments.amountCents,
        received: payments.receivedCents,
        currency: documents.currency,
      })
      .from(payments)
      .innerJoin(documents, eq(documents.id, payments.documentId))
      .where(and(eq(payments.id, paymentId), eq(payments.companyId, companyId)));
    if (!row) return receipts;
    const cents = row.currency === currency ? row.amount : row.received;
    const index = receipts.findIndex((receipt) => receipt.date === row.date && receipt.cents === cents);
    return index < 0 ? receipts : receipts.filter((_, position) => position !== index);
  }

  /**
   * Share of the reserve brought by one payment: the reserve now minus the reserve without it
   *
   * @param companyId {string} - company
   * @param paymentId {string} - payment just recorded
   * @param today {string} - YYYY-MM-DD
   * @returns {Promise<number | null>} - amount to keep aside, null when the country has no reserve
   */
  async shareOf(companyId: string, paymentId: string, today: string): Promise<number | null> {
    const now = await this.compute(companyId, today);
    if (!now) return null;
    const before = await this.compute(companyId, today, paymentId);
    return Math.max(0, now.reserveCents - (before?.reserveCents ?? 0));
  }
}

/**
 * Builds /api/reserve: the reserve of the active company and its settings. Mount behind requireUser and
 * requireCompany.
 *
 * @param db {Database} - Drizzle database
 * @param reserve {ReserveService} - reserve computation
 * @returns {Hono<AppEnv>} - the router
 */
export function reserveRoutes(db: Database, reserve: ReserveService): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const view = await reserve.compute(c.var.company.id, await instanceToday(db));
    return view ? c.json({ reserve: view }) : c.json({ error: 'feature_unavailable' }, 404);
  });

  router.put('/settings', async (c) => {
    const { data, response } = await parseBody(c, reserveSettingsSchema);
    if (response) return response;
    const values = { ...data, extraNote: data.extraNote || null };
    await db
      .insert(reserveSettings)
      .values({ companyId: c.var.company.id, ...values })
      .onConflictDoUpdate({
        target: reserveSettings.companyId,
        set: { ...values, updatedAt: new Date() },
      });
    return c.body(null, 204);
  });

  return router;
}
