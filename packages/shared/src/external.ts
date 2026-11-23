import { z } from 'zod';
import { centsSchema, countrySchema, currencySchema, isoDateSchema } from './common.ts';

/** Version of the document feed format an external source publishes (docs/external-sources.md). */
export const FEED_VERSION = 'almanach-feed/1';

/** Bounds of a feed: documents, lines per document and size of the answer. */
export const FEED_LIMITS = { documents: 5000, lines: 50, bytes: 5 * 1024 * 1024 } as const;

/** Statuses a feed may give; `refused` reads as a declined quote. */
export const FEED_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'refused',
  'expired',
  'cancelled',
  'issued',
  'partially_paid',
  'paid',
  'overdue',
] as const;

const signedCents = z.number().int().min(-100_000_000_000).max(100_000_000_000);
const remoteId = z.string().min(1).max(100);
const optional = (max: number) => z.string().trim().min(1).max(max).optional();

/** One quote, invoice or credit note of a feed; HT + VAT must equal the total. */
export const feedDocumentSchema = z
  .object({
    id: remoteId,
    type: z.enum(['quote', 'invoice', 'credit_note']),
    number: z.string().trim().min(1).max(80),
    status: z.enum(FEED_STATUSES),
    issuedAt: isoDateSchema,
    validUntil: isoDateSchema.optional(),
    currency: currencySchema,
    totalExclTaxCents: signedCents,
    taxCents: signedCents,
    totalInclTaxCents: signedCents,
    client: z
      .object({
        id: remoteId,
        name: z.string().trim().min(1).max(300),
        email: optional(320),
        country: countrySchema.optional(),
        siret: optional(40),
        vat: optional(40),
      })
      .strict(),
    lines: z
      .array(
        z
          .object({
            label: z.string().max(500),
            quantity: z.number().min(0).max(1_000_000),
            unitPriceCents: centsSchema,
            totalCents: signedCents,
          })
          .strict(),
      )
      .max(FEED_LIMITS.lines)
      .optional(),
  })
  .strict()
  .refine((doc) => doc.totalExclTaxCents + doc.taxCents === doc.totalInclTaxCents, {
    message: 'totals_mismatch',
  });

/** A whole `almanach-feed/1` answer. */
export const feedSchema = z
  .object({
    version: z.literal(FEED_VERSION),
    generatedAt: z.iso.datetime({ offset: true }),
    documents: z.array(feedDocumentSchema).max(FEED_LIMITS.documents),
  })
  .strict();

export type Feed = z.infer<typeof feedSchema>;

/** Creating or editing an external source; the token is required on creation and kept when left out later. */
export const externalSourceInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    url: z.url({ protocol: /^https$/ }).max(500),
    token: z.string().trim().min(16).max(500).optional(),
    test: z.boolean(),
  })
  .strict();

/** An external source as listed in the company settings; the token is never sent back. */
export interface ExternalSource {
  id: string;
  name: string;
  url: string;
  test: boolean;
  syncedAt: string | null;
  error: string | null;
  documents: number;
}
