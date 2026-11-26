import { describe, expect, test } from 'bun:test';
import {
  computeEstimates,
  computeReserve,
  type DeadlineNotice,
  deductibleCents,
  EXPENSE_CATEGORIES,
  expandDeadlines,
  type PrepareRule,
  packFeatures,
  prepareDeclaration,
  type RuleProfile,
  type YearRules,
} from '@almanach/shared';
import { PackRegistry } from './packs.ts';

// United States pack (federal only), checked on irs.gov, ssa.gov and uscode.house.gov on 2026-11-26. Expected
// amounts are worked out by hand in the comments, each step rounded to the cent.
const packs = await PackRegistry.load();
const proprietor: RuleProfile = {
  status: 'sole_proprietor',
  options: [],
  declarationPeriod: 'quarterly',
  activityStart: '2020-01-01',
};

/**
 * US rules of 2026, failing the test when missing
 *
 * @returns {YearRules} - the rules
 */
function rules2026(): YearRules {
  const found = packs.rules('US', 2026);
  if (!found || found.fallback) throw new Error('no US 2026 rules');
  return found.rules;
}

/**
 * Prepare block of a 2026 deadline
 *
 * @param id {string} - deadline rule id
 * @returns {PrepareRule} - the block
 */
function prepareOf(id: string): PrepareRule {
  const prepare = rules2026().deadlines.find((rule) => rule.id === id)?.prepare;
  if (!prepare) throw new Error(`no prepare block for ${id}`);
  return prepare;
}

/**
 * 2026 estimates in cents for a yearly profit received in one payment
 *
 * @param cents {number} - yearly profit (revenue, no expense)
 * @param options {string[]} - pack options (married_joint)
 * @returns {Record<string, number>} - estimate id → cents
 */
function yearly(cents: number, options: string[] = []): Record<string, number> {
  const results = computeEstimates(rules2026(), { ...proprietor, options }, [{ date: '2026-06-30', cents }]);
  return Object.fromEntries(results.map((result) => [result.id, result.cents]));
}

const officialSource = /^https:\/\/(www\.irs\.gov|uscode\.house\.gov|www\.ssa\.gov|www\.sba\.gov)\//;

describe('United States pack', () => {
  test('is verified for every function it offers; no thresholds and no e-invoicing', () => {
    const pack = packs.get('US');
    expect(pack).toMatchObject({ maturity: 'verified', currency: 'USD', fiscalYearStart: '01-01' });
    expect(packFeatures(pack ?? { maturity: 'experimental' })).toEqual({
      estimates: 'verified',
      deadlines: 'verified',
      activities: 'verified',
      reserve: 'verified',
      prepare: 'verified',
      expenses: 'verified',
      vault_types: 'verified',
    });
    expect(rules2026().thresholds).toEqual([]);
    expect(pack?.invoice.einvoice).toBeUndefined();
  });

  test('says on each status, the reserve and the deadlines that state taxes are not covered', () => {
    const pack = packs.get('US');
    for (const status of pack?.statuses ?? []) expect(status.hint?.en).toContain('Federal taxes only');
    const rules = rules2026();
    expect(rules.reserve?.warning.en).toContain('State and local taxes are not included');
    for (const deadline of rules.deadlines) expect(deadline.label.en).toContain('Federal');
    for (const estimate of rules.estimates) expect(estimate.label.en).toContain('Federal');
  });

  test('every value cites an official source checked on 2026-11-26', () => {
    const rules = rules2026();
    const sourced = [
      ...rules.estimates,
      ...rules.deadlines,
      ...rules.deadlines.flatMap((rule) => (rule.prepare ? [rule.prepare] : [])),
      ...rules.expenseShares,
      ...(rules.reserve ? [rules.reserve] : []),
    ];
    for (const item of sourced) {
      expect(item.source).toMatch(officialSource);
      expect(item.verified_on).toBe('2026-11-26');
    }
    expect(rules.shiftSource).toBe('https://uscode.house.gov/us/usc/t26/s7503/');
    for (const kind of packs.get('US')?.vault?.kinds ?? [])
      if (kind.source) expect(kind.source).toMatch(officialSource);
  });
});

describe('United States 2026 self-employment tax', () => {
  test('nothing below $400 of net earnings: $433 of profit gives $399.88', () => {
    expect(yearly(43_300).self_employment_tax).toBe(0);
  });

  test('$500 of profit: 461.75 × 12.4 % = 57.26 and × 2.9 % = 13.39', () => {
    expect(yearly(50_000).self_employment_tax).toBe(5_726 + 1_339);
  });

  test('$50,000: 46,175 × 12.4 % = 5,725.70 and × 2.9 % = 1,339.08', () => {
    expect(yearly(5_000_000).self_employment_tax).toBe(572_570 + 133_908);
  });

  test('$250,000: Social Security stops at the $184,500 wage base, Medicare does not', () => {
    // Net earnings 230,875. 184,500 × 12.4 % = 22,878; 230,875 × 2.9 % = 6,695.38.
    expect(yearly(25_000_000).self_employment_tax).toBe(2_287_800 + 669_538);
  });
});

describe('United States 2026 Additional Medicare Tax', () => {
  test('nothing up to $200,000 of net earnings (single)', () => {
    expect(yearly(21_656_000).additional_medicare_single).toBe(0);
  });

  test('$250,000 single: (230,875 − 200,000) × 0.9 % = 277.88', () => {
    const result = yearly(25_000_000);
    expect(result.additional_medicare_single).toBe(27_788);
    expect(result.additional_medicare_joint).toBeUndefined();
  });

  test('$500,000 joint: (461,750 − 250,000) × 0.9 % = 1,905.75', () => {
    const result = yearly(50_000_000, ['married_joint']);
    expect(result.additional_medicare_joint).toBe(190_575);
    expect(result.additional_medicare_single).toBeUndefined();
  });

  test('is not part of the half of SE tax deducted from income', () => {
    // Same income tax whether or not the Additional Medicare Tax is computed.
    const rules = rules2026();
    const without = {
      ...rules,
      estimates: rules.estimates.filter((rule) => !rule.id.startsWith('additional_medicare')),
    };
    const receipts = [{ date: '2026-06-30', cents: 25_000_000 }];
    const tax = (r: YearRules) => computeEstimates(r, proprietor, receipts, ['income_tax_single'])[0]?.cents;
    expect(tax(without)).toBe(tax(rules));
  });
});

describe('United States 2026 federal income tax', () => {
  test('$50,000 single: standard deduction $16,100, QBI 20 % of taxable income', () => {
    // SE tax 7,064.78, half 3,532.39 → AGI 46,467.61; taxable 30,367.61; QBI min(9,293.52, 6,073.52) = 6,073.52
    // → 24,294.09: 12,400 × 10 % = 1,240 + 11,894.09 × 12 % = 1,427.29.
    expect(yearly(5_000_000).income_tax_single).toBe(124_000 + 142_729);
  });

  test('$150,000 joint: standard deduction $32,200 and joint brackets', () => {
    // SE tax 138,525 × 15.3 % = 21,194.33, half 10,597.17 → AGI 139,402.83; taxable 107,202.83;
    // QBI min(27,880.57, 21,440.57) = 21,440.57 → 85,762.26: 24,800 × 10 % = 2,480 + 60,962.26 × 12 % = 7,315.47.
    expect(yearly(15_000_000, ['married_joint']).income_tax_joint).toBe(248_000 + 731_547);
  });

  test('$250,000 single: QBI deduction reduced over the phase-in range', () => {
    // AGI 250,000 − 14,786.69 = 235,213.31; taxable before QBI 219,113.31, 17,363.31 above $201,750.
    // 20 % × 235,213.31 = 47,042.66, reduced by 47,042.66 × 17,363.31 / 75,000 = 10,890.88 → 36,151.78.
    // Taxable 182,961.53: 1,240 + 4,560 + 12,166 + 77,261.53 × 24 % = 18,542.77.
    expect(yearly(25_000_000).income_tax_single).toBe(124_000 + 456_000 + 1_216_600 + 1_854_277);
  });

  test('$320,000 single: past the phase-in range, only the $400 minimum QBI deduction is left', () => {
    // AGI 320,000 − 15,724.04 = 304,275.96; taxable before QBI 288,175.96 > 276,750 → 0, floor $400:
    // 287,775.96. 1,240 + 4,560 + 12,166 + 23,058 + 54,450 × 32 % = 17,424 + 31,550.96 × 35 % = 11,042.84.
    expect(yearly(32_000_000).income_tax_single).toBe(
      124_000 + 456_000 + 1_216_600 + 2_305_800 + 1_742_400 + 1_104_284,
    );
  });

  test('$1,500 of profit: income under the standard deduction owes no income tax', () => {
    expect(yearly(150_000).income_tax_single).toBe(0);
  });
});

describe('United States expenses', () => {
  test('business meals count for 50 %, every other category in full', () => {
    const rules = rules2026();
    expect(
      deductibleCents(rules, { date: '2026-03-01', netCents: 10_001, vatCents: 0, category: 'meals' }),
    ).toBe(5_001);
    expect(
      deductibleCents(rules, { date: '2026-03-01', netCents: 10_000, vatCents: 0, category: 'software' }),
    ).toBe(10_000);
  });

  test('recorded expenses lower the profit of every estimate', () => {
    const facts = { ...proprietor, expensesCents: 1_000_000 };
    const results = computeEstimates(rules2026(), facts, [{ date: '2026-06-30', cents: 6_000_000 }]);
    expect(Object.fromEntries(results.map((item) => [item.id, item.cents]))).toEqual(yearly(5_000_000));
  });
});

describe('United States deadlines 2026', () => {
  const dues = (rules: YearRules) =>
    expandDeadlines(rules, proprietor, packs.holidays('US')).map((item) => [item.ruleId, item.due]);

  test('1040-ES on 15 April, 15 June, 15 September and 15 January; Form 1040 on 15 April 2027', () => {
    expect(dues(rules2026())).toEqual([
      ['estimated_tax', '2026-04-15'],
      ['estimated_tax', '2026-06-15'],
      ['estimated_tax', '2026-09-15'],
      ['estimated_tax', '2027-01-15'],
      ['form_1040', '2027-04-15'],
    ]);
  });

  test('a due date on a legal holiday or weekend moves to the next business day (26 USC 7503)', () => {
    const rules = rules2026();
    const moved = {
      ...rules,
      deadlines: rules.deadlines.slice(0, 1).map((rule) => ({
        ...rule,
        schedule: {
          type: 'dates' as const,
          dates: [
            { due: '2026-11-26', periodStart: '2026-09-01', periodEnd: '2026-12-31' },
            { due: '2026-07-04', periodStart: '2026-04-01', periodEnd: '2026-05-31' },
          ],
        },
      })),
    };
    // Thanksgiving (Thursday) → Friday 27; Saturday 4 July → Monday 6 July.
    expect(dues(moved).map(([, due]) => due)).toEqual(['2026-07-06', '2026-11-27']);
  });

  test('holidays are the legal holidays of Pub. 509 (2026)', () => {
    expect(rules2026().holidays.map((item) => item.date)).toEqual([
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-04-16',
      '2026-05-25',
      '2026-06-19',
      '2026-07-03',
      '2026-09-07',
      '2026-10-12',
      '2026-11-11',
      '2026-11-26',
      '2026-12-25',
      '2027-01-01',
    ]);
  });
});

describe('United States 1040-ES prepared amount', () => {
  const input = {
    rules: rules2026(),
    prepare: prepareOf('estimated_tax'),
    profile: proprietor,
    receipts: [{ date: '2026-06-30', cents: 6_000_000 }],
    invoiced: [],
    fiscalStart: '2026-01-01',
    fiscalYear: 2026,
    periodStart: '2026-06-01',
    periodEnd: '2026-08-31',
    estimatesCents: 0,
    paidBeforeCents: 500_000,
  };
  const annualized: DeadlineNotice = {
    perOccurrenceCents: null,
    priorYearTaxCents: null,
    priorYearIncomeCents: null,
    method: 'annualized',
  };

  test('annualized method counts expenses to date, meals at 50 %, annualized like income', () => {
    // Expenses 10,000 + 50 % of 4,000 = 12,000 × 1.5 = 18,000; income 60,000 × 1.5 = 90,000 → profit 72,000.
    // SE tax 66,492 × 12.4 % = 8,245.01 + × 2.9 % = 1,928.27 = 10,173.28; half 5,086.64 → AGI 66,913.36;
    // taxable 50,813.36, QBI 10,162.67 → 40,650.69: 1,240 + 28,250.69 × 12 % = 3,390.08 → 4,630.08.
    // Total 14,803.36 × 67.5 % = 9,992.27, minus 5,000 paid.
    const result = prepareDeclaration({
      ...input,
      expenses: [
        { date: '2026-02-10', netCents: 1_000_000, vatCents: 0, category: 'software' },
        { date: '2026-05-10', netCents: 400_000, vatCents: 0, category: 'meals' },
        { date: '2026-09-10', netCents: 900_000, vatCents: 0, category: 'travel' },
      ],
      notice: annualized,
    });
    expect(result.amount?.steps).toEqual([
      { kind: 'annualized_income', cents: 9_000_000, rateBp: 15_000 },
      { kind: 'annualized_expenses', cents: -1_800_000, rateBp: 15_000 },
      { kind: 'annualized_tax', cents: 1_480_336 },
      { kind: 'cumulative_share', cents: 999_227, rateBp: 6750 },
      { kind: 'paid_before', cents: -500_000 },
    ]);
    expect(result.amount?.cents).toBe(499_227);
  });

  test('safe harbor asks for last year’s AGI (110 % above $150,000) and warns about state taxes', () => {
    const result = prepareDeclaration({
      ...input,
      expenses: null,
      notice: { ...annualized, method: null, priorYearTaxCents: 2_000_000, priorYearIncomeCents: 15_000_001 },
    });
    expect(result.amount).toMatchObject({ method: 'prior_year_share', cents: 550_000, asksIncome: true });
    expect(result.amount?.warning?.en).toContain('state taxes are not handled');
  });
});

describe('United States Form 1040 prepared Schedule C', () => {
  test('gross receipts, one line per expense category, meals at 50 % and the total', () => {
    const result = prepareDeclaration({
      rules: rules2026(),
      prepare: prepareOf('form_1040'),
      profile: proprietor,
      receipts: [
        { date: '2025-12-31', cents: 999_999 },
        { date: '2026-03-01', cents: 8_000_000 },
      ],
      invoiced: [],
      expenses: [
        { date: '2026-01-05', netCents: 120_000, vatCents: 0, category: 'marketing' },
        { date: '2026-02-05', netCents: 30_000, vatCents: 0, category: 'meals' },
        { date: '2026-03-05', netCents: 60_000, vatCents: 0, category: 'software' },
        { date: '2026-04-05', netCents: 200_000, vatCents: 0, category: 'equipment' },
        { date: '2026-05-05', netCents: 9_000, vatCents: 0, category: 'telecom' },
      ],
      fiscalStart: '2026-01-01',
      fiscalYear: 2026,
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      estimatesCents: 0,
      notice: null,
      paidBeforeCents: 0,
    });
    expect(Object.fromEntries(result.lines.map((line) => [line.id, line.cents]))).toEqual({
      line_1: 8_000_000,
      line_8: 120_000,
      line_9: 0,
      line_15: 0,
      line_18: 0,
      line_20b: 0,
      line_24a: 0,
      line_24b: 15_000,
      line_25: 9_000,
      line_27b: 260_000,
      line_28: 404_000,
    });
    expect(result.amount).toBeNull();
    expect(result.note?.en).toContain('One Schedule C per business');
  });

  test('every expense category lands on exactly one Schedule C line', () => {
    const lines = prepareOf('form_1040').lines.filter((line) => line.categories);
    const categories = lines.flatMap((line) => line.categories ?? []);
    expect(new Set(categories).size).toBe(categories.length);
    expect([...categories].sort()).toEqual([...EXPENSE_CATEGORIES].sort());
  });
});

describe('United States reserve', () => {
  test('$60,000 collected, $10,000 of expenses, $2,000 of 2026 estimated tax paid towards income tax', () => {
    // Profit 50,000: SE tax 7,064.78 + income tax 2,667.29 = 9,732.07; margin 973.21.
    const rules = rules2026();
    const result = computeReserve({
      rules,
      reserve: rules.reserve as NonNullable<YearRules['reserve']>,
      profile: { ...proprietor, expensesCents: 1_000_000 },
      receipts: [{ date: '2026-06-30', cents: 6_000_000 }],
      paid: { income_tax_single: 200_000 },
      marginBp: 1000,
      extraRateBp: 0,
      extraMonthlyCents: 0,
      monthsElapsed: 11,
    });
    expect(result.components.map((item) => [item.id, item.cents])).toEqual([
      ['self_employment_tax', 706_478],
      ['additional_medicare_single', 0],
      ['income_tax_single', 266_729],
    ]);
    expect(result.reserveCents).toBe(973_207 + 97_321 - 200_000);
  });
});
