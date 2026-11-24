import { z } from 'zod';
import { activityRefSchema } from './activities.ts';
import { isoDateSchema } from './common.ts';

/** Categories of a simple expense; the core keeps them generic, without any country's form boxes. */
export const EXPENSE_CATEGORIES = [
  'supplies',
  'software',
  'equipment',
  'travel',
  'meals',
  'rent',
  'telecom',
  'insurance',
  'fees',
  'training',
  'marketing',
  'vehicle',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const amount = z.number().int().min(0).max(100_000_000_000);

/** An expense as entered: amount before VAT and VAT paid, in the main currency. */
export const expenseInputSchema = z
  .object({
    date: isoDateSchema,
    amountCents: amount,
    vatCents: amount,
    category: z.enum(EXPENSE_CATEGORIES),
    description: z.string().trim().max(200),
    activityId: activityRefSchema,
    /** Receipt kept in the vault, if any. */
    vaultItemId: z.uuid().nullable().default(null),
  })
  .strict();

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

/** An expense as the API returns it. */
export interface ExpenseView extends ExpenseInput {
  id: string;
  currency: string;
}
