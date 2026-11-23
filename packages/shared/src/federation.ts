import { z } from 'zod';
import { currencySchema } from './common.ts';

/** Name of the activity shown to the linked instance, e.g. "SEKLYR" or "Freelance". */
const labelSchema = z.string().trim().min(1).max(60);

/** Per-company switch and the activity label shared with linked instances. */
export const federationSettingsSchema = z.object({ enabled: z.boolean(), label: labelSchema }).strict();

/** What one side of a link does: share its totals, receive the other's, call the other instance. */
export const federationLinkOptionsSchema = z
  .object({ share: z.boolean(), receive: z.boolean(), pulls: z.boolean() })
  .strict();

/** Base address of an Almanach instance, as typed by a person. */
export const instanceUrlSchema = z.url({ protocol: /^https?$/ }).max(500);

/** Issuing a pairing code: this instance's address as the other one reaches it. */
export const federationCreateSchema = z
  .object({ url: instanceUrlSchema, share: z.boolean(), receive: z.boolean() })
  .strict();

/** Entering a pairing code issued by the other instance. */
export const federationJoinSchema = z
  .object({
    code: z.string().trim().min(20).max(1000),
    url: instanceUrlSchema,
    share: z.boolean(),
    receive: z.boolean(),
  })
  .strict();

/**
 * The only business data that ever leaves an instance through a link: revenue collected per calendar
 * month and per fiscal category (status id), in the company currency, and the activity label.
 */
export const monthlyTotalsSchema = z
  .object({
    label: labelSchema,
    currency: currencySchema,
    months: z
      .array(
        z
          .object({
            month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
            category: z.string().regex(/^[a-z0-9_]{1,40}$/),
            cents: z.number().int().min(-100_000_000_000).max(100_000_000_000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

export type MonthlyTotals = z.infer<typeof monthlyTotalsSchema>;

/** A link as listed in the company settings. */
export interface FederationLink {
  id: string;
  state: 'pending' | 'active' | 'imported';
  peerUrl: string | null;
  peerLabel: string | null;
  fingerprint: string | null;
  peerFingerprint: string | null;
  share: boolean;
  receive: boolean;
  pulls: boolean;
  syncedAt: string | null;
  receivedAt: string | null;
  error: string | null;
  codeExpiresAt: string | null;
}
