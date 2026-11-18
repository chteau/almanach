import { describe, expect, test } from 'bun:test';
import { computeEstimates, expandDeadlines, measureThresholds, type RuleProfile } from '@almanach/shared';
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
        ].map((item) => item.appliesTo ?? {});
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
  test('£30,000 profit in England: income tax and Class 4', () => {
    expect(yearly('GB', {}, 3_000_000)).toEqual({ income_tax: 348_600, class4_nic: 104_580 });
  });

  test('personal allowance tapers above £100,000', () => {
    // Allowance 12,570 − 5,000 = 7,570; taxable 102,430 = 37,700 × 20 % + 64,730 × 40 %.
    expect(yearly('GB', {}, 11_000_000).income_tax).toBe(3_343_200);
  });

  test('Scottish taxpayers use the Scottish bands', () => {
    // 3,967 × 19 % + 12,989 × 20 % + 474 × 21 % on 30,000 − 12,570 = 17,430 taxable.
    expect(yearly('GB', { options: ['scotland'] }, 3_000_000).income_tax_scotland).toBe(
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
});
