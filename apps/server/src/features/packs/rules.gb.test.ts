import { describe, expect, test } from 'bun:test';
import {
  activityBreakdown,
  computeEstimates,
  expandDeadlines,
  measureThresholds,
  prepareDeclaration,
  type RuleProfile,
} from '@almanach/shared';
import { allowableExpenses } from '../planning/planning.service.ts';
import { PackRegistry } from './packs.ts';

// United Kingdom pack, checked on gov.uk on 2026-11-26. Expected amounts are worked out by hand in the comments.
const packs = await PackRegistry.load();
const soleTrader: RuleProfile = {
  status: 'sole_trader',
  options: [],
  declarationPeriod: 'yearly',
  activityStart: '2020-01-01',
};

/**
 * UK rules of a published year, failing the test when missing
 *
 * @param year {number} - tax year starting on 6 April of that year
 * @returns {import('@almanach/shared').YearRules} - the rules
 */
function rulesOf(year: number) {
  const found = packs.rules('GB', year);
  if (!found || found.fallback) throw new Error(`no GB ${year} rules`);
  return found.rules;
}

/**
 * 2026-27 estimates in pence for a yearly profit after the £1,000 trading allowance: the takings are the profit
 * plus £1,000, received in one payment
 *
 * @param options {string[]} - pack options of the profile
 * @param pence {number} - yearly profit, trading allowance deducted
 * @returns {Record<string, number>} - estimate id → pence
 */
function yearly(options: string[], pence: number): Record<string, number> {
  const results = computeEstimates(rulesOf(2026), { ...soleTrader, options }, [
    { date: '2026-06-30', cents: pence + 100_000 },
  ]);
  return Object.fromEntries(results.map((result) => [result.id, result.cents]));
}

/**
 * Due dates by rule id for the obligations of a tax year
 *
 * @param year {number} - tax year
 * @param options {string[]} - pack options of the profile
 * @returns {Record<string, string[]>} - rule id → due dates in order
 */
function dues(year: number, options: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const item of expandDeadlines(rulesOf(year), { ...soleTrader, options }, packs.holidays('GB'))) {
    out[item.ruleId] = [...(out[item.ruleId] ?? []), item.due];
  }
  return out;
}

describe('United Kingdom pack', () => {
  test('is verified, in pounds, with a tax year from 6 April and sole traders only', () => {
    const pack = packs.get('GB');
    expect(pack).toMatchObject({ maturity: 'verified', currency: 'GBP', fiscalYearStart: '04-06' });
    expect(pack?.statuses.map((status) => status.id)).toEqual(['sole_trader']);
    expect(pack?.invoice.vatRateBp).toBe(2000);
  });

  test('every function is verified; activities and e-invoicing are not offered', () => {
    expect(packs.get('GB')?.features).toEqual({
      thresholds: 'verified',
      estimates: 'verified',
      deadlines: 'verified',
      reserve: 'verified',
      prepare: 'verified',
      expenses: 'verified',
      vault_types: 'verified',
    });
  });

  test('every rule, prepared declaration and vault kind cites gov.uk and was checked on 2026-11-26', () => {
    const sourced: { source?: string; verified_on?: string }[] = [...(packs.get('GB')?.vault?.kinds ?? [])];
    for (const year of packs.publishedYears('GB')) {
      const rules = rulesOf(year);
      sourced.push(...rules.thresholds, ...rules.estimates, ...rules.allowances, ...rules.deadlines);
      for (const deadline of rules.deadlines) if (deadline.prepare) sourced.push(deadline.prepare);
      if (rules.reserve) sourced.push(rules.reserve);
    }
    for (const item of sourced) {
      expect(item.source?.startsWith('https://www.gov.uk/')).toBe(true);
      expect(item.verified_on).toBe('2026-11-26');
    }
  });
});

describe('United Kingdom 2026-27 income tax (England, Wales, Northern Ireland)', () => {
  test('nothing is due up to the £12,570 personal allowance', () => {
    expect(yearly([], 1_257_000)).toEqual({ income_tax: 0, class4_nic: 0 });
  });

  test('basic rate up to £50,270', () => {
    // 50,270 − 12,570 = 37,700 × 20 % = 7,540.00
    expect(yearly([], 5_027_000).income_tax).toBe(754_000);
  });

  test('higher rate above £50,270', () => {
    // 7,540 + (60,000 − 50,270 = 9,730) × 40 % = 3,892 → 11,432.00
    expect(yearly([], 6_000_000).income_tax).toBe(1_143_200);
  });

  test('the personal allowance is whole at £100,000', () => {
    // 7,540 + (100,000 − 50,270 = 49,730) × 40 % = 19,892 → 27,432.00
    expect(yearly([], 10_000_000).income_tax).toBe(2_743_200);
  });

  test('the personal allowance loses £1 for every £2 above £100,000', () => {
    // £100,002: allowance 12,569, taxable 87,433 = 37,700 × 20 % (7,540) + 49,733 × 40 % (19,893.20) → 27,433.20
    expect(yearly([], 10_000_200).income_tax).toBe(2_743_320);
    // £100,001: £1 above, not yet a full £2, so the allowance stays at 12,570
    expect(yearly([], 10_000_100).income_tax).toBe(2_743_240);
  });

  test('the personal allowance is zero from £125,140', () => {
    // 37,700 × 20 % (7,540) + (125,140 − 37,700 = 87,440) × 40 % (34,976) → 42,516.00
    expect(yearly([], 12_514_000).income_tax).toBe(4_251_600);
  });

  test('additional rate above £125,140', () => {
    // 7,540 + 34,976 + (150,000 − 125,140 = 24,860) × 45 % (11,187) → 53,703.00
    expect(yearly([], 15_000_000).income_tax).toBe(5_370_300);
  });

  test('Northern Ireland uses the same bands', () => {
    // (30,000 − 12,570 = 17,430) × 20 % = 3,486.00
    expect(yearly(['northern_ireland'], 3_000_000)).toEqual({ income_tax: 348_600, class4_nic: 104_580 });
  });
});

describe('United Kingdom 2026-27 Scottish income tax', () => {
  test('replaces the rest-of-UK bands for Scottish taxpayers', () => {
    // Taxable 60,000 − 12,570 = 47,430: 3,967 × 19 % (753.73) + 12,989 × 20 % (2,597.80)
    // + 14,136 × 21 % (2,968.56) + 16,338 × 42 % (6,861.96) → 13,182.05
    expect(yearly(['scotland'], 6_000_000)).toEqual({ income_tax_scotland: 1_318_205, class4_nic: 245_660 });
  });

  test('advanced and top rates once the allowance is gone', () => {
    // Taxable 150,000: 753.73 + 2,597.80 + 2,968.56 + 31,338 × 42 % (13,161.96)
    // + 62,710 × 45 % (28,219.50) + 24,860 × 48 % (11,932.80) → 59,634.35
    expect(yearly(['scotland'], 15_000_000).income_tax_scotland).toBe(5_963_435);
  });
});

describe('United Kingdom 2026-27 Class 4 National Insurance', () => {
  test('6 % between £12,570 and £50,270', () => {
    // (20,000 − 12,570 = 7,430) × 6 % = 445.80
    expect(yearly([], 2_000_000).class4_nic).toBe(44_580);
    // 37,700 × 6 % = 2,262.00
    expect(yearly([], 5_027_000).class4_nic).toBe(226_200);
  });

  test('2 % above £50,270', () => {
    // 2,262 + (150,000 − 50,270 = 99,730) × 2 % (1,994.60) → 4,256.60
    expect(yearly([], 15_000_000).class4_nic).toBe(425_660);
  });

  test('no Class 2 charge: it is treated as paid and only voluntary', () => {
    expect(rulesOf(2026).estimates.map((estimate) => estimate.id)).toEqual([
      'income_tax',
      'income_tax_scotland',
      'class4_nic',
    ]);
  });
});

describe('United Kingdom VAT registration threshold', () => {
  const measure = (options: string[], receipts: { date: string; cents: number }[]) =>
    measureThresholds(
      rulesOf(2026),
      { ...soleTrader, options },
      receipts,
      { start: '2026-04-06', end: '2027-04-05' },
      '2026-11-24',
      null,
    );

  test('£90,000 over the last 12 months is not over the threshold, a penny more is', () => {
    // Window 25 November 2025 to 24 November 2026; the receipt of 24 November 2025 falls outside it.
    const at = measure(
      [],
      [
        { date: '2025-11-24', cents: 1_000_000 },
        { date: '2025-11-25', cents: 4_000_000 },
        { date: '2026-11-24', cents: 5_000_000 },
      ],
    );
    expect(at[0]).toMatchObject({ id: 'vat_registration', limitCents: 9_000_000, reachedCents: 9_000_000 });
    expect(at[0]?.exceeded).toBe(false);
    expect(measure([], [{ date: '2026-05-01', cents: 9_000_001 }])[0]?.exceeded).toBe(true);
  });

  test('is not watched once registered, and explains the 30-day rules and £88,000 deregistration', () => {
    expect(
      measure(['vat_registered'], [{ date: '2026-05-01', cents: 9_500_000 }]).map((item) => item.id),
    ).toEqual(['vat_deregistration']);
    const text = rulesOf(2026).thresholds[0]?.consequence.en ?? '';
    expect(text).toContain('within 30 days of the end of the month');
    expect(text).toContain('next 30 days');
    expect(text).toContain('£88,000');
  });
});

describe('United Kingdom deadlines', () => {
  test('Self Assessment and payments on account for 2026-27', () => {
    expect(dues(2026, [])).toEqual({
      payment_on_account_1: ['2027-01-31'],
      payment_on_account_2: ['2027-07-31'],
      self_assessment_paper: ['2027-10-31'],
      self_assessment_online: ['2028-01-31'],
    });
  });

  test('2025-26 return still due: paper 31 October 2026, online 31 January 2027', () => {
    expect(dues(2025, [])).toEqual({
      payment_on_account_2: ['2026-07-31'],
      self_assessment_paper: ['2026-10-31'],
      self_assessment_online: ['2027-01-31'],
    });
  });

  test('registration by 5 October after the tax year trading started', () => {
    expect(dues(2025, ['sa_not_registered']).self_assessment_registration).toEqual(['2026-10-05']);
    expect(dues(2026, ['sa_not_registered']).self_assessment_registration).toEqual(['2027-10-05']);
  });

  test('Making Tax Digital quarterly updates, cumulative from 6 April, never moved off weekends', () => {
    const updates = expandDeadlines(
      rulesOf(2026),
      { ...soleTrader, options: ['mtd_itsa'] },
      packs.holidays('GB'),
    )
      .filter((item) => item.ruleId === 'mtd_quarterly_update')
      .map((item) => [item.periodStart, item.periodEnd, item.due, item.movedFrom]);
    // 7 November 2026 is a Saturday and 7 February 2027 a Sunday: HMRC keeps the date.
    expect(updates).toEqual([
      ['2026-04-06', '2026-07-05', '2026-08-07', null],
      ['2026-04-06', '2026-10-05', '2026-11-07', null],
      ['2026-04-06', '2027-01-05', '2027-02-07', null],
      ['2026-04-06', '2027-04-05', '2027-05-07', null],
    ]);
    expect(dues(2026, []).mtd_quarterly_update).toBeUndefined();
  });
});

describe('United Kingdom trading allowance', () => {
  const estimates = (pence: number) =>
    Object.fromEntries(
      computeEstimates(rulesOf(2026), soleTrader, [{ date: '2026-06-30', cents: pence }]).map((result) => [
        result.id,
        result.cents,
      ]),
    );

  test('takings up to £1,000 leave nothing to tax', () => {
    expect(estimates(80_000)).toEqual({ income_tax: 0, class4_nic: 0 });
    const [activity] = activityBreakdown(rulesOf(2026), soleTrader, [{ date: '2026-06-30', cents: 80_000 }]);
    expect(activity?.allowance).toMatchObject({
      allowanceCents: 80_000,
      taxableCents: 0,
      deductsFromProfit: true,
    });
  });

  test('£20,000 of takings: £1,000 off before income tax and Class 4', () => {
    // Profit 19,000 − 12,570 = 6,430: income tax × 20 % = 1,286.00, Class 4 × 6 % = 385.80.
    expect(estimates(2_000_000)).toEqual({ income_tax: 128_600, class4_nic: 38_580 });
  });

  test('one allowance per person: a second trade does not deduct it again', () => {
    const twoTrades = { ...soleTrader, activities: ['sole_trader'] };
    const receipts = [
      { date: '2026-05-01', cents: 1_200_000 },
      { date: '2026-09-01', cents: 800_000, category: 'sole_trader' },
    ];
    const results = computeEstimates(rulesOf(2026), twoTrades, receipts);
    expect(Object.fromEntries(results.map((result) => [result.id, result.cents]))).toEqual(
      estimates(2_000_000),
    );
  });
});

describe('United Kingdom VAT deregistration threshold', () => {
  const measure = (pence: number) =>
    measureThresholds(
      rulesOf(2026),
      { ...soleTrader, options: ['vat_registered'] },
      [{ date: '2026-05-01', cents: pence }],
      { start: '2026-04-06', end: '2027-04-05' },
      '2026-11-24',
      null,
    );

  test('warns once taxable turnover of the last 12 months falls below £88,000', () => {
    expect(measure(8_799_999)[0]).toMatchObject({
      id: 'vat_deregistration',
      direction: 'below',
      limitCents: 8_800_000,
      fellBelow: true,
      exceeded: false,
      remainingCents: 0,
      projectedDate: null,
    });
  });

  test('stays quiet at £88,000 and above, never reported as exceeded', () => {
    expect(measure(8_800_000)[0]).toMatchObject({ fellBelow: false, exceeded: false });
    expect(measure(9_500_000)[0]).toMatchObject({ fellBelow: false, exceeded: false });
  });

  test('cites gov.uk', () => {
    expect(rulesOf(2026).thresholds.find((rule) => rule.id === 'vat_deregistration')?.source).toBe(
      'https://www.gov.uk/register-for-vat/cancel-your-registration',
    );
  });
});

describe('United Kingdom expenses', () => {
  const estimates = (pence: number, expensesCents: number) =>
    Object.fromEntries(
      computeEstimates(rulesOf(2026), { ...soleTrader, expensesCents }, [
        { date: '2026-06-30', cents: pence },
      ]).map((result) => [result.id, result.cents]),
    );
  const pack = packs.get('GB');
  if (!pack) throw new Error('no GB pack');
  const paid = [{ date: '2026-05-02', netCents: 10_000, vatCents: 2_000 }];

  test('not VAT registered: the VAT paid is part of the allowable cost', () => {
    expect(allowableExpenses(pack, [], paid)).toEqual([
      { date: '2026-05-02', netCents: 12_000, vatCents: 0 },
    ]);
  });

  test('VAT registered: only the amount before the reclaimable VAT is an expense', () => {
    expect(allowableExpenses(pack, ['vat_registered'], paid)).toEqual(paid);
  });

  test('expenses larger than takings leave no profit, the trading allowance never makes a loss', () => {
    expect(estimates(300_000, 500_000)).toEqual({ income_tax: 0, class4_nic: 0 });
    expect(estimates(60_000, 0)).toEqual({ income_tax: 0, class4_nic: 0 });
  });

  test('£1,000 of expenses equals the allowance: the profit is the same either way', () => {
    expect(estimates(3_000_000, 100_000)).toEqual(estimates(3_000_000, 0));
    // £1,000.01 of expenses: one more penny off, 28,999.99 − 12,570 = 16,429.99 × 20 % = 3,286.00 (3,285.998).
    expect(estimates(3_000_000, 100_001).income_tax).toBe(328_600);
  });

  test('tells what is allowable, VAT included without registration, never both with the allowance', () => {
    const note = pack.expensesNote?.en ?? '';
    expect(note).toContain('client entertaining and buying a car are not allowable');
    expect(note).toContain('not VAT registered, the VAT you paid is part of the cost');
    expect(note).toContain('you cannot claim both');
  });
});

describe('United Kingdom prepared declarations', () => {
  const prepare = (year: number, deadline: string) => {
    const rules = rulesOf(year);
    const block = rules.deadlines.find((rule) => rule.id === deadline)?.prepare;
    if (!block) throw new Error(`no prepare block for ${deadline}`);
    return { rules, prepare: block };
  };
  const base = { invoiced: [], notice: null, estimatesCents: 0, paidBeforeCents: 0 };

  test('2025-26 return: SA103S box 9 turnover received in the tax year, box 20 total expenses', () => {
    const result = prepareDeclaration({
      ...base,
      ...prepare(2025, 'self_assessment_online'),
      profile: soleTrader,
      receipts: [
        { date: '2025-04-05', cents: 999_999 },
        { date: '2025-04-06', cents: 1_500_000 },
        { date: '2026-04-05', cents: 2_000_000 },
        { date: '2026-04-06', cents: 999_999 },
      ],
      expenses: [
        { date: '2025-04-06', netCents: 30_000, vatCents: 0 },
        { date: '2026-04-06', netCents: 99_999, vatCents: 0 },
      ],
      fiscalStart: '2025-04-06',
      fiscalYear: 2025,
      periodStart: '2025-04-06',
      periodEnd: '2026-04-05',
    });
    expect(result.lines.map((line) => [line.label.en, line.cents])).toEqual([
      ['Box 9 — Turnover', 3_500_000],
      ['Box 20 — Total allowable expenses', 30_000],
    ]);
    expect(result.amount).toBeNull();
    expect(result.note?.en).toContain('below £90,000');
    expect(result.note?.en).toContain('trading allowance (box 10.1');
  });

  test('2026-27 return: the same figures, no box number until HMRC publishes the 2026-27 page', () => {
    const { prepare: block } = prepare(2026, 'self_assessment_online');
    expect(block.lines.map((line) => [line.id, line.measure, line.label.en])).toEqual([
      ['turnover', 'revenue', 'Turnover'],
      ['expenses', 'expenses', 'Total allowable expenses'],
    ]);
  });

  test('MTD update: turnover and consolidated expenses cumulated from 6 April', () => {
    const result = prepareDeclaration({
      ...base,
      ...prepare(2026, 'mtd_quarterly_update'),
      profile: { ...soleTrader, options: ['mtd_itsa'] },
      receipts: [
        { date: '2026-04-10', cents: 300_000 },
        { date: '2026-08-01', cents: 400_000 },
        { date: '2026-10-06', cents: 500_000 },
      ],
      expenses: [
        { date: '2026-05-01', netCents: 12_000, vatCents: 0 },
        { date: '2026-09-30', netCents: 8_000, vatCents: 0 },
        { date: '2026-10-06', netCents: 5_000, vatCents: 0 },
      ],
      fiscalStart: '2026-04-06',
      fiscalYear: 2026,
      periodStart: '2026-04-06',
      periodEnd: '2026-10-05',
    });
    expect(result.lines.map((line) => [line.id, line.cents])).toEqual([
      ['turnover', 700_000],
      ['expenses', 20_000],
    ]);
    expect(result.note?.en).toContain('Below £90,000 of annual turnover the expenses total is enough');
  });
});

describe('United Kingdom vault kinds', () => {
  test('UTR letter, VAT confirmation once registered, insurance with an expiry, employment status check', () => {
    const kinds = packs.get('GB')?.vault?.kinds ?? [];
    expect(kinds.map((kind) => [kind.id, kind.expires, kind.appliesTo?.options ?? []])).toEqual([
      ['utr_letter', false, []],
      ['vat_certificate', false, ['vat_registered']],
      ['professional_indemnity', true, []],
      ['ir35_determination', false, []],
    ]);
    expect(kinds.find((kind) => kind.id === 'ir35_determination')?.source).toBe(
      'https://www.gov.uk/guidance/check-employment-status-for-tax',
    );
  });
});
