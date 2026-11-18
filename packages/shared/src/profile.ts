import { z } from 'zod';
import { countrySchema, currencySchema, isoDateSchema, isValidIban, optionalText } from './common.ts';
import { DECLARATION_PERIODS } from './packs.ts';

export const bankSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('none') }).strict(),
  z
    .object({
      format: z.literal('iban'),
      iban: z
        .string()
        .transform((value) => value.replace(/\s/g, '').toUpperCase())
        .refine(isValidIban, { message: 'invalid_iban' }),
      bic: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^([A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?)?$/, 'invalid_bic'),
    })
    .strict(),
  z
    .object({
      format: z.literal('uk'),
      sortCode: z
        .string()
        .transform((value) => value.replace(/[\s-]/g, ''))
        .pipe(z.string().regex(/^\d{6}$/, 'invalid_sort_code')),
      account: z
        .string()
        .trim()
        .regex(/^\d{8}$/, 'invalid_account'),
    })
    .strict(),
  z
    .object({
      format: z.literal('us'),
      routing: z
        .string()
        .trim()
        .regex(/^\d{9}$/, 'invalid_routing'),
      account: z
        .string()
        .trim()
        .regex(/^\d{4,17}$/, 'invalid_account'),
    })
    .strict(),
]);

export type Bank = z.output<typeof bankSchema>;

export const companySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    address: z.string().trim().min(1).max(500),
    email: z.email().max(254),
    phone: optionalText(40),
    website: optionalText(200),
  })
  .strict();

/**
 * Profile as submitted at the end of onboarding; the server additionally checks it against the
 * chosen country pack (status, period, options and identifier formats)
 */
export const profileSchema = z
  .object({
    country: countrySchema,
    status: z.string().max(40).nullable(),
    activityStart: isoDateSchema,
    declarationPeriod: z.enum(DECLARATION_PERIODS).nullable(),
    options: z.array(z.string().max(40)).max(10),
    identifiers: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), z.string().trim().max(40)),
    currency: currencySchema,
    bank: bankSchema,
    company: companySchema,
    priorRevenueCents: z.number().int().min(0).max(100_000_000_000).nullable(),
  })
  .strict();

export type Profile = z.output<typeof profileSchema>;
export type ProfileInput = z.input<typeof profileSchema>;

export const ONBOARDING_STEPS = ['country', 'status', 'identity', 'bank', 'revenue', 'summary'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Partial progress saved while the person moves through onboarding (S-032). */
export const onboardingDraftSchema = z
  .object({
    step: z.enum(ONBOARDING_STEPS),
    data: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 16_000, {
      message: 'too_large',
    }),
  })
  .strict();

/** What can change with a new situation: status, country and the facts tied to them (S-231, S-232). */
export const situationSchema = profileSchema.pick({
  country: true,
  status: true,
  declarationPeriod: true,
  options: true,
  identifiers: true,
  currency: true,
});

export type Situation = z.output<typeof situationSchema>;

/** A change of status or country, effective on a date; obligations before it keep the old situation. */
export const situationChangeSchema = situationSchema.extend({ effectiveOn: isoDateSchema }).strict();

/** End of the activity: last obligations are still computed, then the account becomes read-only (S-233). */
export const cessationSchema = z.object({ effectiveOn: isoDateSchema }).strict();
