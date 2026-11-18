import { describe, expect, test } from 'bun:test';
import { parseDuration, timeQuantity } from './time.ts';

describe('time', () => {
  test('parses usual ways of typing a duration', () => {
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('1h15')).toBe(75);
    expect(parseDuration('1,5')).toBe(90);
    expect(parseDuration('45m')).toBe(45);
    expect(parseDuration('0.5', true)).toBe(210);
    expect(parseDuration('1j')).toBe(420);
    expect(parseDuration('25')).toBeNull();
    expect(parseDuration('1:75')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('0')).toBeNull();
  });

  test('turns minutes into invoice quantities', () => {
    expect(timeQuantity(90, 'hourly')).toEqual({ quantity: 1500, unit: 'hour' });
    expect(timeQuantity(630, 'daily')).toEqual({ quantity: 1500, unit: 'day' });
    expect(timeQuantity(20, 'hourly')).toEqual({ quantity: 333, unit: 'hour' });
  });
});
