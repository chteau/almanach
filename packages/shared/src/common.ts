import { z } from 'zod';

/** ISO 4217 currency code, upper case. */
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'invalid_currency');

/** ISO 3166-1 alpha-2 country code, upper case. */
export const countrySchema = z.string().regex(/^[A-Z]{2}$/, 'invalid_country');

/** Calendar date as YYYY-MM-DD, checked against the real calendar. */
export const isoDateSchema = z.iso.date();

/** Money in integer minor units (cents); floats never hold amounts. */
export const centsSchema = z.number().int().min(0).max(100_000_000_000);

/** UUID path or body identifier. */
export const idSchema = z.uuid();

/**
 * Trims a string and turns an empty result into null, for optional free-text fields
 *
 * @param max {number} - maximum length after trimming
 * @returns {z.ZodType<string | null>} - schema accepting a string, empty string or null
 */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value ? value : null));
}

/**
 * Parses a decimal amount typed by a person ("1 234,50", "1234.5") into integer cents
 *
 * @param input {string} - amount as typed, with comma or dot decimals and optional spaces
 * @returns {number | null} - amount in cents, or null when the text is not a valid amount
 */
export function parseAmount(input: string): number | null {
  const compact = input.replace(/[\s  ']/g, '');
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(compact);
  if (!match?.[1]) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= 100_000_000_000 ? cents : null;
}

/**
 * Formats integer cents as a localized currency string
 *
 * @param cents {number} - amount in minor units
 * @param currency {string} - ISO 4217 code
 * @param locale {string} - BCP 47 locale used for formatting
 * @returns {string} - formatted amount, e.g. "1 234,50 €"
 */
export function formatMoney(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

/**
 * Validates an IBAN with the ISO 13616 mod-97 checksum
 *
 * @param value {string} - IBAN, spaces allowed
 * @returns {boolean} - true when structure and checksum are valid
 */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (letter) =>
    String(letter.charCodeAt(0) - 55),
  );
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

/**
 * Validates a number with the Luhn checksum (used by French SIREN/SIRET)
 *
 * @param value {string} - digits only
 * @returns {boolean} - true when the checksum holds
 */
export function isLuhnValid(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < value.length; index++) {
    let digit = Number(value[value.length - 1 - index]);
    if (index % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

/** EU member states, for intra-community VAT rules. */
export const EU_COUNTRIES = [
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
] as const;

/**
 * Checks the shape of an EU VAT number (country prefix, Greece uses EL)
 *
 * @param value {string} - VAT number, spaces allowed
 * @returns {boolean} - true when the format matches a member state's pattern
 */
export function isEuVatNumber(value: string): boolean {
  const vat = value.replace(/[\s.-]/g, '').toUpperCase();
  return /^(ATU\d{8}|BE[01]\d{9}|BG\d{9,10}|CY\d{8}[A-Z]|CZ\d{8,10}|DE\d{9}|DK\d{8}|EE\d{9}|EL\d{9}|ES[A-Z0-9]\d{7}[A-Z0-9]|FI\d{8}|FR[A-Z0-9]{2}\d{9}|HR\d{11}|HU\d{8}|IE\d{7}[A-Z]{1,2}|IE\d[A-Z+*]\d{5}[A-Z]|IT\d{11}|LT(\d{9}|\d{12})|LU\d{8}|LV\d{11}|MT\d{8}|NL\d{9}B\d{2}|PL\d{10}|PT\d{9}|RO\d{2,10}|SE\d{12}|SI\d{8}|SK\d{10})$/.test(
    vat,
  );
}

/** ISO 3166-1 alpha-2 codes offered in country pickers. */
export const COUNTRY_CODES =
  'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW'.split(
    ' ',
  );
