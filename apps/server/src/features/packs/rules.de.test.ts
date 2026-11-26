import { describe, expect, test } from 'bun:test';
import {
  computeEstimates,
  computeReserve,
  type DeadlineNotice,
  expandDeadlines,
  type InvoicedItem,
  measureThresholds,
  packFeatures,
  prepareDeclaration,
  type RuleProfile,
} from '@almanach/shared';
import { PackRegistry } from './packs.ts';

// German pack, checked on gesetze-im-internet.de and bundesfinanzministerium.de on 2026-11-26. Expected amounts are
// worked out by hand in the comments.
const packs = await PackRegistry.load();
const found = packs.rules('DE', 2026);
if (!found || found.fallback) throw new Error('no DE 2026 rules');
const rules = found.rules;
const freelancer: RuleProfile = {
  status: 'freiberufler',
  options: [],
  declarationPeriod: 'quarterly',
  activityStart: '2020-01-01',
};
const fiscalYear = { start: '2026-01-01', end: '2026-12-31' };

/**
 * 2026 estimates in cents for a yearly profit received in one payment
 *
 * @param euros {number} - profit in whole euros
 * @returns {Record<string, number>} - estimate id → cents
 */
function yearly(euros: number): Record<string, number> {
  const results = computeEstimates(rules, freelancer, [{ date: '2026-06-30', cents: euros * 100 }]);
  return Object.fromEntries(results.map((result) => [result.id, result.cents]));
}

/**
 * Due dates by rule id of the 2026 obligations of a profile
 *
 * @param profile {Partial<RuleProfile>} - changes to the Freiberufler profile
 * @returns {Record<string, string[]>} - rule id → due dates in order
 */
function dues(profile: Partial<RuleProfile>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const item of expandDeadlines(rules, { ...freelancer, ...profile }, packs.holidays('DE')))
    out[item.ruleId] = [...(out[item.ruleId] ?? []), item.due];
  return out;
}

/**
 * Prepare block of a German deadline rule
 *
 * @param id {string} - deadline rule id
 * @returns {NonNullable<import('@almanach/shared').DeadlineRule['prepare']>} - the block
 */
function prepareOf(id: string) {
  const prepare = rules.deadlines.find((rule) => rule.id === id)?.prepare;
  if (!prepare) throw new Error(`no prepare block for ${id}`);
  return prepare;
}

describe('German pack', () => {
  test('is verified except expenses and vault kinds', () => {
    const pack = packs.get('DE');
    expect(pack).toMatchObject({ maturity: 'verified', currency: 'EUR', fiscalYearStart: '01-01' });
    expect(pack && packFeatures(pack)).toEqual({
      thresholds: 'verified',
      estimates: 'verified',
      deadlines: 'verified',
      activities: 'verified',
      reserve: 'verified',
      prepare: 'verified',
      expenses: 'experimental',
      vault_types: 'experimental',
      einvoicing: 'verified',
    });
  });

  test('every rule cites an official federal source and was checked on 2026-11-26', () => {
    const official = /^https:\/\/www\.(gesetze-im-internet\.de|bundesfinanzministerium\.de)\//;
    const prepares = rules.deadlines.flatMap((rule) => (rule.prepare ? [rule.prepare] : []));
    for (const item of [...rules.thresholds, ...rules.estimates, ...rules.deadlines, ...prepares]) {
      expect(item.source).toMatch(official);
      expect(item.verified_on).toBe('2026-11-26');
    }
    expect(rules.reserve?.verified_on).toBe('2026-11-26');
  });
});

describe('German income tax 2026 (§ 32a EStG, Grundtarif)', () => {
  test('nothing up to the 12,348 € Grundfreibetrag', () => {
    expect(yearly(12_348).income_tax).toBe(0);
    // y = 0.0001: (914.51 y + 1,400) y = 0.14 € → 0.
    expect(yearly(12_349).income_tax).toBe(0);
  });

  test('zone 2 ends at 17,799 € and zone 3 joins it', () => {
    // y = 0.5451: (914.51 × 0.5451 + 1,400) × 0.5451 = 1,034.85 € → 1,034 €.
    expect(yearly(17_799).income_tax).toBe(103_400);
    // z = 0.0001: (173.10 z + 2,397) z + 1,034.87 = 1,035.11 € → 1,035 €.
    expect(yearly(17_800).income_tax).toBe(103_500);
  });

  test('zone 3 up to 69,878 €, then 42 %', () => {
    // z = 5.2079: (173.10 × 5.2079 + 2,397) × 5.2079 + 1,034.87 = 18,213.0 € → 18,213 €.
    expect(yearly(69_878).income_tax).toBe(1_821_300);
    // 0.42 × 69,879 − 11,135.63 = 18,213.55 € → 18,213 €.
    expect(yearly(69_879).income_tax).toBe(1_821_300);
  });

  test('45 % from 277,826 €', () => {
    // 0.42 × 277,825 − 11,135.63 = 105,550.87 €; 0.45 × 277,826 − 19,470.38 = 105,551.32 €.
    expect(yearly(277_825).income_tax).toBe(10_555_000);
    expect(yearly(277_826).income_tax).toBe(10_555_100);
  });

  test('recorded expenses lower the profit taxed', () => {
    // 90,000 € revenue − 10,000 € expenses = 80,000 €: 0.42 × 80,000 − 11,135.63 = 22,464 €.
    const results = computeEstimates(rules, { ...freelancer, expensesCents: 1_000_000 }, [
      { date: '2026-05-01', cents: 9_000_000 },
    ]);
    expect(results.find((result) => result.id === 'income_tax')?.cents).toBe(2_246_400);
  });
});

describe('Solidaritätszuschlag 2026 (§§ 3, 4 SolZG)', () => {
  test('nothing while the income tax is at most the 20,350 € Freigrenze', () => {
    // 74,968 €: 0.42 × 74,968 − 11,135.63 = 20,350.93 € → 20,350 €, exactly the Freigrenze.
    expect(yearly(74_968)).toEqual({ income_tax: 2_035_000, solidarity_surcharge: 0 });
  });

  test('Milderungszone: at most 11.9 % of the excess over the Freigrenze, cent fractions dropped', () => {
    // 74,969 €: tax 20,351 €; min(5.5 % = 1,119.30 €, 11.9 % × 1 € = 0.119 €) = 0.11 €.
    expect(yearly(74_969)).toEqual({ income_tax: 2_035_100, solidarity_surcharge: 11 });
    // 80,000 €: tax 22,464 €; min(1,235.52 €, 11.9 % × 2,114 € = 251.566 €) = 251.56 €.
    expect(yearly(80_000)).toEqual({ income_tax: 2_246_400, solidarity_surcharge: 25_156 });
  });

  test('5.5 % of the income tax once the Milderungszone is passed', () => {
    // 150,000 €: tax 0.42 × 150,000 − 11,135.63 = 51,864 €; 5.5 % = 2,852.52 € < 11.9 % × 31,514 € = 3,750.17 €.
    expect(yearly(150_000)).toEqual({ income_tax: 5_186_400, solidarity_surcharge: 285_252 });
  });
});

describe('Kleinunternehmer limits (§ 19 UStG)', () => {
  const small: RuleProfile = { ...freelancer, options: ['kleinunternehmer'] };
  const measure = (profile: RuleProfile, cents: number) =>
    measureThresholds(rules, profile, [{ date: '2026-06-01', cents }], fiscalYear, '2026-11-26', null).find(
      (item) => item.id === 'kleinunternehmer_current_year',
    );

  test('100,000 € in the current year: the sale crossing it is taxable', () => {
    expect(measure(small, 10_000_000)).toMatchObject({ limitCents: 10_000_000, exceeded: false });
    expect(measure(small, 10_000_001)).toMatchObject({ exceeded: true });
  });

  test('25,000 € in the year the activity starts, without annualising (Abschnitt 19.1 Abs. 3 UStAE)', () => {
    const starting = { ...small, activityStart: '2026-09-01' };
    expect(measure(starting, 2_500_000)).toMatchObject({ limitCents: 2_500_000, exceeded: false });
    expect(measure(starting, 2_500_001)).toMatchObject({ exceeded: true });
  });

  test('25,000 € in the previous year, not watched without the option', () => {
    const [previous] = measureThresholds(
      rules,
      small,
      [{ date: '2025-12-31', cents: 2_500_001 }],
      fiscalYear,
      '2026-11-26',
      null,
    );
    expect(previous).toMatchObject({ id: 'kleinunternehmer_previous_year', exceeded: true });
    expect(measureThresholds(rules, freelancer, [], fiscalYear, '2026-11-26', null)).toEqual([]);
  });
});

describe('German deadlines 2026', () => {
  test('quarterly VAT return on the 10th after the quarter, moved off weekends (§ 18 UStG, § 108 AO)', () => {
    // 10 October 2026 is a Saturday, 10 January 2027 a Sunday.
    expect(dues({}).ust_voranmeldung_quarterly).toEqual([
      '2026-04-10',
      '2026-07-10',
      '2026-10-12',
      '2027-01-11',
    ]);
  });

  test('monthly VAT return on the 10th of the next month', () => {
    // 10 January and 10 May 2026 are Sundays, 10 October a Saturday.
    expect(dues({ declarationPeriod: 'monthly' }).ust_voranmeldung_monthly).toEqual([
      '2026-02-10',
      '2026-03-10',
      '2026-04-10',
      '2026-05-11',
      '2026-06-10',
      '2026-07-10',
      '2026-08-10',
      '2026-09-10',
      '2026-10-12',
      '2026-11-10',
      '2026-12-10',
      '2027-01-11',
    ]);
  });

  test('Dauerfristverlängerung: one month later, Sondervorauszahlung by 10 February for monthly filers', () => {
    const monthly = dues({ declarationPeriod: 'monthly', options: ['dauerfristverlaengerung'] });
    expect(monthly.ust_voranmeldung_monthly).toBeUndefined();
    expect(monthly.ust_voranmeldung_monthly_extended?.slice(0, 3)).toEqual([
      '2026-03-10',
      '2026-04-10',
      '2026-05-11',
    ]);
    expect(monthly.ust_voranmeldung_monthly_extended?.at(-1)).toBe('2027-02-10');
    expect(monthly.ust_sondervorauszahlung).toEqual(['2026-02-10']);
    const quarterly = dues({ options: ['dauerfristverlaengerung'] });
    expect(quarterly.ust_voranmeldung_quarterly_extended).toEqual([
      '2026-05-11',
      '2026-08-10',
      '2026-11-10',
      '2027-02-10',
    ]);
    expect(quarterly.ust_sondervorauszahlung).toBeUndefined();
  });

  test('Kleinunternehmer: no VAT return, an income tax return only', () => {
    const small = dues({
      declarationPeriod: 'monthly',
      options: ['kleinunternehmer', 'dauerfristverlaengerung'],
    });
    expect(Object.keys(small).sort()).toEqual(['annual_returns_kleinunternehmer', 'est_vorauszahlung']);
  });

  test('income tax prepayments (§ 37 EStG) and annual returns seven months after year end (§ 149 AO)', () => {
    const all = dues({});
    expect(all.est_vorauszahlung).toEqual(['2026-03-10', '2026-06-10', '2026-09-10', '2026-12-10']);
    // 31 July 2027 is a Saturday.
    expect(all.annual_returns).toEqual(['2027-08-02']);
  });

  test('trade tax prepayments on the 15th of February, May, August, November (§ 19 GewStG)', () => {
    // 15 February and 15 November 2026 are Sundays, 15 August a Saturday.
    expect(dues({ status: 'gewerbe' }).gewst_vorauszahlung).toEqual([
      '2026-02-16',
      '2026-05-15',
      '2026-08-17',
      '2026-11-16',
    ]);
  });

  test('no Landesfeiertag 2026 falls on a due date, so nationwide holidays are enough', () => {
    const regional = ['2026-01-06', '2026-03-08', '2026-06-04', '2026-08-15', '2026-09-20', '2026-10-31'];
    regional.push('2026-11-01', '2026-11-18');
    const profiles: Partial<RuleProfile>[] = [
      { status: 'gewerbe' },
      { declarationPeriod: 'monthly' },
      { declarationPeriod: 'monthly', options: ['dauerfristverlaengerung'] },
      { options: ['dauerfristverlaengerung'] },
    ];
    const all = profiles.flatMap((profile) => Object.values(dues(profile)).flat());
    expect(all.filter((date) => regional.includes(date))).toEqual([]);
  });
});

describe('German VAT return prepared (USt 1 A 2026)', () => {
  const base = {
    rules,
    receipts: [],
    expenses: null,
    fiscalStart: '2026-01-01',
    fiscalYear: 2026,
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    estimatesCents: 0,
    notice: null as DeadlineNotice | null,
    paidBeforeCents: 0,
  };
  const invoiced: InvoicedItem[] = [
    { date: '2026-06-20', netCents: 1_000_000, vatRateBp: 1900, vatCents: 190_000, vatMode: 'standard' },
    { date: '2026-08-10', netCents: 500_000, vatRateBp: 1900, vatCents: 95_000, vatMode: 'standard' },
    { date: '2026-09-10', netCents: 300_000, vatRateBp: 0, vatCents: 0, vatMode: 'reverse_charge' },
  ];
  // The June invoice paid in July, half of the August one in September.
  const collected: InvoicedItem[] = [
    { date: '2026-07-05', netCents: 1_000_000, vatRateBp: 1900, vatCents: 190_000, vatMode: 'standard' },
    { date: '2026-09-15', netCents: 250_000, vatRateBp: 1900, vatCents: 47_500, vatMode: 'standard' },
  ];

  test('lines carry the Kennzahlen of the form', () => {
    const labels = prepareOf('ust_voranmeldung_quarterly').lines.map((line) => line.label.de.split(' — ')[0]);
    expect(labels).toEqual(['Kz. 81', 'Kz. 86', 'Zeile 37', 'Kz. 21', 'Kz. 45', 'Kz. 66']);
    for (const id of ['ust_voranmeldung_monthly', 'ust_voranmeldung_monthly_extended'])
      expect(prepareOf(id)).toEqual(prepareOf('ust_voranmeldung_quarterly'));
  });

  test('Soll-Versteuerung: invoices issued in the quarter', () => {
    const result = prepareDeclaration({
      ...base,
      prepare: prepareOf('ust_voranmeldung_quarterly'),
      profile: freelancer,
      invoiced,
      collected,
    });
    expect(result.basis).toBe('invoiced');
    expect(result.lines.find((line) => line.id === 'base_19')?.cents).toBe(500_000);
    expect(result.amount?.cents).toBe(95_000);
  });

  test('Ist-Versteuerung: payments received in the quarter (§ 13 Abs. 1 Nr. 1 b, § 20 UStG)', () => {
    const result = prepareDeclaration({
      ...base,
      prepare: prepareOf('ust_voranmeldung_quarterly'),
      profile: { ...freelancer, options: ['ist_versteuerung'] },
      invoiced,
      collected,
      expenses: [{ date: '2026-08-01', netCents: 100_000, vatCents: 19_000 }],
    });
    expect(result.basis).toBe('collected');
    // 10,000 + 2,500 € taxable; VAT 1,900 + 475 = 2,375 €; reverse charge stays on the invoice date (§ 18b UStG);
    // Kz. 83 = 2,375 − 190 € input VAT = 2,185 €.
    expect(Object.fromEntries(result.lines.map((line) => [line.id, line.cents]))).toEqual({
      base_19: 1_250_000,
      base_7: 0,
      vat_collected: 237_500,
      reverse_charge: 300_000,
      export: 0,
      input_vat: 19_000,
    });
    expect(result.amount?.cents).toBe(218_500);
  });

  test('Sondervorauszahlung: the amount entered from the USt 1 H computation', () => {
    const input = {
      ...base,
      prepare: prepareOf('ust_sondervorauszahlung'),
      profile: freelancer,
      invoiced: [],
      periodStart: '2026-02-10',
      periodEnd: '2026-02-10',
    };
    expect(prepareDeclaration(input).amount?.cents).toBeNull();
    const notice = {
      perOccurrenceCents: 400_000,
      priorYearTaxCents: null,
      priorYearIncomeCents: null,
      method: null,
    };
    expect(prepareDeclaration({ ...input, notice }).amount?.cents).toBe(400_000);
  });
});

describe('German reserve', () => {
  test('income tax and Soli of the year, margin added, prepayments deducted per estimate', () => {
    const reserve = rules.reserve;
    if (!reserve) throw new Error('no reserve');
    expect(reserve.include).toEqual(['income_tax', 'solidarity_surcharge']);
    const result = computeReserve({
      rules,
      reserve,
      profile: freelancer,
      receipts: [{ date: '2026-03-01', cents: 15_000_000 }],
      paid: { income_tax: 1_000_000 },
      marginBp: reserve.marginBp,
      extraRateBp: 0,
      extraMonthlyCents: 0,
      monthsElapsed: 11,
    });
    // 51,864 € + 2,852.52 € = 54,716.52 €; 10 % margin 5,471.65 €; 10,000 € paid → 50,188.17 €.
    expect(result).toMatchObject({
      estimatedCents: 5_471_652,
      marginCents: 547_165,
      reserveCents: 5_018_817,
    });
  });

  test('settled by the income tax prepayments and either annual return', () => {
    expect(rules.reserve?.settles.map((item) => item.deadline)).toEqual([
      'est_vorauszahlung',
      'annual_returns',
      'annual_returns_kleinunternehmer',
    ]);
  });
});
