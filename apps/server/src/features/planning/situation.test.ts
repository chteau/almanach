import { describe, expect, test } from 'bun:test';
import type { profiles } from '../../db/schema.ts';
import { situationPeriods } from './planning.service.ts';

const base = {
  userId: '00000000-0000-0000-0000-000000000001',
  country: 'FR',
  status: 'micro_bic_services',
  activityStart: '2025-03-01',
  declarationPeriod: 'quarterly',
  options: [],
  identifiers: {},
  currency: 'EUR',
  ceasedOn: null,
} as unknown as typeof profiles.$inferSelect;

describe('situation periods (S-231 to S-233)', () => {
  test('without changes, one open period from the start of the activity', () => {
    expect(situationPeriods(base, [])).toEqual([{ from: '2025-03-01', to: null, profile: base }]);
  });

  test('a change splits the activity; the old status applies until the day before', () => {
    const before = {
      country: 'FR',
      status: 'micro_bnc',
      declarationPeriod: 'monthly' as const,
      options: [],
      identifiers: {},
      currency: 'EUR',
    };
    const after = { ...before, status: 'micro_bic_services', declarationPeriod: 'quarterly' as const };
    const periods = situationPeriods({ ...base, ceasedOn: '2027-03-31' }, [
      { effectiveOn: '2026-07-01', before, after },
    ]);
    expect(
      periods.map(({ from, to, profile }) => [from, to, profile.status, profile.declarationPeriod]),
    ).toEqual([
      ['2025-03-01', '2026-06-30', 'micro_bnc', 'monthly'],
      ['2026-07-01', '2027-03-31', 'micro_bic_services', 'quarterly'],
    ]);
  });
});
