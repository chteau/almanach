import { describe, expect, test } from 'bun:test';
import { parsePercent, parseQuantity, toCsv } from './labels.ts';

describe('document input helpers', () => {
  test('quantities and percentages', () => {
    expect(parseQuantity('1,5')).toBe(1500);
    expect(parseQuantity('7.25')).toBe(7250);
    expect(parseQuantity('0')).toBeNull();
    expect(parsePercent('')).toBe(0);
    expect(parsePercent('12,5')).toBe(1250);
    expect(parsePercent('101')).toBeNull();
  });

  test('CSV neutralises formulas and quotes separators', () => {
    expect(toCsv([['=HYPERLINK("x")', 'a,b', 12]])).toBe('"\'=HYPERLINK(""x"")","a,b",12');
  });
});
