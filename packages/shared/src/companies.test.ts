import { expect, test } from 'bun:test';
import { type Company, microConflict } from './companies.ts';

const micro: Company = {
  id: 'a',
  name: 'Studio',
  country: 'FR',
  status: 'micro_bnc',
  activityStart: '2024-01-01',
  ceasedOn: null,
  activities: [],
};

test('a second active French micro-entreprise conflicts', () => {
  const candidate = { id: 'b', country: 'FR', status: 'micro_bic_sales', activityStart: '2026-03-01' };
  expect(microConflict([micro], candidate)?.id).toBe('a');
  expect(microConflict([{ ...micro, ceasedOn: '2026-02-28' }], candidate)).toBeNull();
  expect(microConflict([{ ...micro, ceasedOn: '2026-03-01' }], candidate)?.id).toBe('a');
});

test('other structures or countries never conflict', () => {
  expect(
    microConflict([micro], { id: 'b', country: 'FR', status: 'vat_liable', activityStart: null }),
  ).toBeNull();
  expect(
    microConflict([micro], { id: 'b', country: 'DE', status: 'micro_bnc', activityStart: null }),
  ).toBeNull();
  expect(microConflict([micro], { ...micro })).toBeNull();
});
