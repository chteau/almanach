import { describe, expect, test } from 'bun:test';
import type { Totals } from '@almanach/shared';
import { netOfVat } from './planning.service.ts';

/**
 * This function builds document totals for a net amount and a VAT amount
 *
 * @param netCents {number} - amount before VAT
 * @param vatCents {number} - VAT charged
 * @param depositsCents {number} - deposits deducted from the total
 * @returns {Totals} - the document totals
 */
function totals(netCents: number, vatCents: number, depositsCents = 0): Totals {
  return {
    linesCents: netCents,
    discountCents: 0,
    netCents,
    vatRateBp: netCents === 0 ? 0 : Math.round((vatCents * 10000) / netCents),
    vatCents,
    depositsCents,
    totalCents: netCents + vatCents - depositsCents,
  };
}

describe('revenue is counted before VAT', () => {
  test('a payment without VAT or without document is kept as is', () => {
    expect(netOfVat(100000, totals(100000, 0))).toBe(100000);
    expect(netOfVat(100000, null)).toBe(100000);
  });

  test('a full payment of an invoice with 20 % VAT counts its amount before VAT', () => {
    expect(netOfVat(120000, totals(100000, 20000))).toBe(100000);
  });

  test('a part payment counts in proportion', () => {
    expect(netOfVat(60000, totals(100000, 20000))).toBe(50000);
  });

  test('a final invoice after a deposit keeps the VAT proportion', () => {
    const final = totals(100000, 20000, 36000);
    expect(netOfVat(final.totalCents, final)).toBe(70000);
  });

  test('a credit note refund is negative before VAT too', () => {
    expect(netOfVat(-24000, totals(-20000, -4000))).toBe(-20000);
  });
});
