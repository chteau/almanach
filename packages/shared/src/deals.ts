import { z } from 'zod';
import { activityRefSchema } from './activities.ts';
import { currencySchema, isoDateSchema } from './common.ts';

/** Stages of the pipeline, in order; won and lost close the deal. */
export const DEAL_STAGES = ['lead', 'quote_sent', 'follow_up', 'won', 'lost'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

const text = (max: number) => z.string().trim().max(max).nullable().default(null);

/** A deal as entered; a deal without client names its prospect. */
export const dealInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    stage: z.enum(DEAL_STAGES).default('lead'),
    activityId: activityRefSchema,
    clientId: z.uuid().nullable().default(null),
    prospectName: text(160),
    prospectContact: text(300),
    amountCents: z.number().int().min(0).max(1e13).nullable().default(null),
    currency: currencySchema.nullable().default(null),
    quoteId: z.uuid().nullable().default(null),
    missionId: z.uuid().nullable().default(null),
    nextActionOn: isoDateSchema.nullable().default(null),
    nextAction: text(300),
    lostReason: text(300),
  })
  .strict()
  .refine((deal) => deal.clientId !== null || (deal.prospectName ?? '') !== '', {
    path: ['prospectName'],
    message: 'required_without_client',
  });

export type DealInput = z.infer<typeof dealInputSchema>;

/** A follow-up done: what happened and the next date. */
export const dealFollowUpSchema = z
  .object({
    note: z.string().trim().max(2000).default(''),
    nextActionOn: isoDateSchema.nullable().default(null),
    nextAction: text(300),
  })
  .strict();

/** An entry of a deal's history. */
export interface DealEventView {
  id: string;
  kind: 'stage_changed' | 'follow_up_done' | 'note';
  fromStage: string | null;
  toStage: string | null;
  note: string | null;
  at: string;
}

/** A deal as the API returns it. */
export interface DealView extends DealInput {
  id: string;
  /** Client name, or the prospect's. */
  name: string;
  quoteNumber: string | null;
  closedOn: string | null;
  createdAt: string;
  /** True when the next action date is past and the deal still open. */
  late: boolean;
  events?: DealEventView[];
}
