import { z } from 'zod';
import { DECLARATION_PERIODS } from './packs.ts';

const localized = z.object({ fr: z.string().min(1), en: z.string().min(1), de: z.string().min(1) }).strict();
const ruleId = z.string().regex(/^[a-z0-9_]{1,60}$/);
const isoDate = z.iso.date();
const cents = z.number().int().min(0).max(100_000_000_000);
const basisPoints = z.number().int().min(0).max(10_000);

/** Every figure in a rule file states where it comes from and when a person last checked it. */
const sourced = {
  source: z.url({ protocol: /^https$/ }),
  verified_on: isoDate,
};

/**
 * Who a rule concerns. Every listed condition must hold; an empty object applies to everyone.
 * `options` all have to be chosen, `withoutOptions` none of them.
 */
export const appliesToSchema = z
  .object({
    statuses: z.array(z.string()).min(1).optional(),
    options: z.array(z.string()).min(1).optional(),
    withoutOptions: z.array(z.string()).min(1).optional(),
    periods: z.array(z.enum(DECLARATION_PERIODS)).min(1).optional(),
  })
  .strict();

export type AppliesTo = z.infer<typeof appliesToSchema>;

export const THRESHOLD_WINDOWS = ['fiscal_year', 'previous_fiscal_year', 'rolling_12_months'] as const;

/** A revenue ceiling to watch (VAT franchise, micro regime ceiling, VAT registration). */
export const thresholdSchema = z
  .object({
    id: ruleId,
    label: localized,
    appliesTo: appliesToSchema.default({}),
    window: z.enum(THRESHOLD_WINDOWS),
    limitCents: cents,
    /** Higher ceiling that triggers the consequence immediately, when the country has one. */
    toleranceCents: cents.optional(),
    consequence: localized,
    ...sourced,
  })
  .strict();

/** A share of revenue to set aside, possibly reduced for a while (ACRE) or changing mid-year. */
const flatEstimate = z
  .object({
    kind: z.literal('flat'),
    /** Successive rates; a rate applies to revenue collected from its `from` date. */
    rates: z.array(z.object({ from: isoDate, rateBp: basisPoints }).strict()).min(1),
    reduction: z
      .object({
        option: z.string(),
        /** Share of the normal rate that is still due, per start date of the activity. */
        steps: z.array(z.object({ startedFrom: isoDate, dueShareBp: basisPoints }).strict()).min(1),
        /** Number of calendar quarters after the start quarter during which the reduction applies. */
        quarters: z.number().int().min(1).max(12),
        note: localized,
      })
      .strict()
      .optional(),
  })
  .strict();

/** Progressive income tax with a tax-free allowance, optionally tapered (UK). */
const bracketEstimate = z
  .object({
    kind: z.literal('brackets'),
    allowanceCents: cents,
    taper: z
      .object({
        aboveCents: cents,
        reducePerCents: z.number().int().min(1),
        byCents: z.number().int().min(1),
      })
      .strict()
      .optional(),
    /** Bands above the allowance: rate applies up to `upToCents` of taxable income, the last one is open. */
    bands: z.array(z.object({ upToCents: cents.nullable(), rateBp: basisPoints }).strict()).min(1),
    /** Ids of other estimates whose half is deducted first (US: half of self-employment tax). */
    deductHalfOf: z.array(ruleId).default([]),
    /** Deduction of a share of business income, capped at that share of taxable income (US section 199A). */
    businessIncomeDeductionBp: basisPoints.optional(),
  })
  .strict();

/** UK Class 4 National Insurance: main rate between two limits, lower rate above. */
const profitBandEstimate = z
  .object({
    kind: z.literal('profit_bands'),
    bands: z.array(z.object({ fromCents: cents, rateBp: basisPoints }).strict()).min(1),
  })
  .strict();

/** US self-employment tax: Social Security up to a wage base, Medicare on everything. */
const usSelfEmploymentEstimate = z
  .object({
    kind: z.literal('us_self_employment'),
    netEarningsShareBp: basisPoints,
    socialSecurityBp: basisPoints,
    wageBaseCents: cents,
    medicareBp: basisPoints,
    minimumNetEarningsCents: cents,
  })
  .strict();

/** German income tax tariff of § 32a EStG: five zones with polynomial formulas. */
const deIncomeTaxEstimate = z
  .object({
    kind: z.literal('de_income_tax'),
    /** Upper limits of zones 1 to 4, in whole euros. */
    zones: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
    /** Coefficients as written in the law: zone 2 (a, b), zone 3 (a, b, c), zone 4 (rate, minus), zone 5 (rate, minus). */
    zone2: z.tuple([z.number(), z.number()]),
    zone3: z.tuple([z.number(), z.number(), z.number()]),
    zone4: z.tuple([z.number(), z.number()]),
    zone5: z.tuple([z.number(), z.number()]),
  })
  .strict();

export const estimateSchema = z
  .object({
    id: ruleId,
    label: localized,
    appliesTo: appliesToSchema.default({}),
    /** What the computation starts from. Revenue is what was collected; profit is revenue minus nothing yet. */
    base: z.enum(['revenue', 'profit']),
    formula: z.discriminatedUnion('kind', [
      flatEstimate,
      bracketEstimate,
      profitBandEstimate,
      usSelfEmploymentEstimate,
      deIncomeTaxEstimate,
    ]),
    ...sourced,
  })
  .strict();

/** When an obligation falls due. */
const scheduleSchema = z.discriminatedUnion('type', [
  /** One occurrence per month: due on `day` (or the last day) of the month `monthOffset` after the period. */
  z
    .object({
      type: z.literal('monthly'),
      day: z.union([z.number().int().min(1).max(28), z.literal('last')]),
      monthOffset: z.number().int().min(0).max(3),
    })
    .strict(),
  /** Explicit dates, with the period each one covers. */
  z
    .object({
      type: z.literal('dates'),
      dates: z
        .array(
          z
            .object({
              due: isoDate,
              periodStart: isoDate.optional(),
              periodEnd: isoDate.optional(),
              /** Exceptionally not moved to the next business day (announced by the administration). */
              fixed: z.boolean().optional(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
]);

export const DEADLINE_KINDS = ['tax', 'social'] as const;

/** A recurring tax or social obligation from the pack (P05, P06). */
export const deadlineRuleSchema = z
  .object({
    id: ruleId,
    kind: z.enum(DEADLINE_KINDS),
    label: localized,
    description: localized,
    appliesTo: appliesToSchema.default({}),
    schedule: scheduleSchema,
    /** Estimates whose amount for the period is shown on the deadline. */
    estimates: z.array(ruleId).default([]),
    /** Whether the revenue of the period has to be declared (prefilled from payments, S-080). */
    declaresRevenue: z.boolean().default(false),
    link: z.url({ protocol: /^https$/ }),
    ...sourced,
  })
  .strict();

export const holidaySchema = z
  .object({ date: isoDate, name: z.string().min(1), appliesTo: appliesToSchema.optional() })
  .strict();

/** Rules of one country for one fiscal year, loaded from packs/<cc>/<year>.yaml. */
export const yearRulesSchema = z
  .object({
    year: z.number().int().min(2020).max(2100),
    /** What happens when a deadline falls on a weekend or public holiday. */
    shift: z.enum(['next_business_day', 'none']),
    shiftSource: z.url({ protocol: /^https$/ }),
    holidays: z.array(holidaySchema),
    holidaysSource: z.url({ protocol: /^https$/ }),
    thresholds: z.array(thresholdSchema).default([]),
    estimates: z.array(estimateSchema).default([]),
    deadlines: z.array(deadlineRuleSchema).default([]),
  })
  .strict();

export type YearRules = z.infer<typeof yearRulesSchema>;
export type ThresholdRule = z.infer<typeof thresholdSchema>;
export type EstimateRule = z.infer<typeof estimateSchema>;
export type DeadlineRule = z.infer<typeof deadlineRuleSchema>;
export type Localized = z.infer<typeof localized>;
