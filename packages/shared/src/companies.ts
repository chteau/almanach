import { z } from 'zod';
import type { CompanyActivity } from './activities.ts';

/** Same bounds as the trade name of the profile, which the company name mirrors. */
export const companyInputSchema = z.object({ name: z.string().trim().min(1).max(160) }).strict();

/** A read-only Stripe key, restricted (`rk_`) so Almanach can never move money. */
export const stripeSettingsSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^rk_(live|test)_[A-Za-z0-9]{10,240}$/, 'restricted_key')
      .optional(),
    enabled: z.boolean(),
  })
  .strict();

/** A company of the signed-in person, with the profile facts the switcher and the legal warning need. */
export interface Company {
  id: string;
  name: string;
  country: string | null;
  status: string | null;
  activityStart: string | null;
  ceasedOn: string | null;
  /** Main activity first, then the secondary ones; empty before onboarding. */
  activities: CompanyActivity[];
}

/**
 * This function tells whether a company is a French micro-entreprise
 *
 * @param company {Pick<Company, 'country' | 'status'>} - country and status
 * @returns {boolean} - true for a French micro-entrepreneur status
 */
export function isFrenchMicro(company: Pick<Company, 'country' | 'status'>): boolean {
  return company.country === 'FR' && (company.status?.startsWith('micro_') ?? false);
}

/**
 * This function finds another French micro-entreprise of the same person still active when a candidate
 * starts: a person may only run one, and several activities are declared under the same SIRET
 *
 * @param companies {Company[]} - the person's companies
 * @param candidate {Pick<Company, 'id' | 'country' | 'status' | 'activityStart'>} - the company being set up
 * @returns {Company | null} - the conflicting company, or null
 */
export function microConflict(
  companies: Company[],
  candidate: Pick<Company, 'id' | 'country' | 'status' | 'activityStart'>,
): Company | null {
  if (!isFrenchMicro(candidate)) return null;
  const start = candidate.activityStart ?? '0000-00-00';
  return (
    companies.find(
      (other) =>
        other.id !== candidate.id &&
        isFrenchMicro(other) &&
        (other.ceasedOn === null || other.ceasedOn >= start),
    ) ?? null
  );
}
