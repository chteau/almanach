import { describe, expect, test } from 'bun:test';
import { addDays, computeTotals, daysBetween, invoiceStatus, lineAmount, quoteStatus } from './documents.ts';

describe('document totals', () => {
  test('line amounts use exact quantities and round half up', () => {
    expect(
      lineAmount({ description: 'x', quantity: 1500, unit: 'day', unitPriceCents: 55_000, discountBp: 0 }),
    ).toBe(82_500);
    expect(
      lineAmount({ description: 'x', quantity: 333, unit: 'hour', unitPriceCents: 1_000, discountBp: 0 }),
    ).toBe(333);
    expect(
      lineAmount({ description: 'x', quantity: 1000, unit: 'unit', unitPriceCents: 1_005, discountBp: 5000 }),
    ).toBe(503);
  });

  test('global discount, VAT and deposits', () => {
    const totals = computeTotals(
      [
        { description: 'Dev', quantity: 10_000, unit: 'day', unitPriceCents: 50_000, discountBp: 0 },
        { description: 'Hosting', quantity: 1000, unit: 'month', unitPriceCents: 2_999, discountBp: 0 },
      ],
      1000,
      2000,
      100_000,
    );
    expect(totals).toEqual({
      linesCents: 502_999,
      discountCents: 50_300,
      netCents: 452_699,
      vatRateBp: 2000,
      vatCents: 90_540,
      depositsCents: 100_000,
      totalCents: 443_239,
    });
  });
});

describe('dates and statuses', () => {
  test('date helpers cross month and leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14');
    expect(daysBetween('2026-11-01', '2026-11-18')).toBe(17);
  });

  test('invoice statuses', () => {
    const base = { state: 'issued', totalCents: 1000, paidCents: 0, creditedCents: 0, dueDate: '2026-11-30' };
    expect(invoiceStatus({ ...base, state: 'draft' }, '2026-11-18')).toBe('draft');
    expect(invoiceStatus(base, '2026-11-18')).toBe('issued');
    expect(invoiceStatus(base, '2026-12-01')).toBe('overdue');
    expect(invoiceStatus({ ...base, paidCents: 400 }, '2026-11-18')).toBe('partially_paid');
    expect(invoiceStatus({ ...base, paidCents: 1200 }, '2026-12-01')).toBe('paid');
    expect(invoiceStatus({ ...base, creditedCents: 1000 }, '2026-12-01')).toBe('cancelled');
    expect(invoiceStatus({ ...base, creditedCents: 300, paidCents: 700 }, '2026-12-01')).toBe('paid');
  });

  test('quotes expire after their validity date', () => {
    expect(quoteStatus({ state: 'sent', validUntil: '2026-11-17' }, '2026-11-18')).toBe('expired');
    expect(quoteStatus({ state: 'accepted', validUntil: '2026-11-17' }, '2026-11-18')).toBe('accepted');
  });
});
