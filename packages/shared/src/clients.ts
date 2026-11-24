import { z } from 'zod';
import {
  countrySchema,
  currencySchema,
  EU_COUNTRIES,
  isEuVatNumber,
  isLuhnValid,
  optionalText,
} from './common.ts';
import { LOCALES } from './install.ts';

export const contactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.email().max(254).nullable(),
    phone: optionalText(40),
    role: optionalText(80),
    billing: z.boolean(),
  })
  .strict();

export const clientInputSchema = z
  .object({
    kind: z.enum(['company', 'individual']),
    name: z.string().trim().min(1).max(160),
    email: z.email().max(254).nullable(),
    phone: optionalText(40),
    address: optionalText(500),
    /** Structured address (street lines, postal code, city); when sent, `address` is composed from it. */
    addressLines: z.array(z.string().trim().min(1).max(100)).max(5).optional(),
    postalCode: optionalText(16),
    city: optionalText(100),
    country: countrySchema,
    vatNumber: optionalText(20),
    currency: currencySchema,
    language: z.enum(LOCALES),
    paymentTermsDays: z.number().int().min(0).max(120),
    contacts: z.array(contactSchema).max(10),
    notes: optionalText(5000),
    siret: optionalText(14),
    allowDuplicate: z.boolean().optional(),
  })
  .strict()
  .superRefine((client, ctx) => {
    if (client.vatNumber && isEuCountry(client.country) && !isEuVatNumber(client.vatNumber)) {
      ctx.addIssue({ code: 'custom', path: ['vatNumber'], message: 'invalid_vat' });
    }
    if (client.siret && !(client.siret.length === 14 && isLuhnValid(client.siret))) {
      ctx.addIssue({ code: 'custom', path: ['siret'], message: 'invalid_format' });
    }
    if (client.contacts.filter((contact) => contact.billing).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['contacts'], message: 'one_billing_contact' });
    }
  });

export type ClientInput = z.input<typeof clientInputSchema>;

/** A postal address split as EN 16931 expects it (BG-5, BG-8). */
export interface PostalAddress {
  lines: string[];
  postalCode: string | null;
  city: string | null;
}

/** Countries writing the city before the postal code on the last line. */
const CITY_FIRST = new Set(['GB', 'US', 'CA', 'AU', 'IE']);

/**
 * Printable address from its structured parts, in the country's usual order
 *
 * @param address {PostalAddress} - structured address
 * @param country {string} - ISO 3166-1 alpha-2 code
 * @returns {string | null} - address text, null when empty
 */
export function composeAddress(address: PostalAddress, country: string): string | null {
  const place = CITY_FIRST.has(country)
    ? [address.city, address.postalCode]
    : [address.postalCode, address.city];
  const last = place.filter(Boolean).join(' ');
  const text = [...address.lines, last].filter(Boolean).join('\n');
  return text || null;
}

/**
 * Prudently splits a free-text address: only a last line "<postal code> <city>" in a format the country is
 * known to use is recognised; anything else stays as street lines with no postal code nor city
 *
 * @param text {string | null} - free-text address, one part per line
 * @param country {string} - ISO 3166-1 alpha-2 code
 * @returns {PostalAddress} - structured address, possibly incomplete
 */
export function splitAddress(text: string | null, country: string): PostalAddress {
  const lines = (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const pattern = POSTAL_LINES[country];
  const match = pattern ? lines.at(-1)?.match(pattern) : undefined;
  if (!match?.groups || lines.length < 2) return { lines, postalCode: null, city: null };
  return {
    lines: lines.slice(0, -1),
    postalCode: match.groups.code ?? null,
    city: match.groups.city ?? null,
  };
}

/** Last address line "<postal code> <city>" per country, for the five-digit systems where it is unambiguous. */
const POSTAL_LINES: Record<string, RegExp> = {
  FR: /^(?<code>\d{5})\s+(?<city>\S.*)$/,
  DE: /^(?:D-)?(?<code>\d{5})\s+(?<city>\S.*)$/,
};

/**
 * Keeps the printed address and its structured parts in step: structured parts sent win and compose the text;
 * a text alone (CSV import, Stripe, API) is split prudently
 *
 * @param input {{ address: string | null; addressLines?: string[] | undefined; postalCode: string | null; city: string | null; country: string }} - client fields
 * @returns {{ address: string | null; addressLines: string[] | null; postalCode: string | null; city: string | null }} - consistent fields
 */
export function normalizeAddress(input: {
  address: string | null;
  addressLines?: string[] | undefined;
  postalCode: string | null;
  city: string | null;
  country: string;
}): {
  address: string | null;
  addressLines: string[] | null;
  postalCode: string | null;
  city: string | null;
} {
  const parts: PostalAddress = input.addressLines
    ? { lines: input.addressLines, postalCode: input.postalCode, city: input.city }
    : splitAddress(input.address, input.country);
  return {
    address: input.addressLines ? composeAddress(parts, input.country) : input.address,
    addressLines: parts.lines.length > 0 ? parts.lines : null,
    postalCode: parts.postalCode,
    city: parts.city,
  };
}

/** A client as returned by the API. */
export interface Client extends Omit<z.output<typeof clientInputSchema>, 'allowDuplicate' | 'addressLines'> {
  addressLines: string[] | null;
  id: string;
  archived: boolean;
  /** Stripe customer the client comes from, and when it was deleted there. */
  stripeId: string | null;
  stripeDeletedAt: string | null;
  /** false for a client imported from Stripe test mode: shown as test data. */
  livemode: boolean | null;
  createdAt: string;
}

/**
 * Tells whether a country is an EU member state
 *
 * @param country {string} - ISO 3166-1 alpha-2 code
 * @returns {boolean} - true for EU members
 */
export function isEuCountry(country: string): boolean {
  return (EU_COUNTRIES as readonly string[]).includes(country);
}

export type VatSituation = 'domestic' | 'eu_b2b' | 'eu_b2b_missing_vat' | 'eu_b2c' | 'non_eu';

/**
 * Classifies the VAT situation of a client relative to the seller's country (S-101 to S-104)
 *
 * @param sellerCountry {string} - seller's fiscal country
 * @param client {Pick<Client, 'country' | 'kind' | 'vatNumber'>} - client facts
 * @returns {VatSituation} - which family of invoice mentions applies
 */
export function vatSituation(
  sellerCountry: string,
  client: Pick<Client, 'country' | 'kind' | 'vatNumber'>,
): VatSituation {
  if (client.country === sellerCountry) return 'domestic';
  if (!isEuCountry(client.country) || !isEuCountry(sellerCountry)) return 'non_eu';
  if (client.kind === 'individual') return 'eu_b2c';
  return client.vatNumber ? 'eu_b2b' : 'eu_b2b_missing_vat';
}
