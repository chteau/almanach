import { describe, expect, test } from 'bun:test';
import {
  activityBreakdown,
  computeEstimates,
  expandDeadlines,
  measureThresholds,
  type Receipt,
  type RuleProfile,
} from '@almanach/shared';
import { PackRegistry } from './packs.ts';

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
 * Yearly estimates in whole cents for a profit received in one payment
 *
 * @param country {string} - ISO code
 * @param profile {Partial<RuleProfile>} - profile overrides
 * @param cents {number} - yearly profit
 * @returns {Record<string, number>} - estimate id → cents
 */
function yearly(country: string, profile: Partial<RuleProfile>, cents: number): Record<string, number> {
  const facts: RuleProfile = {
    status: null,
    options: [],
    declarationPeriod: null,
    activityStart: '2020-01-01',
    ...profile,
  };
  const results = computeEstimates(rulesOf(country, 2026), facts, [{ date: '2026-06-30', cents }]);
  return Object.fromEntries(results.map((result) => [result.id, result.cents]));
}

describe('every rule file', () => {
  test('cites an https source and a verification date for each figure', () => {
    for (const country of ['FR', 'DE', 'GB', 'US']) {
      for (const year of packs.publishedYears(country)) {
        const rules = rulesOf(country, year);
        for (const item of [...rules.thresholds, ...rules.estimates, ...rules.deadlines]) {
          expect(item.source.startsWith('https://')).toBe(true);
          expect(item.verified_on <= '2026-12-31').toBe(true);
        }
      }
    }
  });

  test('a pack with verified vault kinds cites an https source and a verification date for each kind', () => {
    for (const pack of packs.list()) {
      if (pack.features?.vault_types !== 'verified') continue;
      for (const kind of pack.vault?.kinds ?? []) {
        expect(kind.source?.startsWith('https://')).toBe(true);
        expect(kind.verified_on).toBeDefined();
      }
    }
  });

  test('references only statuses and options its pack declares', () => {
    for (const pack of packs.list()) {
      const statuses = new Set(pack.statuses.map((status) => status.id));
      const options = new Set(pack.options.map((option) => option.id));
      for (const year of packs.publishedYears(pack.country)) {
        const rules = rulesOf(pack.country, year);
        const conditions = [
          ...rules.thresholds,
          ...rules.estimates,
          ...rules.deadlines,
          ...rules.holidays.filter((holiday) => holiday.appliesTo),
        ]
          .map((item) => item.appliesTo ?? {})
          .concat(rules.deadlines.flatMap((deadline) => deadline.prepare?.lines ?? []));
        for (const condition of conditions) {
          for (const status of condition.statuses ?? []) expect(statuses.has(status)).toBe(true);
          for (const option of [...(condition.options ?? []), ...(condition.withoutOptions ?? [])]) {
            expect(options.has(option)).toBe(true);
          }
        }
        for (const deadline of rules.deadlines) {
          for (const id of deadline.estimates)
            expect(rules.estimates.some((estimate) => estimate.id === id)).toBe(true);
        }
      }
    }
  });
});

describe('United Kingdom 2026-27', () => {
  // Takings are £1,000 above the profit: the £1,000 trading allowance is deducted first.
  test('£30,000 profit in England: income tax and Class 4', () => {
    expect(yearly('GB', {}, 3_100_000)).toEqual({ income_tax: 348_600, class4_nic: 104_580 });
  });

  test('personal allowance tapers above £100,000', () => {
    // Allowance 12,570 − 5,000 = 7,570; taxable 102,430 = 37,700 × 20 % + 64,730 × 40 %.
    expect(yearly('GB', {}, 11_100_000).income_tax).toBe(3_343_200);
  });

  test('Scottish taxpayers use the Scottish bands', () => {
    // 3,967 × 19 % + 12,989 × 20 % + 474 × 21 % on 30,000 − 12,570 = 17,430 taxable.
    expect(yearly('GB', { options: ['scotland'] }, 3_100_000).income_tax_scotland).toBe(
      75_373 + 259_780 + 9_954,
    );
  });

  test('deadlines never move off weekends', () => {
    const due = expandDeadlines(
      rulesOf('GB', 2025),
      { status: null, options: [], declarationPeriod: null, activityStart: '2020-01-01' },
      packs.holidays('GB'),
    );
    expect(due.find((item) => item.ruleId === 'self_assessment_online')?.due).toBe('2027-01-31');
  });

  test('VAT registration watches the last 12 months', () => {
    const facts: RuleProfile = {
      status: 'sole_trader',
      options: [],
      declarationPeriod: 'yearly',
      activityStart: '2020-01-01',
    };
    const [vat] = measureThresholds(
      rulesOf('GB', 2026),
      facts,
      [
        { date: '2025-11-01', cents: 5_000_000 },
        { date: '2025-12-01', cents: 4_500_000 },
      ],
      { start: '2026-04-06', end: '2027-04-05' },
      '2026-11-18',
      null,
    );
    expect(vat?.reachedCents).toBe(4_500_000);
    expect(vat?.exceeded).toBe(false);
  });
});

describe('United States 2026', () => {
  test('$80,000 profit, single filer', () => {
    const result = yearly('US', {}, 8_000_000);
    expect(result.self_employment_tax).toBe(916_112 + 214_252);
    expect(result.income_tax_single).toBe(534_382);
  });

  test('estimated tax due dates follow Form 1040-ES', () => {
    const due = expandDeadlines(
      rulesOf('US', 2026),
      { status: 'sole_proprietor', options: [], declarationPeriod: 'quarterly', activityStart: '2020-01-01' },
      packs.holidays('US'),
    );
    expect(due.filter((item) => item.ruleId === 'estimated_tax').map((item) => item.due)).toEqual([
      '2026-04-15',
      '2026-06-15',
      '2026-09-15',
      '2027-01-15',
    ]);
  });
});

describe('Germany 2026', () => {
  test('§ 32a EStG tariff in each zone, rounded down to euros', () => {
    expect(yearly('DE', {}, 1_234_800).income_tax).toBe(0);
    expect(yearly('DE', {}, 1_500_000).income_tax).toBe(43_500);
    expect(yearly('DE', {}, 5_000_000).income_tax).toBe(1_054_800);
    expect(yearly('DE', {}, 10_000_000).income_tax).toBe(3_086_400);
  });

  test('VAT returns move to the next working day (§ 108 AO)', () => {
    const due = expandDeadlines(
      rulesOf('DE', 2026),
      { status: 'freiberufler', options: [], declarationPeriod: 'monthly', activityStart: '2020-01-01' },
      packs.holidays('DE'),
    );
    const january = due.find((item) => item.key === 'ust_voranmeldung_monthly:2026-01-01');
    // 10 February 2026 is a Tuesday; 10 May 2026 is a Sunday.
    expect(january?.due).toBe('2026-02-10');
    const april = due.find((item) => item.key === 'ust_voranmeldung_monthly:2026-04-01');
    expect(april).toMatchObject({ due: '2026-05-11', movedFrom: '2026-05-10' });
    expect(due.some((item) => item.ruleId === 'gewst_vorauszahlung')).toBe(false);
  });

  test('small businesses watch both the previous and the current year', () => {
    const facts: RuleProfile = {
      status: 'freiberufler',
      options: ['kleinunternehmer'],
      declarationPeriod: 'yearly',
      activityStart: '2020-01-01',
    };
    const progress = measureThresholds(
      rulesOf('DE', 2026),
      facts,
      [{ date: '2026-03-01', cents: 3_000_000 }],
      { start: '2026-01-01', end: '2026-12-31' },
      '2026-06-30',
      2_600_000,
    );
    expect(progress.map((item) => [item.id, item.exceeded])).toEqual([
      ['kleinunternehmer_previous_year', true],
      ['kleinunternehmer_current_year', false],
    ]);
  });
});

describe('France 2026', () => {
  const liberal: RuleProfile = {
    status: 'micro_bnc',
    options: [],
    declarationPeriod: 'monthly',
    activityStart: '2024-01-01',
  };

  test('Urssaf deadlines move to the next working day, except the announced 31 October 2026', () => {
    const due = expandDeadlines(rulesOf('FR', 2026), liberal, packs.holidays('FR'));
    const byPeriod = Object.fromEntries(
      due.filter((item) => item.ruleId === 'urssaf_monthly').map((item) => [item.periodStart, item.due]),
    );
    expect(byPeriod['2026-01-01']).toBe('2026-03-02');
    expect(byPeriod['2026-04-01']).toBe('2026-06-01');
    expect(byPeriod['2026-09-01']).toBe('2026-10-31');
    expect(byPeriod['2026-12-01']).toBe('2027-02-01');
    expect(due.find((item) => item.ruleId === 'cfe')?.due).toBe('2026-12-15');
  });

  test('liberal profession: 25.6 % contributions, 2.2 % flat income tax, 0.2 % CFP', () => {
    expect(yearly('FR', { ...liberal, options: ['versement_liberatoire'] }, 1_000_000)).toEqual({
      contributions_bnc: 256_000,
      income_tax_bnc: 22_000,
      cfp_liberal: 2_000,
    });
  });

  test('ACRE halves the rate before July 2026 and keeps 75 % for later starts', () => {
    const early = computeEstimates(
      rulesOf('FR', 2026),
      { ...liberal, options: ['acre'], activityStart: '2026-02-10' },
      [
        { date: '2026-03-15', cents: 100_000 },
        { date: '2026-12-15', cents: 100_000 },
      ],
      ['contributions_bnc'],
    );
    // Reduced until 31 December 2026 (end of the 3rd quarter after Q1): 12.8 % on both receipts.
    expect(early[0]?.cents).toBe(25_600);
    const late = computeEstimates(
      rulesOf('FR', 2026),
      {
        status: 'micro_bic_services',
        options: ['acre'],
        declarationPeriod: 'monthly',
        activityStart: '2026-09-03',
      },
      [{ date: '2026-10-01', cents: 100_000 }],
      ['contributions_bic_services'],
    );
    // Service-public example: an electrician pays 15.9 % instead of 21.2 %.
    expect(late[0]?.steps[0]?.rateBp).toBe(1590);
  });

  test('VAT franchise: base limit then immediate liability above the tolerance', () => {
    const [ceiling, vat] = measureThresholds(
      rulesOf('FR', 2026),
      liberal,
      [{ date: '2026-05-01', cents: 3_900_000 }],
      { start: '2026-01-01', end: '2026-12-31' },
      '2026-11-18',
      null,
    );
    expect(ceiling?.id).toBe('micro_ceiling_services');
    expect(vat).toMatchObject({ id: 'vat_franchise_services', exceeded: true, toleranceExceeded: false });
  });

  describe('one micro-entreprise with activities tracked in linked instances', () => {
    const year = { start: '2026-01-01', end: '2026-12-31' };
    /**
     * Measures the thresholds of the liberal activity with receipts of linked activities
     *
     * @param local {number} - revenue of the liberal activity, in cents
     * @param linked {[string, number][]} - status and revenue of each linked activity
     * @returns {Record<string, object>} - thresholds by id
     */
    const measure = (local: number, linked: [string, number][]) =>
      Object.fromEntries(
        measureThresholds(
          rulesOf('FR', 2026),
          liberal,
          [
            { date: '2026-03-10', cents: local },
            ...linked.map(([category, cents]) => ({ date: '2026-04-01', cents, category, linked: true })),
          ],
          year,
          '2026-11-18',
          null,
        ).map(({ id, reachedCents, linkedCents, exceeded, toleranceExceeded }) => [
          id,
          { reachedCents, linkedCents, exceeded, toleranceExceeded },
        ]),
      );

    test('BNC and BIC services share the services ceilings', () => {
      expect(measure(3_000_000, [['micro_bic_services', 2_000_000]])).toEqual({
        micro_ceiling_services: {
          reachedCents: 5_000_000,
          linkedCents: 2_000_000,
          exceeded: false,
          toleranceExceeded: false,
        },
        // 50,000 € together: above 41,250 €, VAT is due at once although each activity alone is below 37,500 €.
        vat_franchise_services: {
          reachedCents: 5_000_000,
          linkedCents: 2_000_000,
          exceeded: true,
          toleranceExceeded: true,
        },
      });
    });

    test('mixed activity: global sales ceiling on everything, services sub-ceiling on services only', () => {
      expect(measure(3_000_000, [['micro_bic_sales', 10_000_000]])).toEqual({
        micro_ceiling_services: {
          reachedCents: 3_000_000,
          linkedCents: 0,
          exceeded: false,
          toleranceExceeded: false,
        },
        micro_ceiling_sales: {
          reachedCents: 13_000_000,
          linkedCents: 10_000_000,
          exceeded: false,
          toleranceExceeded: false,
        },
        vat_franchise_services: {
          reachedCents: 3_000_000,
          linkedCents: 0,
          exceeded: false,
          toleranceExceeded: false,
        },
        vat_franchise_sales: {
          reachedCents: 13_000_000,
          linkedCents: 10_000_000,
          exceeded: true,
          toleranceExceeded: true,
        },
      });
      const services = measure(7_000_000, [
        ['micro_bic_sales', 5_000_000],
        ['micro_bic_services', 2_000_000],
      ]);
      // 90,000 € of services is above 83,600 € even though 140,000 € in total stays below 203,100 €.
      expect(services.micro_ceiling_services).toMatchObject({ reachedCents: 9_000_000, exceeded: true });
      expect(services.micro_ceiling_sales).toMatchObject({ reachedCents: 14_000_000, exceeded: false });
    });
  });

  describe('one micro-entreprise with secondary activities', () => {
    const year = { start: '2026-01-01', end: '2026-12-31' };
    const rules = () => rulesOf('FR', 2026);
    /** 30,000 € of BNC (main activity, no category) and 20,000 € of BIC services. */
    const mixed: Receipt[] = [
      { date: '2026-03-10', cents: 3_000_000 },
      { date: '2026-04-10', cents: 2_000_000, category: 'micro_bic_services' },
    ];
    /**
     * Estimates by id
     *
     * @param profile {RuleProfile} - situation
     * @param receipts {Receipt[]} - revenue
     * @returns {Record<string, number>} - estimate id → cents
     */
    const estimates = (profile: RuleProfile, receipts: Receipt[]) =>
      Object.fromEntries(computeEstimates(rules(), profile, receipts).map((item) => [item.id, item.cents]));
    /**
     * Threshold ids and amounts reached
     *
     * @param profile {RuleProfile} - situation
     * @param receipts {Receipt[]} - revenue
     * @returns {Record<string, { reachedCents: number; exceeded: boolean }>} - thresholds by id
     */
    const thresholds = (profile: RuleProfile, receipts: Receipt[]) =>
      Object.fromEntries(
        measureThresholds(rules(), profile, receipts, year, '2026-11-18', null).map((item) => [
          item.id,
          { reachedCents: item.reachedCents, exceeded: item.exceeded },
        ]),
      );

    test('BNC alone: unchanged results, one activity in the breakdown', () => {
      const receipts = [{ date: '2026-03-10', cents: 3_000_000 }];
      expect(estimates({ ...liberal, activities: [] }, receipts)).toEqual(estimates(liberal, receipts));
      // Income tax at the scale: taxable 19 800 €, (19 800 − 11 600) × 11 % = 902 €, décote 897 − 408,16 €.
      expect(estimates(liberal, receipts)).toEqual({
        contributions_bnc: 768_000,
        cfp_liberal: 6_000,
        income_tax_bareme: 41_316,
      });
      const [only, ...rest] = activityBreakdown(rules(), liberal, receipts);
      expect(rest).toEqual([]);
      expect(only).toMatchObject({
        status: 'micro_bnc',
        main: true,
        revenueCents: 3_000_000,
        estimateCents: 774_000 + 41_316,
      });
      expect(only?.allowance).toMatchObject({
        id: 'allowance_bnc',
        allowanceCents: 1_020_000,
        taxableCents: 1_980_000,
      });
    });

    test('BNC + BIC services: one services ceiling on the total, each activity at its own rates', () => {
      const profile = { ...liberal, activities: ['micro_bic_services'] };
      expect(thresholds(profile, mixed)).toEqual({
        micro_ceiling_services: { reachedCents: 5_000_000, exceeded: false },
        vat_franchise_services: { reachedCents: 5_000_000, exceeded: true },
      });
      // 25.6 % + 0.2 % CFP on the BNC part, 21.2 % + 0.1 % CFP on the BIC part, instead of 25.8 % on everything.
      expect(estimates(profile, mixed)).toEqual({
        contributions_bnc: 768_000,
        contributions_bic_services: 424_000,
        cfp_liberal: 6_000,
        cfp_commercial: 2_000,
        // Taxable 19 800 + 10 000 €: 17 979 × 11 % + 221 × 30 % = 2 043,99 €, once for the person.
        income_tax_bareme: 204_399,
      });
      const [bnc, bic] = activityBreakdown(rules(), profile, mixed);
      expect(bnc).toMatchObject({
        status: 'micro_bnc',
        main: true,
        revenueCents: 3_000_000,
        estimateCents: 774_000,
      });
      expect(bic).toMatchObject({
        status: 'micro_bic_services',
        main: false,
        revenueCents: 2_000_000,
        estimateCents: 426_000,
        allowance: {
          id: 'allowance_bic_services',
          rateBp: 5000,
          allowanceCents: 1_000_000,
          taxableCents: 1_000_000,
        },
      });
    });

    test('versement libératoire: each activity pays its own rate, no allowance', () => {
      const profile = { ...liberal, options: ['versement_liberatoire'], activities: ['micro_bic_services'] };
      expect(estimates(profile, mixed)).toMatchObject({
        income_tax_bnc: 66_000,
        income_tax_bic_services: 34_000,
      });
      for (const item of activityBreakdown(rules(), profile, mixed)) expect(item.allowance).toBeNull();
    });

    test('BNC + sales: total under the sales ceiling, services part under the services ceiling', () => {
      const profile = { ...liberal, activities: ['micro_bic_sales'] };
      // A declared sales activity brings its ceilings before its first sale.
      expect(Object.keys(thresholds(profile, [{ date: '2026-03-10', cents: 1_000_000 }])).sort()).toEqual([
        'micro_ceiling_sales',
        'micro_ceiling_services',
        'vat_franchise_sales',
        'vat_franchise_services',
      ]);
      const reached = thresholds(profile, [
        { date: '2026-03-10', cents: 9_000_000 },
        { date: '2026-04-10', cents: 10_000_000, category: 'micro_bic_sales' },
      ]);
      expect(reached.micro_ceiling_sales).toEqual({ reachedCents: 19_000_000, exceeded: false });
      expect(reached.micro_ceiling_services).toEqual({ reachedCents: 9_000_000, exceeded: true });
      expect(
        estimates(profile, [{ date: '2026-04-10', cents: 10_000_000, category: 'micro_bic_sales' }]),
      ).toEqual({
        contributions_bnc: 0,
        contributions_sales: 1_230_000,
        cfp_liberal: 0,
        cfp_commercial: 10_000,
        // Taxable 29 000 €: 17 400 × 11 % = 1 914 €, décote 897 − 866,09 = 30,91 €.
        income_tax_bareme: 188_309,
      });
    });

    test('revenue of a link attached to the BIC services activity counts at the BIC rates', () => {
      const profile = { ...liberal, activities: ['micro_bic_services'] };
      const receipts: Receipt[] = [
        { date: '2026-03-10', cents: 3_000_000 },
        { date: '2026-04-01', cents: 2_000_000, category: 'micro_bic_services', linked: true },
      ];
      expect(estimates(profile, receipts).contributions_bic_services).toBe(424_000);
      expect(activityBreakdown(rules(), profile, receipts)[1]).toMatchObject({
        revenueCents: 2_000_000,
        linkedCents: 2_000_000,
      });
      expect(thresholds(profile, receipts).micro_ceiling_services?.reachedCents).toBe(5_000_000);
    });

    test('allowance: at least 305 € per activity, never above the revenue', () => {
      const profile = { ...liberal, activities: ['micro_bic_services'] };
      const [bnc, bic] = activityBreakdown(rules(), profile, [
        { date: '2026-03-10', cents: 40_000 },
        { date: '2026-03-10', cents: 10_000, category: 'micro_bic_services' },
      ]);
      expect(bnc?.allowance).toMatchObject({ allowanceCents: 30_500, taxableCents: 9_500 });
      expect(bic?.allowance).toMatchObject({ allowanceCents: 10_000, taxableCents: 0 });
    });
  });
});
