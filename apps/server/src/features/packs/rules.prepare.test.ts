import { describe, expect, test } from 'bun:test';
import {
  computeEstimates,
  type DeadlineNotice,
  type InvoicedItem,
  type PrepareRule,
  prepareDeclaration,
  prepareSchema,
  type Receipt,
  type RuleProfile,
  type YearRules,
} from '@almanach/shared';
import { PackRegistry } from './packs.ts';

const packs = await PackRegistry.load();

/**
 * Rules of 2026 for a country and the prepare block of one of its deadlines
 *
 * @param country {string} - ISO code
 * @param deadline {string} - deadline rule id
 * @returns {{ rules: YearRules; prepare: PrepareRule }} - rules and block
 */
function rulesOf(country: string, deadline: string): { rules: YearRules; prepare: PrepareRule } {
  const rules = packs.rules(country, 2026)?.rules;
  const prepare = rules?.deadlines.find((rule) => rule.id === deadline)?.prepare;
  if (!rules || !prepare) throw new Error(`no prepare block for ${country} ${deadline}`);
  return { rules, prepare };
}

const profile = (status: string, extra: Partial<RuleProfile> = {}): RuleProfile => ({
  status,
  options: [],
  declarationPeriod: 'quarterly',
  activityStart: '2020-01-01',
  ...extra,
});

const base = {
  invoiced: [] as InvoicedItem[],
  expenses: null,
  fiscalStart: '2026-01-01',
  fiscalYear: 2026,
  estimatesCents: 0,
  notice: null as DeadlineNotice | null,
  paidBeforeCents: 0,
};

describe('prepare blocks of every pack', () => {
  test('are only offered where the pack declares the function', () => {
    for (const pack of packs.list()) {
      const rules = packs.rules(pack.country, 2026)?.rules;
      if (rules?.deadlines.some((rule) => rule.prepare)) expect(pack.features?.prepare).toBeDefined();
    }
  });

  test('a duplicated line or an unknown line in the amount is refused', () => {
    const line = { id: 'a', label: { fr: 'a', en: 'a', de: 'a' }, measure: 'revenue' };
    const block = {
      basis: 'collected',
      span: 'period',
      source: 'https://example.org',
      verified_on: '2026-11-24',
    };
    expect(prepareSchema.safeParse({ ...block, lines: [line, line] }).success).toBe(false);
    expect(
      prepareSchema.safeParse({ ...block, lines: [line], amount: { method: 'lines', add: ['b'] } }).success,
    ).toBe(false);
    expect(
      prepareSchema.safeParse({ ...block, lines: [line], amount: { method: 'prior_year_share' } }).success,
    ).toBe(false);
  });
});

describe('prepared declarations', () => {
  test('France, BNC + sales, October: one line per activity of the business, collected in the month', () => {
    const { rules, prepare } = rulesOf('FR', 'urssaf_monthly');
    const receipts: Receipt[] = [
      { date: '2026-09-30', cents: 900_000 },
      { date: '2026-10-05', cents: 200_000 },
      { date: '2026-10-20', cents: 300_000, category: 'micro_bic_sales' },
    ];
    const result = prepareDeclaration({
      ...base,
      rules,
      prepare,
      profile: profile('micro_bnc', { declarationPeriod: 'monthly', activities: ['micro_bic_sales'] }),
      receipts,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      estimatesCents: 88_100,
    });
    expect(result.lines.map((line) => [line.id, line.cents])).toEqual([
      ['ca_bnc', 200_000],
      ['ca_bic_sales', 300_000],
    ]);
    expect(result.amount).toMatchObject({ method: 'estimates', cents: 88_100 });
  });

  test('France, nothing collected: the lines say 0, not empty', () => {
    const { rules, prepare } = rulesOf('FR', 'urssaf_quarterly');
    const result = prepareDeclaration({
      ...base,
      rules,
      prepare,
      profile: profile('micro_bnc'),
      receipts: [],
      periodStart: '2026-07-01',
      periodEnd: '2026-09-30',
    });
    expect(result.lines.map((line) => line.cents)).toEqual([0]);
  });

  test('Germany, quarter: bases at 19 % and 7 %, reverse charge, credit note deducted, VAT due', () => {
    const { rules, prepare } = rulesOf('DE', 'ust_voranmeldung_quarterly');
    const invoiced: InvoicedItem[] = [
      { date: '2026-07-10', netCents: 1_000_000, vatRateBp: 1900, vatCents: 190_000, vatMode: 'standard' },
      { date: '2026-08-10', netCents: 200_000, vatRateBp: 700, vatCents: 14_000, vatMode: 'standard' },
      { date: '2026-09-10', netCents: 500_000, vatRateBp: 0, vatCents: 0, vatMode: 'reverse_charge' },
      { date: '2026-09-20', netCents: -100_000, vatRateBp: 1900, vatCents: -19_000, vatMode: 'standard' },
      { date: '2026-10-01', netCents: 999_999, vatRateBp: 1900, vatCents: 190_000, vatMode: 'standard' },
    ];
    const lines = (expenses: { date: string; netCents: number; vatCents: number }[] | null) =>
      prepareDeclaration({
        ...base,
        rules,
        prepare,
        profile: profile('freiberufler'),
        receipts: [],
        invoiced,
        expenses,
        periodStart: '2026-07-01',
        periodEnd: '2026-09-30',
      });
    const result = lines(null);
    // 10 000 − 1 000 at 19 %; VAT 1 900 + 140 − 190 = 1 850 €.
    expect(Object.fromEntries(result.lines.map((line) => [line.id, line.cents]))).toEqual({
      base_19: 900_000,
      base_7: 200_000,
      vat_collected: 185_000,
      reverse_charge: 500_000,
      export: 0,
      input_vat: null,
    });
    expect(result.amount?.cents).toBe(185_000);
    // 300 € of input VAT recorded: 1 850 − 300 = 1 550 €.
    expect(lines([{ date: '2026-08-01', netCents: 150_000, vatCents: 30_000 }]).amount?.cents).toBe(155_000);
  });

  test('Germany, prepayment: the amount of the notice, nothing without it', () => {
    const { rules, prepare } = rulesOf('DE', 'est_vorauszahlung');
    const input = {
      ...base,
      rules,
      prepare,
      profile: profile('freiberufler'),
      receipts: [],
      periodStart: '2026-12-10',
      periodEnd: '2026-12-10',
    };
    expect(prepareDeclaration(input).amount?.cents).toBeNull();
    const notice = {
      perOccurrenceCents: 120_000,
      priorYearTaxCents: null,
      priorYearIncomeCents: null,
      method: null,
    };
    expect(prepareDeclaration({ ...input, notice }).amount?.cents).toBe(120_000);
  });

  test('United Kingdom, MTD: turnover cumulated since 6 April, expenses to enter', () => {
    const { rules, prepare } = rulesOf('GB', 'mtd_quarterly_update');
    const result = prepareDeclaration({
      ...base,
      rules,
      prepare,
      profile: profile('sole_trader', { options: ['mtd_itsa'] }),
      receipts: [
        { date: '2026-04-01', cents: 100_000 },
        { date: '2026-04-10', cents: 300_000 },
        { date: '2026-08-01', cents: 400_000 },
        { date: '2026-11-01', cents: 500_000 },
      ],
      fiscalStart: '2026-04-06',
      periodStart: '2026-04-06',
      periodEnd: '2026-10-05',
    });
    expect(result.lines.map((line) => [line.id, line.cents])).toEqual([
      ['turnover', 700_000],
      ['expenses', null],
    ]);
    expect(result.amount).toBeNull();
  });

  test('United Kingdom, payment on account: half of last year’s bill', () => {
    const { rules, prepare } = rulesOf('GB', 'payment_on_account_1');
    const notice = {
      perOccurrenceCents: null,
      priorYearTaxCents: 684_321,
      priorYearIncomeCents: null,
      method: null,
    };
    const result = prepareDeclaration({
      ...base,
      rules,
      prepare,
      profile: profile('sole_trader'),
      receipts: [],
      fiscalStart: '2026-04-06',
      periodStart: '2027-01-31',
      periodEnd: '2027-01-31',
      notice,
    });
    // 6 843,21 / 2 = 3 421,605, rounded to 3 421,61.
    expect(result.amount?.cents).toBe(342_161);
  });

  describe('United States, 1040-ES', () => {
    const { rules, prepare } = rulesOf('US', 'estimated_tax');
    const input = {
      ...base,
      rules,
      prepare,
      profile: profile('sole_proprietor'),
      receipts: [{ date: '2026-06-30', cents: 6_000_000 }],
      periodStart: '2026-06-01',
      periodEnd: '2026-08-31',
    };
    const notice = (agi: number, method: DeadlineNotice['method'] = null) => ({
      perOccurrenceCents: null,
      priorYearTaxCents: 2_000_000,
      priorYearIncomeCents: agi,
      method,
    });

    test('safe harbor by default: 25 % of last year’s tax, 27.5 % above $150,000 of AGI', () => {
      expect(prepareDeclaration({ ...input, notice: notice(10_000_000) }).amount).toMatchObject({
        method: 'prior_year_share',
        cents: 500_000,
      });
      expect(prepareDeclaration({ ...input, notice: notice(16_000_000) }).amount?.cents).toBe(550_000);
      expect(prepareDeclaration({ ...input, notice: notice(15_000_000) }).amount?.cents).toBe(500_000);
    });

    test('annualized method, third period: $60,000 to August 31 × 1.5, tax × 67.5 %, earlier payments deducted', () => {
      // $90,000: SE tax 83,115 × 12.4 % = 10,306.26 + 83,115 × 2.9 % = 2,410.34 → 12,716.60.
      // Income tax: 90,000 − 6,358.30 − 16,100 = 67,541.70, QBI 20 % = 13,508.34 → 54,033.36 taxable:
      // 1,240 + 4,560 + 3,633.36 × 22 % = 799.34 → 6,599.34. Total 19,315.94 × 67.5 % = 13,038.26; − 5,000 paid.
      const result = prepareDeclaration({
        ...input,
        notice: notice(0, 'annualized'),
        paidBeforeCents: 500_000,
      });
      expect(result.amount?.steps).toEqual([
        { kind: 'annualized_income', cents: 9_000_000, rateBp: 15_000 },
        { kind: 'annualized_tax', cents: 1_931_594 },
        { kind: 'cumulative_share', cents: 1_303_826, rateBp: 6750 },
        { kind: 'paid_before', cents: -500_000 },
      ]);
      expect(result.amount?.cents).toBe(803_826);
    });
  });
});

describe('expenses in the estimates', () => {
  const estimates = (country: string, facts: RuleProfile, cents: number) =>
    Object.fromEntries(
      computeEstimates(packs.rules(country, 2026)?.rules as YearRules, facts, [
        { date: '2026-10-01', cents },
      ]).map((item) => [item.id, item.cents]),
    );

  test('United Kingdom: the trading allowance or the expenses, whichever is larger, never both', () => {
    const trader = profile('sole_trader');
    // £500 of expenses: the £1,000 allowance stays, profit 39,000 → 26,430 × 20 % and × 6 %.
    expect(estimates('GB', { ...trader, expensesCents: 50_000 }, 4_000_000)).toMatchObject({
      income_tax: 528_600,
      class4_nic: 158_580,
    });
    // £5,000 of expenses: profit 35,000 → 22,430 × 20 % = 4,486 and × 6 % = 1,345.80.
    expect(estimates('GB', { ...trader, expensesCents: 500_000 }, 4_000_000)).toMatchObject({
      income_tax: 448_600,
      class4_nic: 134_580,
    });
  });

  test('France, micro: expenses change nothing (flat-rate allowance only)', () => {
    const liberal = profile('micro_bnc', { declarationPeriod: 'monthly' });
    expect(estimates('FR', { ...liberal, expensesCents: 1_000_000 }, 5_000_000)).toEqual(
      estimates('FR', liberal, 5_000_000),
    );
  });
});
