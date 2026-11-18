import { z } from 'zod';
import { centsSchema, currencySchema, idSchema, isoDateSchema, optionalText } from './common.ts';

export const MISSION_STATUSES = ['prospect', 'active', 'done', 'cancelled'] as const;
export const BILLING_TYPES = ['fixed', 'daily', 'hourly', 'monthly'] as const;

export const missionInputSchema = z
  .object({
    clientId: idSchema,
    name: z.string().trim().min(1).max(160),
    status: z.enum(MISSION_STATUSES),
    billing: z.enum(BILLING_TYPES),
    rateCents: centsSchema,
    currency: currencySchema,
    startDate: isoDateSchema,
    endDate: isoDateSchema.nullable(),
    budgetCents: centsSchema.nullable(),
    endClient: optionalText(160),
    notes: optionalText(5000),
  })
  .strict()
  .refine((mission) => !mission.endDate || mission.endDate >= mission.startDate, {
    path: ['endDate'],
    message: 'end_before_start',
  });

export type MissionInput = z.input<typeof missionInputSchema>;
export type MissionStatus = (typeof MISSION_STATUSES)[number];
export type BillingType = (typeof BILLING_TYPES)[number];

/** A mission as returned by the API. */
export interface Mission extends z.output<typeof missionInputSchema> {
  id: string;
  clientName: string;
  createdAt: string;
}

/**
 * Tells whether an active mission ends within the given number of days (S-112)
 *
 * @param mission {Pick<Mission, 'status' | 'endDate'>} - mission facts
 * @param today {string} - today as YYYY-MM-DD in the person's time zone
 * @param days {number} - look-ahead window
 * @returns {boolean} - true when the end date falls between today and today + days
 */
export function endsSoon(mission: Pick<Mission, 'status' | 'endDate'>, today: string, days = 14): boolean {
  if (mission.status !== 'active' || !mission.endDate) return false;
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  return mission.endDate >= today && mission.endDate <= limit.toISOString().slice(0, 10);
}
