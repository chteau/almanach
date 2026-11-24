import { z } from 'zod';
import { centsSchema, currencySchema, idSchema, isoDateSchema } from './common.ts';
import { DOCUMENT_TYPES } from './documents.ts';

/** Name of the activity shown to the linked instance, e.g. "SEKLYR" or "Freelance". */
const labelSchema = z.string().trim().min(1).max(60);

/** Per-company switch and the activity label shared with linked instances. */
export const federationSettingsSchema = z.object({ enabled: z.boolean(), label: labelSchema }).strict();

/**
 * What one side of a link does: share its totals, receive the other's, call the other instance, and
 * share or receive the read-only detail (clients, documents, payments). Both detail switches are off by default.
 */
export const federationLinkOptionsSchema = z
  .object({
    share: z.boolean(),
    receive: z.boolean(),
    pulls: z.boolean(),
    shareDetail: z.boolean().default(false),
    receiveDetail: z.boolean().default(false),
  })
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

/** Most records of each kind a detail snapshot carries (docs/federation.md). */
export const DETAIL_LIMITS = { clients: 2000, documents: 3000, payments: 6000, lines: 50 } as const;

const text = (max: number) => z.string().max(max);
const signedCents = z.number().int().min(-100_000_000_000).max(100_000_000_000);
/**
 * Optional marks, only sent when set so older peers keep reading the snapshot: test data (Stripe test mode, test
 * source) and, for records relayed from an external source, the name of that source.
 */
const marks = { test: z.literal(true).optional(), origin: text(60).optional() };

/** A client of the linked activity, as shared read-only. */
export const linkedClientSchema = z
  .object({
    id: idSchema,
    kind: z.enum(['company', 'individual']),
    name: text(300),
    email: text(320).nullable(),
    country: text(3),
    siret: text(40).nullable(),
    vatNumber: text(40).nullable(),
    ...marks,
  })
  .strict();

/** A quote, invoice, deposit invoice or credit note of the linked activity, as shared read-only. */
export const linkedDocumentSchema = z
  .object({
    id: idSchema,
    type: z.enum(DOCUMENT_TYPES),
    status: z.string().regex(/^[a-z_]{1,30}$/),
    number: text(80).nullable(),
    clientId: idSchema,
    clientName: text(300),
    issueDate: isoDateSchema,
    dueDate: isoDateSchema.nullable(),
    validUntil: isoDateSchema.nullable(),
    currency: currencySchema,
    netCents: signedCents,
    vatCents: signedCents,
    totalCents: signedCents,
    paidCents: signedCents,
    dueCents: signedCents,
    /** Left out when the snapshot would otherwise be too large. */
    lines: z
      .array(
        z
          .object({
            description: text(500),
            quantity: z.number().int().min(0).max(1_000_000_000),
            unit: text(20),
            unitPriceCents: centsSchema,
          })
          .strict(),
      )
      .max(DETAIL_LIMITS.lines)
      .nullable(),
    ...marks,
  })
  .strict();

/** A payment of an invoice or a Stripe receipt of the linked activity, as shared read-only. */
export const linkedPaymentSchema = z
  .object({
    id: idSchema,
    source: z.enum(['payment', 'stripe']),
    date: isoDateSchema,
    amountCents: signedCents,
    currency: currencySchema,
    documentId: idSchema.nullable(),
    documentNumber: text(80).nullable(),
    clientName: text(300).nullable(),
    reference: text(200).nullable(),
    ...marks,
  })
  .strict();

/**
 * Read-only snapshot of the linked activity, sent only when one side shares its detail and the other receives
 * it: documents and payments of the current and previous calendar years, and the active clients.
 */
export const linkedDetailSchema = z
  .object({
    clients: z.array(linkedClientSchema).max(DETAIL_LIMITS.clients),
    documents: z.array(linkedDocumentSchema).max(DETAIL_LIMITS.documents),
    payments: z.array(linkedPaymentSchema).max(DETAIL_LIMITS.payments),
  })
  .strict();

export type LinkedClient = z.infer<typeof linkedClientSchema>;
export type LinkedDocument = z.infer<typeof linkedDocumentSchema>;
export type LinkedPayment = z.infer<typeof linkedPaymentSchema>;
export type LinkedDetail = z.infer<typeof linkedDetailSchema>;

/**
 * Records received from linked instances and external sources (docs/external-sources.md), each tagged with its
 * link or source, for the read-only lists. `test` on a source marks every record of it as test data.
 */
export interface LinkedRecords {
  sources: { id: string; label: string; url: string | null; kind: 'link' | 'external'; test: boolean }[];
  clients: (LinkedClient & { linkId: string })[];
  documents: (LinkedDocument & { linkId: string })[];
  payments: (LinkedPayment & { linkId: string })[];
}

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
  shareDetail: boolean;
  receiveDetail: boolean;
  syncedAt: string | null;
  receivedAt: string | null;
  error: string | null;
  codeExpiresAt: string | null;
  /** Status of the main activity the peer announces; null for a peer of an older version. */
  peerActivity: string | null;
  /** Follows the announced activity, or was chosen by hand. */
  activityAuto: boolean;
  /** Activity its revenue counts as: "main", a secondary activity id, or null (thresholds only). */
  activity: string | null;
}
