import { z } from 'zod';
import { idSchema, isoDateSchema, optionalText } from './common.ts';

/** Working day used to show and invoice time on day-rate missions: 7 hours. */
export const MINUTES_PER_DAY = 420;

/** A timer running longer than this is probably forgotten (S-135). */
export const TIMER_WARNING_MINUTES = 600;

/** Manual time entry (S-130, S-134). */
export const timeEntrySchema = z
  .object({
    missionId: idSchema,
    date: isoDateSchema,
    minutes: z.number().int().min(1).max(1440),
    billable: z.boolean(),
    note: optionalText(300),
  })
  .strict();

export type TimeEntryInput = z.input<typeof timeEntrySchema>;

/** Starts the timer on a mission (S-131). */
export const timerStartSchema = z
  .object({ missionId: idSchema, billable: z.boolean(), note: optionalText(300) })
  .strict();

/** Stops the timer; `minutes` corrects the duration of a forgotten timer (S-135). */
export const timerStopSchema = z.object({ minutes: z.number().int().min(1).max(1440).optional() }).strict();

/** Turns unbilled time into a draft invoice (S-133, S-161). */
export const timeInvoiceSchema = z.object({ entryIds: z.array(idSchema).min(1).max(500) }).strict();

/**
 * Converts minutes into an invoice quantity (×1000) in the unit of the mission
 *
 * @param minutes {number} - total minutes
 * @param billing {'hourly' | 'daily'} - how the mission is billed
 * @returns {{ quantity: number; unit: 'hour' | 'day' }} - quantity in thousandths and unit
 */
export function timeQuantity(
  minutes: number,
  billing: 'hourly' | 'daily',
): { quantity: number; unit: 'hour' | 'day' } {
  return billing === 'daily'
    ? { quantity: Math.round((minutes * 1000) / MINUTES_PER_DAY), unit: 'day' }
    : { quantity: Math.round((minutes * 1000) / 60), unit: 'hour' };
}

/**
 * Parses a duration typed as "1:30", "1h30", "1,5" or "90m" into minutes
 *
 * @param text {string} - typed duration; a bare number is in hours, or in days when `days` is true
 * @param days {boolean} - true for day-rate missions
 * @returns {number | null} - minutes, or null when the text is not a duration
 */
export function parseDuration(text: string, days = false): number | null {
  const value = text.trim().toLowerCase().replace(',', '.');
  const clock = /^(\d{1,2})\s*(?::|h)\s*(\d{1,2})?$/.exec(value);
  if (clock) {
    const minutes = Number(clock[1]) * 60 + Number(clock[2] ?? 0);
    return Number(clock[2] ?? 0) < 60 && minutes > 0 && minutes <= 1440 ? minutes : null;
  }
  const suffixed = /^(\d+(?:\.\d+)?)\s*(m|min|j|d)?$/.exec(value);
  if (!suffixed) return null;
  const amount = Number(suffixed[1]);
  const unit = suffixed[2];
  const minutes = Math.round(
    unit === 'm' || unit === 'min'
      ? amount
      : unit === 'j' || unit === 'd' || days
        ? amount * MINUTES_PER_DAY
        : amount * 60,
  );
  return minutes > 0 && minutes <= 1440 ? minutes : null;
}
