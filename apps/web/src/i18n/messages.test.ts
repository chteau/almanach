import { describe, expect, test } from 'bun:test';
import { de } from './locales/de.ts';
import { en } from './locales/en.ts';
import { fr } from './locales/fr.ts';
import { detectLocale, format, type Messages } from './messages.ts';

/**
 * Lists the placeholders of a message, sorted
 *
 * @param message {string} - message to inspect
 * @returns {string[]} - placeholder names
 */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}

describe('catalogues', () => {
  for (const [name, catalogue] of Object.entries({ fr, de }) as [string, Messages][]) {
    test(`${name} uses the same placeholders as English and no empty message`, () => {
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(catalogue[key].trim().length).toBeGreaterThan(0);
        expect(placeholders(catalogue[key])).toEqual(placeholders(en[key]));
      }
    });
  }
});

describe('helpers', () => {
  test('detectLocale picks the first supported base language', () => {
    expect(detectLocale(['es-ES', 'de-AT', 'fr'])).toBe('de');
    expect(detectLocale(['ja'])).toBe('en');
  });

  test('format fills known placeholders only', () => {
    expect(format('Step {current} of {total}', { current: 1, total: 6 })).toBe('Step 1 of 6');
    expect(format('Hello {name}', {})).toBe('Hello {name}');
  });
});
