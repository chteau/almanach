import { z } from 'zod';
import { optionalText } from './common.ts';

/** Families that each have their own counter. */
export const NUMBER_FAMILIES = ['invoice', 'credit', 'quote'] as const;
export type NumberFamily = (typeof NUMBER_FAMILIES)[number];

export const PDF_LAYOUTS = ['classic', 'band', 'minimal'] as const;
export const PDF_FONTS = ['sans', 'serif'] as const;

/** Largest logo accepted, in bytes, once decoded (S-235). */
export const LOGO_MAX_BYTES = 256 * 1024;

const prefixSchema = z.string().regex(/^[A-Za-z0-9]{1,10}$/, 'invalid_prefix');

/** How document numbers are built: prefix, year and counter (S-234). */
export const numberFormatSchema = z
  .object({
    prefixes: z.object({ invoice: prefixSchema, credit: prefixSchema, quote: prefixSchema }).strict(),
    separator: z.enum(['-', '/', '_', '']),
    year: z.enum(['yyyy', 'yy', 'none']),
    digits: z.number().int().min(3).max(6),
  })
  .strict()
  // Each family has its own counter: shared prefixes would give two documents the same number.
  .refine(
    ({ prefixes }) => new Set(Object.values(prefixes).map((prefix) => prefix.toUpperCase())).size === 3,
    { message: 'duplicate_prefix', path: ['prefixes'] },
  );

export type NumberFormat = z.infer<typeof numberFormatSchema>;

/** A format and the first year it applies to; 0 means "from the start". */
export interface NumberFormatPeriod extends NumberFormat {
  fromYear: number;
}

/** Billing preferences: numbering, PDF look and defaults for new clients and documents (S-234 to S-236). */
export const billingSettingsSchema = z
  .object({
    numbering: numberFormatSchema,
    pdf: z
      .object({
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'invalid_color'),
        layout: z.enum(PDF_LAYOUTS),
        font: z.enum(PDF_FONTS),
      })
      .strict(),
    defaultTermsDays: z.number().int().min(0).max(120),
    defaultNote: optionalText(1000),
  })
  .strict();

export type BillingSettingsInput = z.input<typeof billingSettingsSchema>;

/** Logo upload: PNG or JPEG, base64 encoded. */
export const logoSchema = z
  .object({
    mime: z.enum(['image/png', 'image/jpeg']),
    data: z
      .string()
      .max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 4)
      .regex(/^[A-Za-z0-9+/]+=*$/, 'invalid_base64'),
  })
  .strict();

/** Numbering used when nothing was chosen; matches what countries expect by default. */
export function defaultNumberFormat(country: string): NumberFormat {
  const prefixes: Record<string, NumberFormat['prefixes']> = {
    FR: { invoice: 'F', credit: 'A', quote: 'D' },
    DE: { invoice: 'RE', credit: 'GS', quote: 'AN' },
  };
  return {
    prefixes: prefixes[country] ?? { invoice: 'INV', credit: 'CN', quote: 'QT' },
    separator: '-',
    year: 'yyyy',
    digits: 4,
  };
}

/**
 * Format in force for a year, from a list of periods sorted or not
 *
 * @param periods {NumberFormatPeriod[]} - formats with their first year
 * @param year {number} - year of the document
 * @returns {NumberFormat | undefined} - the format, or undefined when none applies yet
 */
export function formatForYear(periods: NumberFormatPeriod[], year: number): NumberFormat | undefined {
  return [...periods].sort((a, b) => b.fromYear - a.fromYear).find((period) => period.fromYear <= year);
}

/**
 * Counter key for a year: formats without the year never restart their counter (S-323)
 *
 * @param format {NumberFormat} - numbering format
 * @param year {number} - year of the document
 * @returns {number} - key stored with the counter
 */
export function sequenceYear(format: NumberFormat, year: number): number {
  return format.year === 'none' ? 0 : year;
}

/**
 * Builds a document number
 *
 * @param format {NumberFormat} - numbering format
 * @param family {NumberFamily} - document family
 * @param year {number} - year of the document
 * @param counter {number} - position in the sequence, from 1
 * @returns {string} - e.g. "F-2026-0001"
 */
export function formatNumber(
  format: NumberFormat,
  family: NumberFamily,
  year: number,
  counter: number,
): string {
  const parts = [
    format.prefixes[family],
    format.year === 'yyyy' ? String(year) : format.year === 'yy' ? String(year).slice(2) : '',
    String(counter).padStart(format.digits, '0'),
  ].filter(Boolean);
  return parts.join(format.separator);
}
