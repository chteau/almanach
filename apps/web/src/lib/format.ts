import { formatMoney } from '@almanach/shared';

export { formatMoney };

/**
 * Formats a YYYY-MM-DD date for display without shifting it across time zones
 *
 * @param isoDate {string} - calendar date
 * @param locale {string} - BCP 47 locale
 * @returns {string} - localized date, e.g. "18 nov. 2026"
 */
export function formatDate(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
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
