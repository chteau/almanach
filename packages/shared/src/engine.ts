import { addDays, daysBetween } from './documents.ts';
import type { DeclarationPeriod } from './packs.ts';
import type {
  AppliesTo,
  DeadlineRule,
  EstimateRule,
  Localized,
  ReserveRule,
  ThresholdRule,
  YearRules,
} from './rules.ts';

/** Profile facts the rules depend on. */
export interface RuleProfile {
  status: string | null;
  options: string[];
  declarationPeriod: DeclarationPeriod | null;
  activityStart: string;
  /** Statuses of the secondary activities of the same business (mixed activity); none when absent. */
  activities?: string[];
  /** Tax household for French income tax: parts in quarters (4 = one part) and joint taxation; one single part when absent. */
  household?: { partsQuarters: number; joint: boolean };
}

/** Money received on a date, in the main currency. */
export interface Receipt {
  date: string;
  cents: number;
  /** Status of the activity that collected it; the main status (profile status) when absent. */
  category?: string;
  /** Collected by another activity of the same business, tracked in a linked instance. */
  linked?: boolean;
}

/**
 * Lists the statuses of every activity of a profile, the main one first, without duplicates
 *
 * @param profile {RuleProfile} - the person's situation
 * @returns {string[]} - main status (empty string when generic) then the secondary ones
 */
export function activityStatuses(profile: RuleProfile): string[] {
  return [...new Set([profile.status ?? '', ...(profile.activities ?? [])])];
}

/**
 * Tells whether a rule concerns a profile; a status condition holds when any activity has a listed status
 *
 * @param appliesTo {AppliesTo | undefined} - rule conditions
 * @param profile {RuleProfile} - the person's situation
 * @returns {boolean} - true when every condition holds
 */
export function applies(appliesTo: AppliesTo | undefined, profile: RuleProfile): boolean {
  if (!appliesTo) return true;
  const statuses = appliesTo.statuses;
  if (statuses && !activityStatuses(profile).some((status) => statuses.includes(status))) return false;
  if (appliesTo.options?.some((option) => !profile.options.includes(option))) return false;
  if (appliesTo.withoutOptions?.some((option) => profile.options.includes(option))) return false;
  if (appliesTo.periods && !appliesTo.periods.includes(profile.declarationPeriod ?? 'yearly')) return false;
  return true;
}

/**
 * First and last day of the fiscal year containing a date
 *
 * @param date {string} - YYYY-MM-DD
 * @param fiscalYearStart {string} - MM-DD the fiscal year starts on, e.g. "04-06" in the UK
 * @returns {{ year: number; start: string; end: string }} - year is the calendar year the fiscal year starts in
 */
export function fiscalYearOf(
  date: string,
  fiscalYearStart: string,
): { year: number; start: string; end: string } {
  const calendarYear = Number(date.slice(0, 4));
  const year = date.slice(5) >= fiscalYearStart ? calendarYear : calendarYear - 1;
  const start = `${year}-${fiscalYearStart}`;
  return { year, start, end: addDays(`${year + 1}-${fiscalYearStart}`, -1) };
}

/**
 * Last day of a month
 *
 * @param year {number} - calendar year
 * @param month {number} - month from 1 to 12, may overflow into following years
 * @returns {string} - YYYY-MM-DD
 */
function lastDayOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * Moves a date to the next business day when it falls on a weekend or a public holiday (S-062)
 *
 * @param date {string} - legal due date
 * @param holidays {Set<string>} - public holidays as YYYY-MM-DD
 * @returns {string} - the date the obligation is actually due
 */
export function nextBusinessDay(date: string, holidays: Set<string>): string {
  let current = date;
  for (let guard = 0; guard < 14; guard += 1) {
    const day = new Date(`${current}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(current)) return current;
    current = addDays(current, 1);
  }
  return current;
}

/** One dated occurrence of a pack obligation. */
export interface DeadlineOccurrence {
  /** Stable key: rule id and period start (or due date), used to store "done" marks. */
  key: string;
  ruleId: string;
  kind: DeadlineRule['kind'];
  label: Localized;
  description: Localized;
  link: string;
  source: string;
  verifiedOn: string;
  /** Date it is actually due, after moving off weekends and holidays. */
  due: string;
  /** Legal date when it was moved, otherwise null. */
  movedFrom: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  estimates: string[];
  declaresRevenue: boolean;
}

/**
 * Lists every occurrence of the pack obligations that concern a profile for one rules year
 *
 * @param rules {YearRules} - rules of the year
 * @param profile {RuleProfile} - the person's situation
 * @param holidays {Set<string>} - public holidays of every loaded year, for dates spilling into the next one
 * @returns {DeadlineOccurrence[]} - occurrences sorted by due date
 */
export function expandDeadlines(
  rules: YearRules,
  profile: RuleProfile,
  holidays: Set<string>,
): DeadlineOccurrence[] {
  const out: DeadlineOccurrence[] = [];
  for (const rule of rules.deadlines) {
    if (!applies(rule.appliesTo, profile)) continue;
    const dates: { due: string; periodStart?: string; periodEnd?: string; fixed?: boolean }[] = [];
    if (rule.schedule.type === 'monthly') {
      for (let month = 1; month <= 12; month += 1) {
        const target = month + rule.schedule.monthOffset;
        const due =
          rule.schedule.day === 'last'
            ? lastDayOfMonth(rules.year, target)
            : `${lastDayOfMonth(rules.year, target).slice(0, 8)}${String(rule.schedule.day).padStart(2, '0')}`;
        dates.push({
          due,
          periodStart: `${rules.year}-${String(month).padStart(2, '0')}-01`,
          periodEnd: lastDayOfMonth(rules.year, month),
        });
      }
    } else dates.push(...rule.schedule.dates);
    for (const entry of dates) {
      const due =
        rules.shift === 'next_business_day' && !entry.fixed
          ? nextBusinessDay(entry.due, holidays)
          : entry.due;
      out.push({
        key: `${rule.id}:${entry.periodStart ?? entry.due}`,
        ruleId: rule.id,
        kind: rule.kind,
        label: rule.label,
        description: rule.description,
        link: rule.link,
        source: rule.source,
        verifiedOn: rule.verified_on,
        due,
        movedFrom: due === entry.due ? null : entry.due,
        periodStart: entry.periodStart ?? null,
        periodEnd: entry.periodEnd ?? null,
        estimates: rule.estimates,
        declaresRevenue: rule.declaresRevenue,
      });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

/** Result of an estimate, with the steps shown to the person (S-046, S-082). */
export interface EstimateResult {
  id: string;
  label: Localized;
  cents: number;
  /** Human-checkable steps, e.g. "12 000,00 × 26.1 %". Amounts in cents, rates in basis points. */
  steps: {
    baseCents: number;
    rateBp: number;
    cents: number;
    from?: string;
    reducedShareBp?: number;
    /** Correction applied to the tax of the previous steps instead of a rate (cents is negative). */
    adjustment?: 'qf_cap' | 'decote';
  }[];
  source: string;
  verifiedOn: string;
}

/**
 * Rounds cents × basis points to the nearest cent
 *
 * @param cents {number} - amount
 * @param rateBp {number} - rate in basis points
 * @returns {number} - rounded product
 */
function applyRate(cents: number, rateBp: number): number {
  return Math.round((cents * rateBp) / 10_000);
}

/**
 * End of the reduced-rate window: last day of the n-th calendar quarter after the start quarter
 *
 * @param activityStart {string} - YYYY-MM-DD
 * @param quarters {number} - quarters after the start quarter
 * @returns {string} - last day of the window
 */
export function reductionEnd(activityStart: string, quarters: number): string {
  const year = Number(activityStart.slice(0, 4));
  const startQuarter = Math.floor((Number(activityStart.slice(5, 7)) - 1) / 3);
  return lastDayOfMonth(year, (startQuarter + quarters + 1) * 3);
}

/**
 * Flat-rate contributions on collected revenue, with mid-year rate changes and a temporary
 * reduction such as ACRE (S-215)
 *
 * @param rule {EstimateRule} - estimate whose formula kind is "flat"
 * @param receipts {Receipt[]} - money collected in the period
 * @param profile {RuleProfile} - the person's situation
 * @returns {EstimateResult} - amount and steps
 */
function flat(rule: EstimateRule, receipts: Receipt[], profile: RuleProfile): EstimateResult {
  if (rule.formula.kind !== 'flat') throw new Error('not a flat estimate');
  const { rates, reduction } = rule.formula;
  const groups = new Map<
    string,
    { baseCents: number; rateBp: number; from: string; reducedShareBp?: number }
  >();
  const step = reduction
    ? [...reduction.steps].reverse().find((candidate) => candidate.startedFrom <= profile.activityStart)
    : undefined;
  const reducedUntil =
    reduction && step && profile.options.includes(reduction.option)
      ? reductionEnd(profile.activityStart, reduction.quarters)
      : null;
  for (const receipt of receipts) {
    const rate = [...rates].reverse().find((candidate) => candidate.from <= receipt.date) ?? rates[0];
    if (!rate) continue;
    const reduced =
      reducedUntil !== null && receipt.date <= reducedUntil && receipt.date >= profile.activityStart;
    const key = `${rate.from}:${reduced}`;
    const group = groups.get(key) ?? {
      baseCents: 0,
      rateBp: reduced && step ? Math.round((rate.rateBp * step.dueShareBp) / 10_000) : rate.rateBp,
      from: rate.from,
      ...(reduced && step ? { reducedShareBp: step.dueShareBp } : {}),
    };
    group.baseCents += receipt.cents;
    groups.set(key, group);
  }
  const steps = [...groups.values()].map((group) => ({
    ...group,
    cents: applyRate(group.baseCents, group.rateBp),
  }));
  return {
    id: rule.id,
    label: rule.label,
    cents: steps.reduce((sum, item) => sum + item.cents, 0),
    steps,
    source: rule.source,
    verifiedOn: rule.verified_on,
  };
}

/**
 * Progressive tax over bands after an allowance (UK income tax, US federal income tax)
 *
 * @param rule {EstimateRule} - estimate whose formula kind is "brackets"
 * @param baseCents {number} - yearly income before the allowance
 * @param deductionsCents {number} - other deductions (half of self-employment tax in the US)
 * @returns {EstimateResult} - amount and one step per band used
 */
function brackets(rule: EstimateRule, baseCents: number, deductionsCents: number): EstimateResult {
  if (rule.formula.kind !== 'brackets') throw new Error('not a bracket estimate');
  const { allowanceCents, taper, bands } = rule.formula;
  // Taper (UK) reduces the allowance by `byCents` for every `reducePerCents` above the limit.
  let allowance = allowanceCents;
  if (taper && baseCents > taper.aboveCents) {
    const reduction = Math.floor((baseCents - taper.aboveCents) / taper.reducePerCents) * taper.byCents;
    allowance = Math.max(0, allowance - reduction);
  }
  let taxable = Math.max(0, baseCents - deductionsCents - allowance);
  if (rule.formula.businessIncomeDeductionBp) {
    const share = rule.formula.businessIncomeDeductionBp;
    taxable -= Math.min(
      applyRate(Math.max(0, baseCents - deductionsCents), share),
      applyRate(taxable, share),
    );
  }
  let previous = 0;
  const steps: EstimateResult['steps'] = [];
  for (const band of bands) {
    if (taxable <= 0) break;
    const width = band.upToCents === null ? taxable : Math.max(0, band.upToCents - previous);
    const portion = Math.min(taxable, width);
    if (portion > 0)
      steps.push({ baseCents: portion, rateBp: band.rateBp, cents: applyRate(portion, band.rateBp) });
    taxable -= portion;
    previous = band.upToCents ?? previous;
  }
  return {
    id: rule.id,
    label: rule.label,
    cents: steps.reduce((sum, item) => sum + item.cents, 0),
    steps,
    source: rule.source,
    verifiedOn: rule.verified_on,
  };
}

/**
 * Contributions on profits between limits (UK Class 4 National Insurance)
 *
 * @param rule {EstimateRule} - estimate whose formula kind is "profit_bands"
 * @param baseCents {number} - yearly profit
 * @returns {EstimateResult} - amount and one step per band used
 */
function profitBands(rule: EstimateRule, baseCents: number): EstimateResult {
  if (rule.formula.kind !== 'profit_bands') throw new Error('not a profit band estimate');
  const bands = rule.formula.bands;
  const steps: EstimateResult['steps'] = [];
  bands.forEach((band, index) => {
    const upper = bands[index + 1]?.fromCents ?? Number.POSITIVE_INFINITY;
    const portion = Math.max(0, Math.min(baseCents, upper) - band.fromCents);
    if (portion > 0)
      steps.push({ baseCents: portion, rateBp: band.rateBp, cents: applyRate(portion, band.rateBp) });
  });
  return {
    id: rule.id,
    label: rule.label,
    cents: steps.reduce((sum, item) => sum + item.cents, 0),
    steps,
    source: rule.source,
    verifiedOn: rule.verified_on,
  };
}

/**
 * US self-employment tax (Schedule SE)
 *
 * @param rule {EstimateRule} - estimate whose formula kind is "us_self_employment"
 * @param baseCents {number} - yearly net profit
 * @returns {EstimateResult} - Social Security and Medicare parts
 */
function usSelfEmployment(rule: EstimateRule, baseCents: number): EstimateResult {
  if (rule.formula.kind !== 'us_self_employment') throw new Error('not a self-employment estimate');
  const formula = rule.formula;
  const net = applyRate(baseCents, formula.netEarningsShareBp);
  const steps: EstimateResult['steps'] = [];
  if (net >= formula.minimumNetEarningsCents) {
    const social = Math.min(net, formula.wageBaseCents);
    steps.push({
      baseCents: social,
      rateBp: formula.socialSecurityBp,
      cents: applyRate(social, formula.socialSecurityBp),
    });
    steps.push({ baseCents: net, rateBp: formula.medicareBp, cents: applyRate(net, formula.medicareBp) });
  }
  return {
    id: rule.id,
    label: rule.label,
    cents: steps.reduce((sum, item) => sum + item.cents, 0),
    steps,
    source: rule.source,
    verifiedOn: rule.verified_on,
  };
}

/**
 * German income tax for a single person under § 32a EStG, rounded down to whole euros as the law requires
 *
 * @param rule {EstimateRule} - estimate whose formula kind is "de_income_tax"
 * @param baseCents {number} - taxable income (zu versteuerndes Einkommen)
 * @returns {EstimateResult} - amount with one step showing the average rate
 */
function deIncomeTax(rule: EstimateRule, baseCents: number): EstimateResult {
  if (rule.formula.kind !== 'de_income_tax') throw new Error('not a German income tax estimate');
  const { zones, zone2, zone3, zone4, zone5 } = rule.formula;
  const x = Math.floor(baseCents / 100);
  let tax = 0;
  if (x > zones[3]) tax = zone5[0] * x - zone5[1];
  else if (x > zones[2]) tax = zone4[0] * x - zone4[1];
  else if (x > zones[1]) {
    const z = (x - zones[1]) / 10_000;
    tax = (zone3[0] * z + zone3[1]) * z + zone3[2];
  } else if (x > zones[0]) {
    const y = (x - zones[0]) / 10_000;
    tax = (zone2[0] * y + zone2[1]) * y;
  }
  const cents = Math.max(0, Math.floor(tax)) * 100;
  return {
    id: rule.id,
    label: rule.label,
    cents,
    steps: cents > 0 ? [{ baseCents, rateBp: Math.round((cents * 10_000) / baseCents), cents }] : [],
    source: rule.source,
    verifiedOn: rule.verified_on,
  };
}

/**
 * Tax of a scale per part applied to an income split over a number of parts (quotient familial)
 *
 * @param bands {{ upToCents: number | null; rateBp: number }[]} - bands of income per part
 * @param incomeCents {number} - income of the household
 * @param partsQuarters {number} - number of parts, in quarters
 * @returns {{ cents: number; steps: EstimateResult['steps'] }} - tax and one step per band used, for the household
 */
function quotientTax(
  bands: { upToCents: number | null; rateBp: number }[],
  incomeCents: number,
  partsQuarters: number,
): { cents: number; steps: EstimateResult['steps'] } {
  let rest = Math.floor((Math.max(0, incomeCents) * 4) / partsQuarters);
  let previous = 0;
  const steps: EstimateResult['steps'] = [];
  for (const band of bands) {
    if (rest <= 0) break;
    const width = band.upToCents === null ? rest : Math.max(0, band.upToCents - previous);
    const portion = Math.min(rest, width);
    if (portion > 0 && band.rateBp > 0) {
      const base = Math.round((portion * partsQuarters) / 4);
      steps.push({ baseCents: base, rateBp: band.rateBp, cents: applyRate(base, band.rateBp) });
    }
    rest -= portion;
    previous = band.upToCents ?? previous;
  }
  return { cents: steps.reduce((sum, step) => sum + step.cents, 0), steps };
}

/**
 * French income tax: scale per part, cap on the benefit of the extra half-parts, then décote
 *
 * @param rule {EstimateRule} - estimate whose formula kind is "fr_income_tax"
 * @param baseCents {number} - taxable income (revenue minus the micro allowances)
 * @param household {RuleProfile['household']} - parts and joint taxation; one single part when absent
 * @returns {EstimateResult} - amount with band steps and the adjustments applied
 */
function frIncomeTax(
  rule: EstimateRule,
  baseCents: number,
  household: RuleProfile['household'],
): EstimateResult {
  if (rule.formula.kind !== 'fr_income_tax') throw new Error('not a French income tax estimate');
  const { bands, decote, halfPartCapCents } = rule.formula;
  const joint = household?.joint ?? false;
  const baseQuarters = joint ? 8 : 4;
  const quarters = Math.max(baseQuarters, household?.partsQuarters ?? baseQuarters);
  const withParts = quotientTax(bands, baseCents, quarters);
  const steps = [...withParts.steps];
  let tax = withParts.cents;
  if (quarters > baseQuarters) {
    // Each extra half-part may lower the tax by at most the cap; a quarter part by half of it.
    const capped =
      quotientTax(bands, baseCents, baseQuarters).cents -
      Math.round((halfPartCapCents * (quarters - baseQuarters)) / 2);
    if (capped > tax) {
      steps.push({ baseCents: tax, rateBp: 0, cents: capped - tax, adjustment: 'qf_cap' });
      tax = capped;
    }
  }
  const relief = joint ? decote.couple : decote.single;
  if (tax > 0 && tax < relief.limitCents) {
    const reduction = Math.min(tax, Math.max(0, relief.baseCents - applyRate(tax, relief.rateBp)));
    if (reduction > 0) {
      steps.push({ baseCents: tax, rateBp: relief.rateBp, cents: -reduction, adjustment: 'decote' });
      tax -= reduction;
    }
  }
  return {
    id: rule.id,
    label: rule.label,
    cents: tax,
    steps,
    source: rule.source,
    verifiedOn: rule.verified_on,
  };
}

/**
 * Taxable income of a micro business: each activity's revenue minus its own flat-rate allowance; the revenue
 * itself for an activity without allowance
 *
 * @param rules {YearRules} - rules of the year
 * @param profile {RuleProfile} - the person's situation
 * @param receipts {Receipt[]} - money collected in the period
 * @returns {number} - taxable income in cents
 */
function taxableIncome(rules: YearRules, profile: RuleProfile, receipts: Receipt[]): number {
  const statuses = activityStatuses(profile);
  return statuses.reduce((sum, status) => {
    const own =
      statuses.length === 1
        ? receipts
        : receipts.filter((receipt) => (receipt.category ?? profile.status ?? '') === status);
    const revenue = own.reduce((total, receipt) => total + receipt.cents, 0);
    const allowance = computeAllowance(
      rules,
      { ...profile, status: status || null, activities: [] },
      revenue,
    );
    return sum + (allowance ? allowance.taxableCents : revenue);
  }, 0);
}

/**
 * Computes the estimates of one activity, or of the whole person. Revenue-based estimates use the receipts given;
 * profit-based ones use their total, as Almanach does not track expenses yet, less an allowance the pack deducts
 * from profit first (UK trading allowance).
 *
 * @param rules {YearRules} - rules of the year
 * @param profile {RuleProfile} - situation with the status of that activity only, or every activity
 * @param receipts {Receipt[]} - money collected by that activity (or all of them) in the period of interest
 * @param only {string[] | undefined} - restrict to these estimate ids
 * @param scope {EstimateRule['scope'] | undefined} - restrict to the estimates of that scope; all when absent
 * @returns {EstimateResult[]} - results in rule order
 */
function activityEstimates(
  rules: YearRules,
  profile: RuleProfile,
  receipts: Receipt[],
  only?: string[],
  scope?: EstimateRule['scope'],
): EstimateResult[] {
  const total = receipts.reduce((sum, receipt) => sum + receipt.cents, 0);
  const allowance = computeAllowance(rules, profile, total);
  const profit = allowance?.deductsFromProfit ? allowance.taxableCents : total;
  const results = new Map<string, EstimateResult>();
  const ordered = [...rules.estimates].sort(
    (a, b) => Number(a.formula.kind === 'brackets') - Number(b.formula.kind === 'brackets'),
  );
  for (const rule of ordered) {
    if (!applies(rule.appliesTo, profile) || (scope && rule.scope !== scope)) continue;
    const formula = rule.formula;
    const base =
      rule.base === 'profit'
        ? profit
        : rule.base === 'taxable'
          ? taxableIncome(rules, profile, receipts)
          : total;
    let result: EstimateResult;
    if (formula.kind === 'flat') result = flat(rule, receipts, profile);
    else if (formula.kind === 'brackets') {
      const deductions = formula.deductHalfOf.reduce(
        (sum, id) => sum + Math.round((results.get(id)?.cents ?? 0) / 2),
        0,
      );
      result = brackets(rule, base, deductions);
    } else if (formula.kind === 'profit_bands') result = profitBands(rule, base);
    else if (formula.kind === 'us_self_employment') result = usSelfEmployment(rule, base);
    else if (formula.kind === 'fr_income_tax') result = frIncomeTax(rule, base, profile.household);
    else result = deIncomeTax(rule, base);
    results.set(rule.id, result);
  }
  return rules.estimates
    .map((rule) => results.get(rule.id))
    .filter(
      (result): result is EstimateResult => result !== undefined && (!only || only.includes(result.id)),
    );
}

/** Flat-rate allowance of one activity and the taxable income left (micro tax regime). */
export interface AllowanceResult {
  id: string;
  label: Localized;
  rateBp: number;
  allowanceCents: number;
  taxableCents: number;
  /** Deducted from profit before the profit-based estimates (UK trading allowance). */
  deductsFromProfit: boolean;
  source: string;
  verifiedOn: string;
}

/** Revenue, estimates and allowance of one activity of the business. */
export interface ActivityBreakdown {
  status: string;
  /** The activity of the profile status; the others are secondary. */
  main: boolean;
  revenueCents: number;
  /** Part of revenueCents received from linked instances attached to this activity. */
  linkedCents: number;
  /** With several activities, only the estimates computed per activity; those of the whole person are not split. */
  estimates: EstimateResult[];
  estimateCents: number;
  allowance: AllowanceResult | null;
}

/**
 * Applies the flat-rate allowance of an activity to its revenue: its own rate, at least the minimum amount,
 * never more than the revenue
 *
 * @param rules {YearRules} - rules of the year
 * @param profile {RuleProfile} - situation with the status of that activity only
 * @param revenueCents {number} - revenue of that activity
 * @returns {AllowanceResult | null} - allowance, or null when the pack has none for this situation
 */
export function computeAllowance(
  rules: YearRules,
  profile: RuleProfile,
  revenueCents: number,
): AllowanceResult | null {
  const rule = rules.allowances.find((candidate) => applies(candidate.appliesTo, profile));
  if (!rule) return null;
  const base = Math.max(0, revenueCents);
  const allowance = Math.min(base, Math.max(applyRate(base, rule.rateBp), rule.minimumCents));
  return {
    id: rule.id,
    label: rule.label,
    rateBp: rule.rateBp,
    allowanceCents: allowance,
    taxableCents: base - allowance,
    deductsFromProfit: rule.deductsFromProfit,
    source: rule.source,
    verifiedOn: rule.verified_on,
  };
}

/**
 * Splits receipts by activity and computes each activity's estimates and allowance at its own rates
 * (mixed activity: one declaration, one line and one rate per activity)
 *
 * @param rules {YearRules} - rules of the year
 * @param profile {RuleProfile} - the person's situation, with its secondary activities
 * @param receipts {Receipt[]} - money collected in the period; a receipt without category is the main activity's
 * @param only {string[] | undefined} - restrict to these estimate ids
 * @returns {ActivityBreakdown[]} - one entry per activity, the main one first
 */
export function activityBreakdown(
  rules: YearRules,
  profile: RuleProfile,
  receipts: Receipt[],
  only?: string[],
): ActivityBreakdown[] {
  const statuses = activityStatuses(profile);
  return statuses.map((status, index) => {
    const own =
      statuses.length === 1
        ? receipts
        : receipts.filter((receipt) => (receipt.category ?? profile.status ?? '') === status);
    const single = { ...profile, status: status || null, activities: [] };
    const estimates = activityEstimates(
      rules,
      single,
      own,
      only,
      statuses.length > 1 ? 'activity' : undefined,
    );
    const revenue = own.reduce((sum, receipt) => sum + receipt.cents, 0);
    return {
      status,
      main: index === 0,
      revenueCents: revenue,
      linkedCents: own.filter((receipt) => receipt.linked).reduce((sum, receipt) => sum + receipt.cents, 0),
      estimates,
      estimateCents: estimates.reduce((sum, item) => sum + item.cents, 0),
      allowance: computeAllowance(rules, single, revenue),
    };
  });
}

/**
 * Computes every estimate of the year that concerns a profile. With secondary activities, each activity's
 * estimates use its own receipts and rates, and the results of a rule shared by several activities are added;
 * estimates of the whole person (income tax, UK Class 4, US self-employment tax) are computed once on the total.
 *
 * @param rules {YearRules} - rules of the year
 * @param profile {RuleProfile} - the person's situation
 * @param receipts {Receipt[]} - money collected in the period of interest
 * @param only {string[] | undefined} - restrict to these estimate ids
 * @returns {EstimateResult[]} - results in rule order
 */
export function computeEstimates(
  rules: YearRules,
  profile: RuleProfile,
  receipts: Receipt[],
  only?: string[],
): EstimateResult[] {
  if (activityStatuses(profile).length === 1) return activityEstimates(rules, profile, receipts, only);
  const merged = new Map<string, EstimateResult>();
  for (const result of activityBreakdown(rules, profile, receipts, only).flatMap((item) => item.estimates)) {
    const known = merged.get(result.id);
    merged.set(
      result.id,
      known
        ? { ...known, cents: known.cents + result.cents, steps: [...known.steps, ...result.steps] }
        : result,
    );
  }
  for (const result of activityEstimates(rules, profile, receipts, only, 'person'))
    merged.set(result.id, result);
  return rules.estimates
    .map((rule) => merged.get(rule.id))
    .filter((result): result is EstimateResult => result !== undefined);
}

/** Progress towards a revenue ceiling (S-044, S-211, S-212). */
export interface ThresholdProgress {
  id: string;
  label: Localized;
  consequence: Localized;
  window: ThresholdRule['window'];
  /** "below" for a limit to fall under (UK VAT deregistration). */
  direction: ThresholdRule['direction'];
  windowStart: string;
  windowEnd: string;
  limitCents: number;
  toleranceCents: number | null;
  reachedCents: number;
  /** Part of reachedCents collected by linked instances. */
  linkedCents: number;
  /** Percentage reached, in basis points of the limit. */
  reachedBp: number;
  remainingCents: number;
  /** Date the limit would be crossed at the current pace, if within the window. */
  projectedDate: string | null;
  /** Above the base limit of an "above" threshold. */
  exceeded: boolean;
  /** Above the higher tolerance limit, when the country has one: consequences apply at once. */
  toleranceExceeded: boolean;
  /** Under the limit of a "below" threshold: the consequence (e.g. deregistration) becomes possible. */
  fellBelow: boolean;
  source: string;
  verifiedOn: string;
}

/**
 * Measures each threshold that concerns a profile. With several activities of the same business (secondary
 * activities, linked instances), a threshold applies if any activity matches it, and only counts the
 * revenue of the statuses it lists (mixed activity: global ceiling on everything, sub-ceiling on services).
 *
 * @param rules {YearRules} - rules of the current fiscal year
 * @param profile {RuleProfile} - the person's situation
 * @param receipts {Receipt[]} - every receipt of the current and previous fiscal years
 * @param fiscalYear {{ start: string; end: string }} - current fiscal year
 * @param today {string} - YYYY-MM-DD
 * @param priorYearCents {number | null} - revenue declared at onboarding for the previous year, used when no receipt exists
 * @returns {ThresholdProgress[]} - one entry per applicable threshold
 */
export function measureThresholds(
  rules: YearRules,
  profile: RuleProfile,
  receipts: Receipt[],
  fiscalYear: { start: string; end: string },
  today: string,
  priorYearCents: number | null,
): ThresholdProgress[] {
  const statusOf = (receipt: Receipt) => receipt.category ?? profile.status ?? '';
  const business = { ...profile, activities: [...(profile.activities ?? []), ...receipts.map(statusOf)] };
  const sum = (list: Receipt[]) => list.reduce((total, receipt) => total + receipt.cents, 0);
  return rules.thresholds
    .filter((rule) => applies(rule.appliesTo, business))
    .map((rule) => {
      let start = fiscalYear.start;
      let end = fiscalYear.end;
      if (rule.window === 'previous_fiscal_year') {
        start = `${Number(fiscalYear.start.slice(0, 4)) - 1}${fiscalYear.start.slice(4)}`;
        end = addDays(fiscalYear.start, -1);
      } else if (rule.window === 'rolling_12_months') {
        start = addDays(`${Number(today.slice(0, 4)) - 1}${today.slice(4)}`, 1);
        end = today;
      }
      const inWindow = receipts.filter(
        (receipt) =>
          receipt.date >= start &&
          receipt.date <= end &&
          (!rule.counts || rule.counts.includes(statusOf(receipt))),
      );
      const linked = sum(inWindow.filter((receipt) => receipt.linked));
      let reached = sum(inWindow);
      if (
        rule.window === 'previous_fiscal_year' &&
        !inWindow.some((receipt) => !receipt.linked) &&
        priorYearCents !== null
      ) {
        reached = priorYearCents + linked;
      }
      let projected: string | null = null;
      const below = rule.direction === 'below';
      if (!below && rule.window === 'fiscal_year' && reached > 0 && reached < rule.limitCents) {
        const elapsed = Math.max(1, daysBetween(start, today) + 1);
        const date = addDays(start, Math.ceil((rule.limitCents * elapsed) / reached) - 1);
        if (date <= end) projected = date;
      }
      return {
        id: rule.id,
        label: rule.label,
        consequence: rule.consequence,
        window: rule.window,
        direction: rule.direction,
        windowStart: start,
        windowEnd: end,
        limitCents: rule.limitCents,
        toleranceCents: rule.toleranceCents ?? null,
        reachedCents: reached,
        linkedCents: linked,
        reachedBp: rule.limitCents === 0 ? 0 : Math.round((reached * 10_000) / rule.limitCents),
        remainingCents: below ? 0 : Math.max(0, rule.limitCents - reached),
        projectedDate: projected,
        exceeded: !below && reached > rule.limitCents,
        toleranceExceeded: rule.toleranceCents !== undefined && reached > rule.toleranceCents,
        fellBelow: below && reached < rule.limitCents,
        source: rule.source,
        verifiedOn: rule.verified_on,
      };
    });
}

/** Part of the reserve owed to one estimate. */
export interface ReserveComponent extends EstimateResult {
  /** Already paid at a deadline that settles it, for this fiscal year. */
  paidCents: number;
}

/** What to keep aside now for the taxes and contributions of the fiscal year not paid yet. */
export interface ReserveResult {
  reserveCents: number;
  /** Sum of the estimates included, before margin and payments. */
  estimatedCents: number;
  marginCents: number;
  /** Personal extra: share of revenue and fixed monthly amount. */
  extraCents: number;
  paidCents: number;
  revenueCents: number;
  components: ReserveComponent[];
}

/**
 * Computes the reserve: estimates of the fiscal year to date × (1 + margin) + personal extra − what was already
 * paid for them, never below zero
 *
 * @param input {object} - rules, profile, receipts of the fiscal year to date, payments made per estimate,
 * margin and personal extra
 * @param input.rules {YearRules} - rules of the fiscal year, with a reserve block
 * @param input.reserve {ReserveRule} - reserve block of the pack
 * @param input.profile {RuleProfile} - the person's situation
 * @param input.receipts {Receipt[]} - money collected in the fiscal year so far
 * @param input.paid {Record<string, number>} - amount already paid this fiscal year per estimate id
 * @param input.marginBp {number} - prudent margin
 * @param input.extraRateBp {number} - personal extra as a share of revenue
 * @param input.extraMonthlyCents {number} - personal extra per month elapsed
 * @param input.monthsElapsed {number} - months of the fiscal year started so far
 * @returns {ReserveResult} - reserve and its parts
 */
export function computeReserve(input: {
  rules: YearRules;
  reserve: ReserveRule;
  profile: RuleProfile;
  receipts: Receipt[];
  paid: Record<string, number>;
  marginBp: number;
  extraRateBp: number;
  extraMonthlyCents: number;
  monthsElapsed: number;
}): ReserveResult {
  const estimates = computeEstimates(input.rules, input.profile, input.receipts, input.reserve.include);
  const components = estimates.map((estimate) => ({ ...estimate, paidCents: input.paid[estimate.id] ?? 0 }));
  const revenue = input.receipts.reduce((sum, receipt) => sum + receipt.cents, 0);
  const estimated = components.reduce((sum, item) => sum + item.cents, 0);
  const margin = applyRate(estimated, input.marginBp);
  const extra = applyRate(revenue, input.extraRateBp) + input.extraMonthlyCents * input.monthsElapsed;
  // A payment only offsets the estimate it settles; a surplus is not carried to other estimates.
  const paid = components.reduce((sum, item) => sum + Math.min(item.paidCents, item.cents), 0);
  return {
    reserveCents: Math.max(0, estimated + margin + extra - paid),
    estimatedCents: estimated,
    marginCents: margin,
    extraCents: extra,
    paidCents: components.reduce((sum, item) => sum + item.paidCents, 0),
    revenueCents: revenue,
    components,
  };
}
