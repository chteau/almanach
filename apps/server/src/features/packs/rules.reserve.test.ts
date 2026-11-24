import { describe, expect, test } from 'bun:test';
import {
  computeEstimates,
  computeReserve,
  type Receipt,
  type RuleProfile,
  type YearRules,
} from '@almanach/shared';
import { PackRegistry } from './packs.ts';

const packs = await PackRegistry.load();

/**
 * Rules of 2026 for a country, failing the test when missing
 *
 * @param country {string} - ISO code
 * @returns {YearRules} - the rules
 */
function rules2026(country: string): YearRules {
  const found = packs.rules(country, 2026);
  if (!found || found.fallback) throw new Error(`no ${country} 2026 rules`);
  return found.rules;
}

/**
 * French income tax at the scale for one profile and yearly revenue
 *
 * @param profile {Partial<RuleProfile>} - profile overrides
 * @param cents {number} - yearly revenue collected
 * @returns {number | undefined} - income tax in cents
 */
function frTax(profile: Partial<RuleProfile>, cents: number): number | undefined {
  const facts: RuleProfile = {
    status: 'micro_bnc',
    options: [],
    declarationPeriod: 'monthly',
    activityStart: '2020-01-01',
    ...profile,
  };
  return computeEstimates(rules2026('FR'), facts, [{ date: '2026-06-30', cents }], ['income_tax_bareme'])[0]
    ?.cents;
}

describe('reserve rules of every pack', () => {
  test('name only estimates and deadlines of their own year', () => {
    for (const pack of packs.list()) {
      for (const year of packs.publishedYears(pack.country)) {
        const rules = packs.rules(pack.country, year)?.rules;
        if (!rules?.reserve) continue;
        for (const id of rules.reserve.include)
          expect(rules.estimates.some((estimate) => estimate.id === id)).toBe(true);
        for (const settle of rules.reserve.settles)
          expect(rules.deadlines.some((deadline) => deadline.id === settle.deadline)).toBe(true);
        expect(pack.features?.reserve).toBeDefined();
        expect(pack.minAppVersion).toBe('0.1.0');
      }
    }
  });
});

describe('French income tax at the scale (revenus 2025 scale)', () => {
  test('one part, BNC 50 000 €: taxable 33 000 €, 11 % then 30 %, no décote', () => {
    // 17 979 × 11 % = 1 977,69 ; 3 421 × 30 % = 1 026,30.
    expect(frTax({}, 5_000_000)).toBe(300_399);
  });

  test('with the versement libératoire, no tax at the scale', () => {
    expect(frTax({ options: ['versement_liberatoire'] }, 5_000_000)).toBeUndefined();
  });

  test('BIC services 50 000 €: taxable 25 000 €, décote of 897 € − 45,25 %', () => {
    // 13 400 × 11 % = 1 474 € ; décote 897 − 666,99 = 230,01 € ; 1 243,99 €.
    expect(frTax({ status: 'micro_bic_services' }, 5_000_000)).toBe(124_399);
  });

  test('small income: the décote wipes the tax out', () => {
    // Taxable 15 000 €: 374 €, décote 897 − 169,24 > 374.
    expect(frTax({ status: 'micro_bic_services' }, 3_000_000)).toBe(0);
  });

  test('couple with 2.5 parts: the extra half-part is capped at 1 807 €', () => {
    // Taxable 80 000 €. 2 parts: 2 × (1 977,69 + 10 421 × 30 %) = 10 207,98 €, minus 1 807 € = 8 400,98 €,
    // more than the 6 759,98 € of the quotient with 2.5 parts.
    const household = { partsQuarters: 10, joint: true };
    expect(frTax({ status: 'micro_bic_services', household }, 16_000_000)).toBe(840_098);
  });
});

describe('reserve computation', () => {
  const liberal: RuleProfile = {
    status: 'micro_bnc',
    options: [],
    declarationPeriod: 'monthly',
    activityStart: '2020-01-01',
  };
  const months = Array.from({ length: 10 }, (_, index) => ({
    date: `2026-${String(index + 1).padStart(2, '0')}-15`,
    cents: 500_000,
  }));
  const receipts: Receipt[] = [...months, { date: '2026-11-10', cents: 300_000 }];
  const base = {
    rules: rules2026('FR'),
    reserve: rules2026('FR').reserve as NonNullable<YearRules['reserve']>,
    profile: liberal,
    receipts,
    marginBp: 1000,
    extraRateBp: 0,
    extraMonthlyCents: 0,
    monthsElapsed: 11,
  };

  test('France, monthly: year to date with a 10 % margin, nine declarations paid', () => {
    // 53 000 €: contributions 13 568 €, CFP 106 €, income tax 3 597,99 € (taxable 34 980 €) = 17 271,99 €;
    // margin 1 727,20 €; January to September paid: 9 × 1 280 € = 11 520 €.
    const result = computeReserve({ ...base, paid: { contributions_bnc: 1_152_000 } });
    expect(result.estimatedCents).toBe(1_727_199);
    expect(result.marginCents).toBe(172_720);
    expect(result.reserveCents).toBe(747_919);
  });

  test('personal extra: 1 % of revenue plus 50 € per month elapsed', () => {
    const result = computeReserve({ ...base, paid: {}, extraRateBp: 100, extraMonthlyCents: 5_000 });
    expect(result.extraCents).toBe(53_000 + 55_000);
    expect(result.reserveCents).toBe(1_727_199 + 172_720 + 108_000);
  });

  test('a payment above its estimate is not carried to the others, and the reserve never goes negative', () => {
    const over = computeReserve({ ...base, paid: { contributions_bnc: 99_999_999 } });
    expect(over.reserveCents).toBe(1_727_199 - 1_356_800 + 172_720);
    const none = computeReserve({ ...base, receipts: [], paid: { contributions_bnc: 10_000 } });
    expect(none.reserveCents).toBe(0);
  });

  test('United Kingdom: £40,000 takings, trading allowance, first payment on account made', () => {
    // Profit 39 000 after the £1,000 allowance: income tax 26 430 × 20 % = 5 286 ; Class 4 26 430 × 6 % = 1 585,80.
    const uk = rules2026('GB');
    const result = computeReserve({
      rules: uk,
      reserve: uk.reserve as NonNullable<YearRules['reserve']>,
      profile: {
        status: 'sole_trader',
        options: [],
        declarationPeriod: 'yearly',
        activityStart: '2020-01-01',
      },
      receipts: [{ date: '2026-10-01', cents: 4_000_000 }],
      paid: { income_tax: 150_000, class4_nic: 50_000 },
      marginBp: 1000,
      extraRateBp: 0,
      extraMonthlyCents: 0,
      monthsElapsed: 8,
    });
    expect(result.components.map((item) => [item.id, item.cents])).toEqual([
      ['income_tax', 528_600],
      ['class4_nic', 158_580],
    ]);
    expect(result.reserveCents).toBe(687_180 + 68_718 - 200_000);
  });
});
