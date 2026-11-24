import { z } from 'zod';
import type { Localized } from './rules.ts';

/** Reserve settings a person may change: margin (null keeps the pack's), personal extra and tax household. */
export const reserveSettingsSchema = z
  .object({
    marginBp: z.number().int().min(0).max(5000).nullable(),
    extraRateBp: z.number().int().min(0).max(5000),
    extraMonthlyCents: z.number().int().min(0).max(1_000_000_000),
    extraNote: z.string().trim().max(200).nullable(),
    taxPartsQuarters: z.number().int().min(4).max(40),
    jointTaxation: z.boolean(),
  })
  .strict()
  .refine((value) => !value.jointTaxation || value.taxPartsQuarters >= 8, {
    path: ['taxPartsQuarters'],
    message: 'joint_needs_two_parts',
  });

export type ReserveSettings = z.infer<typeof reserveSettingsSchema>;

/** Reserve of a company as the API returns it; amounts in cents of `currency`. */
export interface ReserveView {
  currency: string;
  reserveCents: number;
  estimatedCents: number;
  marginCents: number;
  paidCents: number;
  revenueCents: number;
  byActivity: { status: string; main: boolean; revenueCents: number; estimateCents: number }[];
  components: {
    id: string;
    label: Localized;
    estimatedCents: number;
    paidCents: number;
    steps: { baseCents: number; rateBp: number; cents: number; adjustment?: 'qf_cap' | 'decote' }[];
    source: string;
    verifiedOn: string;
  }[];
  marginBp: number;
  packMarginBp: number;
  extra: { rateBp: number; monthlyCents: number; note: string | null; cents: number };
  household: { applies: boolean; partsQuarters: number; joint: boolean };
  warning: Localized;
  source: string;
  verifiedOn: string;
  asOf: string;
  fiscalYear: { start: string; end: string };
  maturity: string | null;
  unconverted: number;
}
