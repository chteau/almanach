import { describe, expect, test } from 'bun:test';
import {
  defaultNumberFormat,
  formatForYear,
  formatNumber,
  numberFormatSchema,
  sequenceYear,
} from './billing.ts';

describe('document numbering (S-234)', () => {
  test('default formats keep the historical numbers', () => {
    expect(formatNumber(defaultNumberFormat('FR'), 'invoice', 2026, 1)).toBe('F-2026-0001');
    expect(formatNumber(defaultNumberFormat('DE'), 'credit', 2026, 12)).toBe('GS-2026-0012');
    expect(formatNumber(defaultNumberFormat('US'), 'quote', 2026, 3)).toBe('QT-2026-0003');
  });

  test('short year, other separator, no prefix', () => {
    const format = { ...defaultNumberFormat('FR'), separator: '/' as const, year: 'yy' as const, digits: 3 };
    expect(formatNumber(format, 'invoice', 2027, 42)).toBe('F/27/042');
    expect(
      formatNumber({ ...format, prefixes: { ...format.prefixes, invoice: '' } }, 'invoice', 2027, 5),
    ).toBe('27/005');
  });

  test('a counter without year never restarts', () => {
    const format = { ...defaultNumberFormat('FR'), year: 'none' as const };
    expect(sequenceYear(format, 2027)).toBe(0);
    expect(formatNumber(format, 'invoice', 2027, 7)).toBe('F-0007');
  });

  test('the format of a later year waits for that year', () => {
    const periods = [
      { ...defaultNumberFormat('FR'), fromYear: 0 },
      { ...defaultNumberFormat('FR'), separator: '/' as const, fromYear: 2027 },
    ];
    expect(formatForYear(periods, 2026)?.separator).toBe('-');
    expect(formatForYear(periods, 2027)?.separator).toBe('/');
  });

  test('prefixes refuse characters that could break file names', () => {
    expect(
      numberFormatSchema.safeParse({
        ...defaultNumberFormat('FR'),
        prefixes: { invoice: 'F/', credit: 'A', quote: 'D' },
      }).success,
    ).toBe(false);
  });

  test('prefixes must be filled and differ, or two families would share numbers', () => {
    const format = defaultNumberFormat('FR');
    const parse = (prefixes: { invoice: string; credit: string; quote: string }) =>
      numberFormatSchema.safeParse({ ...format, prefixes }).success;
    expect(parse({ invoice: 'F', credit: 'f', quote: 'D' })).toBe(false);
    expect(parse({ invoice: '', credit: 'A', quote: 'D' })).toBe(false);
    expect(parse({ invoice: 'FAC', credit: 'AV', quote: 'DEV' })).toBe(true);
  });
});
