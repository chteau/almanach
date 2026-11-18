import { z } from 'zod';
import { centsSchema, currencySchema, idSchema, isoDateSchema, optionalText } from './common.ts';
import { LOCALES } from './install.ts';

export const DOCUMENT_TYPES = ['quote', 'invoice', 'deposit', 'credit_note'] as const;
export const UNITS = ['hour', 'day', 'unit', 'month', 'flat'] as const;
export const VAT_MODES = ['franchise', 'standard', 'reverse_charge', 'export', 'none'] as const;
export const PAYMENT_METHODS = ['transfer', 'card', 'cash', 'check', 'platform', 'other'] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type Unit = (typeof UNITS)[number];
export type VatMode = (typeof VAT_MODES)[number];

/** Quantities are stored in thousandths so 1.5 days or 7.25 hours stay exact integers. */
export const QUANTITY_SCALE = 1000;
/** Percentages are stored in basis points: 20 % is 2000. */
export const PERCENT_SCALE = 10_000;

export const lineSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    quantity: z.number().int().min(1).max(1_000_000_000),
    unit: z.enum(UNITS),
    unitPriceCents: centsSchema,
    discountBp: z.number().int().min(0).max(PERCENT_SCALE),
  })
  .strict();

export type Line = z.output<typeof lineSchema>;

/**
 * What the browser may send for a draft: wording and quantities only. Numbers, totals, VAT mode,
 * mentions, seller and client snapshots are always computed by the server.
 */
export const documentDraftSchema = z
  .object({
    type: z.enum(DOCUMENT_TYPES),
    clientId: idSchema,
    missionId: idSchema.nullable(),
    issueDate: isoDateSchema,
    validUntil: isoDateSchema.nullable(),
    language: z.enum(LOCALES),
    currency: currencySchema,
    lines: z.array(lineSchema).max(200),
    discountBp: z.number().int().min(0).max(PERCENT_SCALE),
    note: optionalText(2000),
    depositIds: z.array(idSchema).max(20),
  })
  .strict();

export type DocumentDraft = z.input<typeof documentDraftSchema>;

export const paymentInputSchema = z
  .object({
    date: isoDateSchema,
    amountCents: z.number().int().min(1).max(100_000_000_000),
    receivedCents: centsSchema.nullable(),
    feesCents: centsSchema,
    method: z.enum(PAYMENT_METHODS),
    reference: optionalText(120),
  })
  .strict();

export type PaymentInput = z.input<typeof paymentInputSchema>;

export interface Totals {
  /** Sum of lines after line discounts, before the global discount. */
  linesCents: number;
  discountCents: number;
  netCents: number;
  vatRateBp: number;
  vatCents: number;
  /** Deposits already invoiced and deducted from a final invoice. */
  depositsCents: number;
  totalCents: number;
}

/**
 * Rounds a non-negative rational to the nearest integer, halves up, without floating point
 *
 * @param numerator {bigint} - numerator
 * @param denominator {bigint} - positive denominator
 * @returns {number} - rounded integer
 */
function roundDiv(numerator: bigint, denominator: bigint): number {
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

/**
 * Amount of one line: quantity × unit price, minus its discount, rounded to the cent
 *
 * @param line {Line} - invoice line
 * @returns {number} - line amount in cents
 */
export function lineAmount(line: Line): number {
  const gross = BigInt(line.quantity) * BigInt(line.unitPriceCents) * BigInt(PERCENT_SCALE - line.discountBp);
  return roundDiv(gross, BigInt(QUANTITY_SCALE * PERCENT_SCALE));
}

/**
 * Computes the totals of a document with integer arithmetic only
 *
 * @param lines {Line[]} - document lines
 * @param discountBp {number} - global discount in basis points
 * @param vatRateBp {number} - VAT rate in basis points, 0 when VAT does not apply
 * @param depositsCents {number} - deposits to deduct (final invoice after deposits)
 * @returns {Totals} - every amount shown on the document
 */
export function computeTotals(
  lines: Line[],
  discountBp: number,
  vatRateBp: number,
  depositsCents = 0,
): Totals {
  const linesCents = lines.reduce((sum, line) => sum + lineAmount(line), 0);
  const discountCents = roundDiv(BigInt(linesCents) * BigInt(discountBp), BigInt(PERCENT_SCALE));
  const netCents = linesCents - discountCents;
  const vatCents = roundDiv(BigInt(netCents) * BigInt(vatRateBp), BigInt(PERCENT_SCALE));
  return {
    linesCents,
    discountCents,
    netCents,
    vatRateBp,
    vatCents,
    depositsCents,
    totalCents: netCents + vatCents - depositsCents,
  };
}

/**
 * Adds days to a calendar date
 *
 * @param isoDate {string} - YYYY-MM-DD
 * @param days {number} - days to add, may be negative
 * @returns {string} - resulting YYYY-MM-DD
 */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Number of whole days from one date to another
 *
 * @param from {string} - YYYY-MM-DD
 * @param to {string} - YYYY-MM-DD
 * @returns {number} - days, negative when `to` is earlier
 */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';

/**
 * Derives the status shown for an invoice from stored facts (S-150, S-152, S-191)
 *
 * @param invoice {{ state: string; totalCents: number; paidCents: number; creditedCents: number; dueDate: string | null }} - stored facts
 * @param today {string} - today as YYYY-MM-DD
 * @returns {InvoiceStatus} - status
 */
export function invoiceStatus(
  invoice: {
    state: string;
    totalCents: number;
    paidCents: number;
    creditedCents: number;
    dueDate: string | null;
  },
  today: string,
): InvoiceStatus {
  if (invoice.state === 'draft') return 'draft';
  const due = invoice.totalCents - invoice.creditedCents;
  if (due <= 0 && invoice.creditedCents > 0 && invoice.paidCents === 0) return 'cancelled';
  if (invoice.paidCents >= due) return 'paid';
  if (invoice.dueDate && invoice.dueDate < today) return 'overdue';
  return invoice.paidCents > 0 ? 'partially_paid' : 'issued';
}

/**
 * Derives the status shown for a quote, expiring it automatically after its validity date (S-141)
 *
 * @param quote {{ state: string; validUntil: string | null }} - stored state and validity
 * @param today {string} - today as YYYY-MM-DD
 * @returns {QuoteStatus} - status
 */
export function quoteStatus(quote: { state: string; validUntil: string | null }, today: string): QuoteStatus {
  if (quote.state === 'sent' && quote.validUntil && quote.validUntil < today) return 'expired';
  return quote.state as QuoteStatus;
}

/** A document as returned by the API. */
export interface DocumentView {
  id: string;
  type: DocumentType;
  state: 'draft' | 'issued' | 'sent' | 'accepted' | 'declined';
  status: InvoiceStatus | QuoteStatus;
  number: string | null;
  clientId: string;
  clientName: string;
  missionId: string | null;
  relatedId: string | null;
  issueDate: string;
  dueDate: string | null;
  validUntil: string | null;
  language: (typeof LOCALES)[number];
  currency: string;
  lines: Line[];
  discountBp: number;
  note: string | null;
  vatMode: VatMode;
  mentions: string[];
  totals: Totals;
  paidCents: number;
  creditedCents: number;
  depositIds: string[];
  sentAt: string | null;
  createdAt: string;
}

/** A recorded payment as returned by the API. */
export interface PaymentView extends z.output<typeof paymentInputSchema> {
  id: string;
  documentId: string;
  documentNumber: string | null;
  clientName: string;
  currency: string;
}
