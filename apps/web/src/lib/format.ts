import { formatMoney, regionalLocale } from '@almanach/shared';

export { formatMoney };

const REGION_KEY = 'almanach.region';

/** Country of the pack in use, remembered so dates keep their regional format from the first screen on. */
let region: string | null = readRegion();

/**
 * Reads the remembered pack country, if any
 *
 * @returns {string | null} - ISO code, or null when absent or storage is blocked
 */
function readRegion(): string | null {
  try {
    return globalThis.localStorage?.getItem(REGION_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Sets the country of the pack in use, so English dates follow it (en-GB for the UK, en-US for the US)
 *
 * @param country {string | null} - ISO code of the active company's pack
 * @returns {void} - nothing
 */
export function setDateRegion(country: string | null): void {
  if (country === region) return;
  region = country;
  try {
    if (country) globalThis.localStorage?.setItem(REGION_KEY, country);
    else globalThis.localStorage?.removeItem(REGION_KEY);
  } catch {
    // Storage blocked: the region still applies until the page is reloaded.
  }
}

/**
 * Formats a YYYY-MM-DD date for display without shifting it across time zones; English follows the pack country
 *
 * @param isoDate {string} - calendar date
 * @param locale {string} - interface language or BCP 47 locale
 * @returns {string} - localized date, e.g. "18 nov. 2026", "24 Nov 2026" (GB), "Nov 24, 2026" (US)
 */
export function formatDate(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(regionalLocale(locale, region), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/**
 * Returns today's calendar date in the browser's time zone
 *
 * @returns {string} - YYYY-MM-DD
 */
export function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * Formats cents for an editable amount field, with the decimal separator people type in that language
 *
 * @param cents {number | null} - amount in minor units, or null for an empty field
 * @param locale {string} - UI language; English keeps a dot, French and German use a comma
 * @returns {string} - e.g. "550,00", or "" when null
 */
export function centsToInput(cents: number | null, locale = 'en'): string {
  if (cents === null) return '';
  const text = (cents / 100).toFixed(2);
  return locale === 'en' ? text : text.replace('.', ',');
}

/**
 * Localized country name from its ISO code
 *
 * @param code {string} - ISO 3166-1 alpha-2 code
 * @param locale {string} - BCP 47 locale
 * @returns {string} - country name, or the code when unknown
 */
export function countryName(code: string, locale: string): string {
  return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
}
