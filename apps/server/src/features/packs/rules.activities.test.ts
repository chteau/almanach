import { describe, expect, test } from 'bun:test';
import {
  activityBreakdown,
  computeEstimates,
  expandDeadlines,
  measureThresholds,
  packFeatures,
  type Receipt,
  type RuleProfile,
} from '@almanach/shared';
import { PackRegistry } from './packs.ts';

// Several activities outside France, checked on 2026-11-24 against the sources quoted in the packs.
const packs = await PackRegistry.load();

/**
 * Rules of a published year, failing the test when missing
 *
 * @param country {string} - ISO code
 * @param year {number} - fiscal year
 * @returns {import('@almanach/shared').YearRules} - the rules
 */
function rulesOf(country: string, year: number) {
  const found = packs.rules(country, year);
  if (!found || found.fallback) throw new Error(`no ${country} ${year} rules`);
  return found.rules;
}

/**
 * Estimates by id
 *
 * @param country {string} - ISO code
 * @param profile {RuleProfile} - situation
 * @param receipts {Receipt[]} - money collected
 * @returns {Record<string, number>} - estimate id → cents
 */
function byId(country: string, profile: RuleProfile, receipts: Receipt[]): Record<string, number> {
  return Object.fromEntries(
    computeEstimates(rulesOf(country, 2026), profile, receipts).map((result) => [result.id, result.cents]),
  );
}

const base = {
  options: [] as string[],
  declarationPeriod: 'quarterly',
  activityStart: '2020-01-01',
} as const;

describe('maturity per function', () => {
  test('each pack declares what it offers; everything else is unavailable', () => {
    const features = Object.fromEntries(packs.list().map((pack) => [pack.country, packFeatures(pack)]));
    expect(features).toEqual({
      DE: {
        thresholds: 'experimental',
        estimates: 'experimental',
        deadlines: 'experimental',
        activities: 'experimental',
        reserve: 'experimental',
        prepare: 'experimental',
        expenses: 'experimental',
        vault_types: 'experimental',
        einvoicing: 'experimental',
      },
      FR: {
        thresholds: 'verified',
        estimates: 'verified',
        deadlines: 'verified',
        activities: 'verified',
        reserve: 'experimental',
        prepare: 'experimental',
        expenses: 'experimental',
        vault_types: 'experimental',
        einvoicing: 'verified',
      },
      GB: {
        thresholds: 'verified',
        estimates: 'verified',
        deadlines: 'verified',
        reserve: 'verified',
        prepare: 'experimental',
        expenses: 'experimental',
        vault_types: 'experimental',
      },
      US: {
        estimates: 'experimental',
        deadlines: 'experimental',
        activities: 'experimental',
        reserve: 'experimental',
        prepare: 'experimental',
        expenses: 'experimental',
        vault_types: 'experimental',
      },
    });
  });

  test('a pack made before per-function maturity keeps its former functions at its overall maturity', () => {
    expect(packFeatures({ maturity: 'experimental' })).toEqual({
      thresholds: 'experimental',
      estimates: 'experimental',
      deadlines: 'experimental',
      activities: 'experimental',
    });
  });

  test('rules of a function the pack does not offer are left out', () => {
    const fr = packs.get('FR');
    if (!fr) throw new Error('no FR pack');
    const registry = new PackRegistry(
      new Map([['FR', { ...fr, features: { deadlines: 'verified' } }]]),
      new Map([['FR', packs.yearsOf('FR')]]),
    );
    const rules = registry.rules('FR', 2026)?.rules;
    expect(rules?.thresholds).toEqual([]);
    expect(rules?.estimates).toEqual([]);
    expect(rules?.allowances).toEqual([]);
    expect(rules?.deadlines.length).toBeGreaterThan(0);
  });
});

describe('Germany: Freiberufler and Gewerbe', () => {
  const both: RuleProfile = { ...base, status: 'freiberufler', activities: ['gewerbe'] };
  const receipts: Receipt[] = [
    { date: '2026-03-01', cents: 3_000_000 },
    { date: '2026-04-01', cents: 3_000_000, category: 'gewerbe' },
  ];

  test('income tax once on the total (§ 2 EStG), not per activity', () => {
    // § 32a EStG on 60,000 €: z = 4.2201, (173.10 z + 2,397) z + 1,034.87 = 14,233 € (two times 30,000 € would be
    // 2 × 4,217 € = 8,434 €).
    expect(byId('DE', both, receipts)).toEqual({ income_tax: 1_423_300 });
    const rows = activityBreakdown(rulesOf('DE', 2026), both, receipts);
    expect(rows.map((row) => [row.status, row.revenueCents, row.estimates.length])).toEqual([
      ['freiberufler', 3_000_000, 0],
      ['gewerbe', 3_000_000, 0],
    ]);
  });

  test('the small-business limit counts every activity (§ 2 and § 19 UStG)', () => {
    const [previous] = measureThresholds(
      rulesOf('DE', 2026),
      { ...both, options: ['kleinunternehmer'] },
      [
        { date: '2025-05-01', cents: 1_500_000 },
        { date: '2025-06-01', cents: 1_200_000, category: 'gewerbe' },
      ],
      { start: '2026-01-01', end: '2026-12-31' },
      '2026-11-24',
      null,
    );
    expect(previous).toMatchObject({
      id: 'kleinunternehmer_previous_year',
      reachedCents: 2_700_000,
      exceeded: true,
    });
  });

  test('trade tax prepayments only with a Gewerbe activity (§ 2 GewStG)', () => {
    const ids = (profile: RuleProfile) =>
      new Set(expandDeadlines(rulesOf('DE', 2026), profile, packs.holidays('DE')).map((item) => item.ruleId));
    expect(ids({ ...base, status: 'freiberufler' }).has('gewst_vorauszahlung')).toBe(false);
    expect(ids(both).has('gewst_vorauszahlung')).toBe(true);
  });
});

describe('United States: one Schedule C per business', () => {
  const both: RuleProfile = { ...base, status: 'sole_proprietor', activities: ['single_member_llc'] };
  const receipts: Receipt[] = [
    { date: '2026-03-01', cents: 5_000_000 },
    { date: '2026-04-01', cents: 5_000_000, category: 'single_member_llc' },
  ];

  test('self-employment tax on the combined net earnings, income tax on the total', () => {
    // 100,000 × 92.35 % = 92,350; × 12.4 % = 11,451.40 and × 2.9 % = 2,678.15 → 14,129.55.
    const combined = byId('US', both, receipts);
    expect(combined.self_employment_tax).toBe(1_412_955);
    expect(combined).toEqual(
      byId('US', { ...base, status: 'sole_proprietor' }, [{ date: '2026-03-01', cents: 10_000_000 }]),
    );
  });

  test('revenue stays split per business', () => {
    const rows = activityBreakdown(rulesOf('US', 2026), both, receipts);
    expect(rows.map((row) => [row.status, row.revenueCents])).toEqual([
      ['sole_proprietor', 5_000_000],
      ['single_member_llc', 5_000_000],
    ]);
  });
});

describe('United Kingdom: several trades', () => {
  test('activities are not offered: one status, every trade in one company', () => {
    expect(packFeatures(packs.get('GB') ?? { maturity: 'verified' }).activities).toBeUndefined();
  });

  test('income tax, Class 4 and the VAT threshold use the total of the trades', () => {
    const soleTrader: RuleProfile = { ...base, status: 'sole_trader', declarationPeriod: 'yearly' };
    const receipts: Receipt[] = [
      { date: '2026-05-01', cents: 4_000_000 },
      { date: '2026-10-01', cents: 5_100_000 },
    ];
    // 91,000 − 1,000 trading allowance = 90,000: (90,000 − 12,570 − 37,700 = 39,730) × 40 % + 37,700 × 20 %
    // = 15,892 + 7,540 = 23,432; Class 4: 37,700 × 6 % + 39,730 × 2 % = 2,262 + 794.60 = 3,056.60.
    expect(byId('GB', soleTrader, receipts)).toEqual({ income_tax: 2_343_200, class4_nic: 305_660 });
    const [vat] = measureThresholds(
      rulesOf('GB', 2026),
      soleTrader,
      receipts,
      { start: '2026-04-06', end: '2027-04-05' },
      '2026-11-24',
      null,
    );
    expect(vat).toMatchObject({ id: 'vat_registration', reachedCents: 9_100_000, exceeded: true });
  });
});
