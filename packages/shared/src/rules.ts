import { z } from 'zod';
import { EXPENSE_CATEGORIES } from './expenses.ts';
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
    /**
     * Limit in the fiscal year the activity starts, when the law sets another one there (German Kleinunternehmer:
     * 25,000 € instead of 100,000 €).
     */
    startYearLimitCents: cents.optional(),
    /**
     * Statuses whose revenue counts towards the limit when one business mixes activities (tracked in linked
     * instances); every activity counts when absent.
     */
    counts: z.array(z.string()).min(1).optional(),
    /**
     * "above" warns when revenue goes over the limit (registration, ceiling); "below" when it falls under it, e.g.
     * the UK VAT deregistration threshold.
     */
    direction: z.enum(['above', 'below']).default('above'),
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
    /**
     * Limits of that deduction (US section 199A): above `thresholdCents` of taxable income it phases out over
     * `phaseInCents` (no W-2 wages or qualified property assumed), and it is at least `minimumCents` when the
     * business income reaches `minimumIncomeCents`.
     */
    businessIncomeDeductionLimit: z
      .object({ thresholdCents: cents, phaseInCents: cents, minimumCents: cents, minimumIncomeCents: cents })
      .strict()
      .optional(),
  })
  .strict();

/** UK Class 4 National Insurance: main rate between two limits, lower rate above. */
const profitBandEstimate = z
  .object({
    kind: z.literal('profit_bands'),
    bands: z.array(z.object({ fromCents: cents, rateBp: basisPoints }).strict()).min(1),
    /** Share of the profit the bands apply to (US Additional Medicare Tax: 92.35 % net earnings). */
    baseShareBp: basisPoints.optional(),
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

/**
 * German Solidaritätszuschlag (SolZG): a rate of another person-wide estimate (income tax), nothing up to an
 * exemption limit (Freigrenze), then at most a share of the excess over that limit (Milderungszone).
 */
const deSolidarityEstimate = z
  .object({
    kind: z.literal('de_solidarity'),
    /** Id of the estimate it is levied on; must come earlier in the file and have the same scope. */
    of: ruleId,
    rateBp: basisPoints,
    exemptionCents: cents,
    excessRateBp: basisPoints,
  })
  .strict();

/** Share of tax relief lost below a ceiling (French décote), for one person or a couple taxed jointly. */
const decoteSchema = z.object({ limitCents: cents, baseCents: cents, rateBp: basisPoints }).strict();

/**
 * French progressive income tax: scale per part (quotient familial), capped benefit of the extra half-parts and
 * décote. The household (parts, joint taxation) comes from the person's settings.
 */
const frIncomeTaxEstimate = z
  .object({
    kind: z.literal('fr_income_tax'),
    /** Bands of income per part: rate applies up to `upToCents`, the last one is open. */
    bands: z.array(z.object({ upToCents: cents.nullable(), rateBp: basisPoints }).strict()).min(1),
    decote: z.object({ single: decoteSchema, couple: decoteSchema }).strict(),
    /** Most an extra half-part may lower the tax (plafonnement des effets du quotient familial). */
    halfPartCapCents: cents,
  })
  .strict();

export const estimateSchema = z
  .object({
    id: ruleId,
    label: localized,
    appliesTo: appliesToSchema.default({}),
    /**
     * What the computation starts from. Revenue is what was collected; profit is revenue minus nothing yet;
     * taxable is revenue minus the flat-rate allowance of each activity (micro regime).
     */
    base: z.enum(['revenue', 'profit', 'taxable']),
    /**
     * "activity": each activity computes it on its own revenue at its own rates (French micro contributions).
     * "person": computed once on the total of every activity, as progressive income tax, UK Class 4 or US
     * self-employment tax are. `deductHalfOf` may only name estimates of the same scope.
     */
    scope: z.enum(['activity', 'person']).default('activity'),
    formula: z.discriminatedUnion('kind', [
      flatEstimate,
      bracketEstimate,
      profitBandEstimate,
      usSelfEmploymentEstimate,
      deIncomeTaxEstimate,
      deSolidarityEstimate,
      frIncomeTaxEstimate,
    ]),
    ...sourced,
  })
  .strict();

/**
 * Flat-rate allowance of a micro tax regime: share of revenue deemed to be expenses, with a minimum amount.
 * With several activities, each one applies its own rate to its own revenue.
 */
export const allowanceSchema = z
  .object({
    id: ruleId,
    label: localized,
    appliesTo: appliesToSchema.default({}),
    rateBp: basisPoints,
    minimumCents: cents,
    /**
     * Deducted from the profit before the profit-based estimates are computed (UK trading allowance); otherwise
     * only shown as the taxable income left (French micro allowances).
     */
    deductsFromProfit: z.boolean().default(false),
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

/** Figures the core measures for a prepared declaration; the pack says which ones a form asks for. */
export const PREPARE_MEASURES = [
  'revenue',
  'vat_base',
  'vat_collected',
  'vat_mode_base',
  'expenses',
  'vat_deductible',
] as const;
/** How the amount paid at a deadline is prepared. */
export const PREPARE_METHODS = [
  'estimates',
  'lines',
  'prior_year_share',
  'user_entered',
  'annualized',
] as const;

/** One box of an official form: the core measure that fills it. */
const prepareLineSchema = z
  .object({
    id: ruleId,
    label: localized,
    measure: z.enum(PREPARE_MEASURES),
    /** Revenue of these activity statuses only (one line per activity on a mixed declaration). */
    statuses: z.array(z.string().min(1)).optional(),
    /** Line shown only when all these options are chosen / none of these (e.g. the Cipav box in France). */
    options: z.array(z.string().min(1)).min(1).optional(),
    withoutOptions: z.array(z.string().min(1)).min(1).optional(),
    /** vat_base / vat_collected: lines at this rate only. */
    vatRateBp: basisPoints.optional(),
    /** vat_mode_base: base of the operations in this mode. */
    vatMode: z.enum(['reverse_charge', 'export', 'franchise']).optional(),
    /** expenses: expenses of these categories only (one box per group of categories). */
    categories: z.array(z.enum(EXPENSE_CATEGORIES)).optional(),
  })
  .strict();

/** What a deadline asks to declare and pay, prepared from Almanach's figures (docs/specs, déclaration préparée). */
export const prepareSchema = z
  .object({
    /** Revenue counted when collected or when invoiced (issue date). */
    basis: z.enum(['collected', 'invoiced']),
    /** Option that switches the basis to collected (German Ist-Versteuerung, § 20 UStG). */
    collectedWithOption: z.string().optional(),
    /** The period of the occurrence, or the fiscal year up to its end (UK MTD cumulative updates). */
    span: z.enum(['period', 'fiscal_year_to_period_end']),
    lines: z.array(prepareLineSchema).default([]),
    amount: z
      .object({
        method: z.enum(PREPARE_METHODS),
        /** Methods the person may choose instead. */
        alternatives: z.array(z.enum(PREPARE_METHODS)).default([]),
        /** lines: lines added and subtracted (VAT collected minus deductible VAT). */
        add: z.array(ruleId).default([]),
        subtract: z.array(ruleId).default([]),
        /** prior_year_share: share of the previous year's tax due at each occurrence. */
        shareBp: basisPoints.optional(),
        /** prior_year_share: higher share when the previous year's income was above a limit (US 110 % rule). */
        higherIncome: z.object({ aboveCents: cents, shareBp: basisPoints }).strict().optional(),
        /** annualized: estimates whose yearly amount is annualized. */
        estimates: z.array(ruleId).default([]),
        /** annualized: per period ending on MM-DD, annualization factor and cumulative share of the year's tax. */
        periods: z
          .array(
            z
              .object({
                periodEnd: z.string().regex(/^\d{2}-\d{2}$/),
                factorBp: z.number().int().min(10_000).max(120_000),
                shareBp: basisPoints,
              })
              .strict(),
          )
          .default([]),
        warning: localized.optional(),
      })
      .strict()
      .optional(),
    note: localized.optional(),
    ...sourced,
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.lines.map((line) => line.id);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'duplicate_line' });
    for (const id of [...(value.amount?.add ?? []), ...(value.amount?.subtract ?? [])])
      if (!ids.includes(id)) context.addIssue({ code: 'custom', message: `unknown_line:${id}` });
    const methods = value.amount ? [value.amount.method, ...value.amount.alternatives] : [];
    if (methods.includes('prior_year_share') && value.amount?.shareBp === undefined)
      context.addIssue({ code: 'custom', message: 'share_missing' });
    if (methods.includes('annualized') && !value.amount?.periods.length)
      context.addIssue({ code: 'custom', message: 'periods_missing' });
  });

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
    /** Figures to copy into the form and amount to pay, prepared from Almanach's data. */
    prepare: prepareSchema.optional(),
    link: z.url({ protocol: /^https$/ }),
    ...sourced,
  })
  .strict();

export const holidaySchema = z
  .object({ date: isoDate, name: z.string().min(1), appliesTo: appliesToSchema.optional() })
  .strict();

/**
 * Money to keep aside for the taxes and contributions of the fiscal year not paid yet: which estimates count,
 * which deadlines settle them, and the prudent margin proposed by default (a product choice, not a legal value).
 */
export const reserveSchema = z
  .object({
    include: z.array(ruleId).min(1),
    settles: z
      .array(
        z
          .object({
            deadline: ruleId,
            /** Which fiscal year a payment at that deadline settles: the one of its period, the current or the previous one. */
            fiscalYear: z.enum(['period', 'current', 'previous']),
          })
          .strict(),
      )
      .default([]),
    marginBp: basisPoints,
    warning: localized,
    ...sourced,
  })
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
    allowances: z.array(allowanceSchema).default([]),
    deadlines: z.array(deadlineRuleSchema).default([]),
    reserve: reserveSchema.optional(),
    /** Share of an expense category that is deductible (US: 50 % of business meals); 100 % when not listed. */
    expenseShares: z
      .array(
        z.object({ category: z.enum(EXPENSE_CATEGORIES), deductibleBp: basisPoints, ...sourced }).strict(),
      )
      .default([]),
  })
  .strict();

export type YearRules = z.infer<typeof yearRulesSchema>;
export type ThresholdRule = z.infer<typeof thresholdSchema>;
export type EstimateRule = z.infer<typeof estimateSchema>;
export type AllowanceRule = z.infer<typeof allowanceSchema>;
export type DeadlineRule = z.infer<typeof deadlineRuleSchema>;
export type Localized = z.infer<typeof localized>;
export type ReserveRule = z.infer<typeof reserveSchema>;
export type PrepareRule = z.infer<typeof prepareSchema>;
export type PrepareMethod = (typeof PREPARE_METHODS)[number];
