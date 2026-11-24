import { z } from 'zod';
import { idSchema } from './common.ts';

/** A status id of the country pack, e.g. "micro_bic_services". */
export const activityStatusSchema = z.string().regex(/^[a-z0-9_]{1,40}$/);

/** Adding a secondary activity to a company: one of the statuses of its country pack. */
export const activityInputSchema = z.object({ status: activityStatusSchema }).strict();

/**
 * Activity a record belongs to: null for the main activity (the profile status), else a secondary activity id.
 * Absent means the main activity, so older clients keep working.
 */
export const activityRefSchema = idSchema.nullable().default(null);

/**
 * Activity a link's revenue counts as: "auto" follows the activity the linked instance announces, "main" the
 * main activity, "none" keeps it out of the estimates (thresholds only, as before), else a secondary activity id.
 */
export const linkActivitySchema = z
  .object({ activity: z.union([z.enum(['auto', 'main', 'none']), idSchema]) })
  .strict();

/** One activity of a company: the main one (profile status) or a secondary one. */
export interface CompanyActivity {
  /** Null for the main activity. */
  id: string | null;
  status: string;
  main: boolean;
  /** Link whose announced activity created it automatically, if any. */
  linkId: string | null;
  linkLabel: string | null;
}
