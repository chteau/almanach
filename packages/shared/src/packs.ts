import { z } from 'zod';
import { currencySchema } from './common.ts';

const localized = z.object({ fr: z.string().min(1), en: z.string().min(1), de: z.string().min(1) }).strict();

const choice = z
  .object({ id: z.string().regex(/^[a-z0-9_]{1,40}$/), label: localized, hint: localized.optional() })
  .strict();

export const PACK_MATURITIES = ['experimental', 'community', 'verified'] as const;
export const DECLARATION_PERIODS = ['monthly', 'quarterly', 'yearly'] as const;
export const BANK_FORMATS = ['iban', 'uk', 'us'] as const;
/** Functions a pack may support, each with its own maturity; a function the pack does not list is unavailable. */
export const PACK_FEATURES = [
  'thresholds',
  'estimates',
  'deadlines',
  'activities',
  'reserve',
  'prepare',
  'vault_types',
  'einvoicing',
] as const;

const sourced = { source: z.url({ protocol: /^https$/ }), verified_on: z.iso.date() };

/** E-invoice formats Almanach can produce; `ubl` is modelled for later (XRechnung) but not offered yet. */
export const EINVOICE_FORMATS = ['facturx', 'ubl'] as const;
export type EinvoiceFormatId = (typeof EINVOICE_FORMATS)[number];

/** E-invoicing rules of a country (§ 6.3 of the admin-assistant spec); nothing is ever transmitted. */
const einvoiceRules = z
  .object({
    formats: z
      .array(
        z
          .object({
            id: z.enum(EINVOICE_FORMATS),
            profile: z.enum(['EN16931']),
            syntax: z.enum(['CII', 'UBL']).optional(),
          })
          .strict(),
      )
      .min(1),
    default: z.enum(EINVOICE_FORMATS),
    /** When receiving and issuing become mandatory; shown as information, never blocking. */
    mandates: z
      .array(
        z
          .object({
            scope: z.enum(['receive', 'issue']),
            from: z.iso.date(),
            appliesTo: z
              .object({ statuses: z.array(z.string()) })
              .strict()
              .optional(),
            ...sourced,
          })
          .strict(),
      )
      .default([]),
    /** Extra data the country requires on an e-invoice, beyond EN 16931. */
    requiredFields: z.array(z.enum(['buyer_legal_id'])).default([]),
    /** Seller and domestic buyer legal registration (BT-30, BT-47): identifier, ISO 6523 scheme, digits kept. */
    legalId: z
      .object({
        identifier: z.string(),
        scheme: z.string().regex(/^\d{4}$/),
        length: z.number().int().min(1),
      })
      .strict()
      .optional(),
    /** Seller identifier written as tax registration (BT-32, scheme FC), e.g. the German Steuernummer. */
    taxId: z.string().optional(),
    /** CEF VATEX exemption reason codes (BT-121) per VAT treatment; the text (BT-120) is the printed mention. */
    exemptionCodes: z
      .object({
        franchise: z
          .string()
          .regex(/^VATEX-/)
          .optional(),
        reverse_charge: z
          .string()
          .regex(/^VATEX-/)
          .optional(),
        export: z
          .string()
          .regex(/^VATEX-/)
          .optional(),
      })
      .strict()
      .default({}),
    note: localized.optional(),
  })
  .strict();

const invoiceRules = z
  .object({
    vatRateBp: z.number().int().min(0).max(10_000),
    defaultMode: z.enum(['franchise', 'standard', 'none']),
    toggle: z
      .object({ option: z.string(), mode: z.enum(['franchise', 'standard', 'none']) })
      .strict()
      .optional(),
    requiredIdentifiers: z.array(z.string()).default([]),
    requireClientAddress: z.boolean(),
    /** Mention appended to the seller name when absent, e.g. "EI" for French sole traders. */
    sellerNameMention: z.string().min(1).max(40).optional(),
    mentions: z
      .object({
        franchise: localized.optional(),
        reverse_charge: localized.optional(),
        export: localized.optional(),
        b2b_late: localized.optional(),
      })
      .strict(),
    einvoice: einvoiceRules.optional(),
  })
  .strict();

/** Country pack metadata, loaded from packs/<country>/pack.yaml and validated before use. */
export const packMetaSchema = z
  .object({
    country: z.string().regex(/^[A-Z]{2}$/),
    maturity: z.enum(PACK_MATURITIES),
    /** Maturity per function; the country keeps its overall `maturity`. Absent in packs made before it existed. */
    features: z.partialRecord(z.enum(PACK_FEATURES), z.enum(PACK_MATURITIES)).optional(),
    /** Oldest Almanach version able to read this pack ("x.y.z"); older instances refuse it and keep theirs. */
    minAppVersion: z
      .string()
      .regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/)
      .optional(),
    name: localized,
    currency: currencySchema,
    fiscalYearStart: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
    bank: z.enum(BANK_FORMATS),
    statuses: z.array(choice).min(1),
    declarationPeriods: z.array(z.enum(DECLARATION_PERIODS)).min(1),
    options: z.array(choice).default([]),
    identifiers: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9_]{1,40}$/),
            label: localized,
            pattern: z.string().min(1),
            example: z.string().min(1),
            required: z.boolean(),
            checksum: z.enum(['luhn']).optional(),
          })
          .strict(),
      )
      .default([]),
    invoice: invoiceRules,
  })
  .strict();

export type PackMeta = z.infer<typeof packMetaSchema>;
export type EinvoiceRules = z.infer<typeof einvoiceRules>;
export type PackMaturity = (typeof PACK_MATURITIES)[number];
export type PackFeature = (typeof PACK_FEATURES)[number];
export type PackFeatures = Partial<Record<PackFeature, PackMaturity>>;

/**
 * Maturity of each function of a pack. A pack written before per-function maturity existed keeps what it already
 * offered (thresholds, estimates, deadlines, activities) at its overall maturity.
 *
 * @param pack {Pick<PackMeta, 'maturity' | 'features'>} - pack metadata
 * @returns {PackFeatures} - available functions and their maturity
 */
export function packFeatures(pack: Pick<PackMeta, 'maturity' | 'features'>): PackFeatures {
  if (pack.features) return pack.features;
  const { maturity } = pack;
  return { thresholds: maturity, estimates: maturity, deadlines: maturity, activities: maturity };
}

export type DeclarationPeriod = (typeof DECLARATION_PERIODS)[number];
