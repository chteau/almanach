import { describe, expect, test } from 'bun:test';
import { PackRegistry } from '../packs/packs.ts';
import { mentionsFor, vatModeFor, vatRateFor } from './vat.ts';

const packs = await PackRegistry.load();
const fr = packs.get('FR');
const de = packs.get('DE');
const uk = packs.get('GB');

describe('VAT treatment (S-164)', () => {
  test('French micro-entrepreneur in franchise never charges VAT', () => {
    expect(vatModeFor(fr, [], 'domestic', 'company')).toBe('franchise');
    expect(vatModeFor(fr, [], 'eu_b2b', 'company')).toBe('franchise');
    expect(mentionsFor(fr, 'franchise', 'company', 'fr')[0]).toBe('TVA non applicable, art. 293 B du CGI');
  });

  test('VAT-liable French seller: national rate, reverse charge, export', () => {
    expect(vatModeFor(fr, ['vat_liable'], 'domestic', 'company')).toBe('standard');
    expect(vatRateFor(fr, 'standard')).toBe(2000);
    expect(vatModeFor(fr, ['vat_liable'], 'eu_b2b', 'company')).toBe('reverse_charge');
    expect(vatModeFor(fr, ['vat_liable'], 'eu_b2b_missing_vat', 'company')).toBe('standard');
    expect(vatModeFor(fr, ['vat_liable'], 'non_eu', 'company')).toBe('export');
    expect(vatModeFor(fr, ['vat_liable'], 'non_eu', 'individual')).toBe('standard');
  });

  test('late-payment terms only for business clients', () => {
    expect(mentionsFor(fr, 'standard', 'company', 'en')).toHaveLength(1);
    expect(mentionsFor(fr, 'standard', 'individual', 'en')).toHaveLength(0);
  });

  test('German Kleinunternehmer and UK non-registered sellers', () => {
    expect(vatModeFor(de, [], 'domestic', 'company')).toBe('standard');
    expect(vatRateFor(de, 'standard')).toBe(1900);
    expect(vatModeFor(de, ['kleinunternehmer'], 'domestic', 'company')).toBe('franchise');
    expect(mentionsFor(de, 'franchise', 'individual', 'de')).toEqual([
      'Steuerbefreiung für Kleinunternehmer gemäß § 19 UStG – keine Umsatzsteuer ausgewiesen.',
    ]);
    expect(vatModeFor(uk, [], 'domestic', 'company')).toBe('none');
    expect(vatModeFor(uk, ['vat_registered'], 'non_eu', 'company')).toBe('export');
    expect(vatModeFor(undefined, [], 'domestic', 'company')).toBe('none');
  });
});
