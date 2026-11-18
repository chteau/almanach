import { describe, expect, test } from 'bun:test';
import type { YearRules } from '@almanach/shared';
import { diffRules } from './diff.ts';
import { PackRegistry } from './packs.ts';

const packs = await PackRegistry.load();
const fr2026 = packs.rules('FR', 2026)?.rules as YearRules;

describe('plain-language pack diff (S-244b)', () => {
  test('identical rules give no change', () => {
    expect(diffRules(new Map([[2026, fr2026]]), new Map([[2026, structuredClone(fr2026)]]))).toEqual([]);
  });

  test('a new rate from a date, a moved ceiling and a new year are reported', () => {
    const next = structuredClone(fr2026);
    const bnc = next.estimates.find((rule) => rule.id === 'contributions_bnc');
    if (bnc?.formula.kind !== 'flat') throw new Error('expected a flat estimate');
    bnc.formula.rates.push({ from: '2026-07-01', rateBp: 2600 });
    const ceiling = next.thresholds.find((rule) => rule.id === 'micro_ceiling_services');
    if (!ceiling) throw new Error('missing ceiling');
    ceiling.limitCents = 8_500_000;
    const later = { ...structuredClone(fr2026), year: 2027 };
    const changes = diffRules(
      new Map([[2026, fr2026]]),
      new Map([
        [2026, next],
        [2027, later],
      ]),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({
        type: 'rate',
        id: 'contributions_bnc',
        from: 2560,
        to: 2600,
        effective: '2026-07-01',
      }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ type: 'threshold', field: 'limit', from: 8_360_000, to: 8_500_000 }),
    );
    expect(changes).toContainEqual({ type: 'year_added', year: 2027 });
  });

  test('a rate dropped by the update is reported', () => {
    const old = structuredClone(fr2026);
    const bnc = old.estimates.find((rule) => rule.id === 'contributions_bnc');
    if (bnc?.formula.kind !== 'flat') throw new Error('expected a flat estimate');
    const base = bnc.formula.rates[0]?.rateBp;
    bnc.formula.rates.push({ from: '2026-07-01', rateBp: 2300 });
    expect(diffRules(new Map([[2026, old]]), new Map([[2026, fr2026]]))).toContainEqual(
      expect.objectContaining({ type: 'rate', from: 2300, to: base, effective: '2026-07-01' }),
    );
  });

  test('a changed source alone is grouped as wording', () => {
    const next = structuredClone(fr2026);
    next.holidaysSource = 'https://example.org/holidays';
    expect(diffRules(new Map([[2026, fr2026]]), new Map([[2026, next]]))).toEqual([
      { type: 'wording', year: 2026 },
    ]);
  });
});
