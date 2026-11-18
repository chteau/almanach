import { z } from 'zod';
import { countrySchema, currencySchema, EU_COUNTRIES, isEuVatNumber, optionalText } from './common.ts';
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
    country: countrySchema,
    vatNumber: optionalText(20),
    currency: currencySchema,
    language: z.enum(LOCALES),
    paymentTermsDays: z.number().int().min(0).max(120),
    contacts: z.array(contactSchema).max(10),
    notes: optionalText(5000),
    allowDuplicate: z.boolean().optional(),
  })
  .strict()
  .superRefine((client, ctx) => {
    if (client.vatNumber && isEuCountry(client.country) && !isEuVatNumber(client.vatNumber)) {
      ctx.addIssue({ code: 'custom', path: ['vatNumber'], message: 'invalid_vat' });
    }
    if (client.contacts.filter((contact) => contact.billing).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['contacts'], message: 'one_billing_contact' });
    }
  });

export type ClientInput = z.input<typeof clientInputSchema>;

/** A client as returned by the API. */
export interface Client extends Omit<z.output<typeof clientInputSchema>, 'allowDuplicate'> {
  id: string;
  archived: boolean;
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
