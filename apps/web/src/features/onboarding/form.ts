import type { Me, PackMeta, Profile, ProfileInput } from '@almanach/shared';
import { parseAmount } from '@almanach/shared';
import { centsToInput, today } from '../../lib/format.ts';

export const CURRENCIES = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'CAD',
  'AUD',
  'JPY',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
];

/** Everything typed during onboarding, kept as strings until the summary builds the profile. */
export interface OnboardingForm {
  country: string;
  acknowledged: boolean;
  status: string;
  activityStart: string;
  declarationPeriod: string;
  options: string[];
  identifiers: Record<string, string>;
  currency: string;
  company: { name: string; address: string; email: string; phone: string; website: string };
  bank: {
    format: 'none' | 'iban' | 'uk' | 'us';
    iban: string;
    bic: string;
    sortCode: string;
    account: string;
    routing: string;
  };
  priorRevenue: string;
}

/**
 * Starting values for a new onboarding
 *
 * @param me {Me} - signed-in person, whose e-mail pre-fills the company contact
 * @returns {OnboardingForm} - empty form
 */
export function emptyForm(me: Me): OnboardingForm {
  return {
    country: '',
    acknowledged: false,
    status: '',
    activityStart: today(),
    declarationPeriod: '',
    options: [],
    identifiers: {},
    currency: 'EUR',
    company: { name: '', address: '', email: me.email, phone: '', website: '' },
    bank: { format: 'none', iban: '', bic: '', sortCode: '', account: '', routing: '' },
    priorRevenue: '',
  };
}

/**
 * Turns the form into the profile payload the server validates
 *
 * @param form {OnboardingForm} - collected values
 * @param pack {PackMeta | undefined} - chosen pack, undefined in generic mode
 * @returns {ProfileInput} - payload for PUT /api/profile
 */
export function toProfile(form: OnboardingForm, pack: PackMeta | undefined): ProfileInput {
  const { format, iban, bic, sortCode, account, routing } = form.bank;
  const bank: ProfileInput['bank'] =
    format === 'iban'
      ? { format, iban, bic }
      : format === 'uk'
        ? { format, sortCode, account }
        : format === 'us'
          ? { format, routing, account }
          : { format: 'none' };
  return {
    country: form.country,
    status: pack ? form.status || null : null,
    activityStart: form.activityStart,
    declarationPeriod: pack ? ((form.declarationPeriod || null) as ProfileInput['declarationPeriod']) : null,
    options: pack ? form.options : [],
    identifiers: pack
      ? Object.fromEntries(
          pack.identifiers.map((identifier) => [identifier.id, form.identifiers[identifier.id] ?? '']),
        )
      : {},
    currency: form.currency,
    bank,
    company: form.company,
    priorRevenueCents: form.priorRevenue.trim() ? parseAmount(form.priorRevenue) : null,
  };
}

/**
 * Fills the form from a saved profile, to edit it from the settings
 *
 * @param profile {Profile} - stored profile
 * @param locale {string} - interface language, for the decimal separator
 * @returns {OnboardingForm} - form values
 */
export function fromProfile(profile: Profile, locale: string): OnboardingForm {
  const bank = profile.bank;
  return {
    country: profile.country,
    acknowledged: true,
    status: profile.status ?? '',
    activityStart: profile.activityStart,
    declarationPeriod: profile.declarationPeriod ?? '',
    options: profile.options,
    identifiers: profile.identifiers,
    currency: profile.currency,
    company: {
      name: profile.company.name,
      address: profile.company.address,
      email: profile.company.email,
      phone: profile.company.phone ?? '',
      website: profile.company.website ?? '',
    },
    bank: {
      format: bank.format,
      iban: bank.format === 'iban' ? bank.iban : '',
      bic: bank.format === 'iban' ? bank.bic : '',
      sortCode: bank.format === 'uk' ? bank.sortCode : '',
      account: bank.format === 'uk' || bank.format === 'us' ? bank.account : '',
      routing: bank.format === 'us' ? bank.routing : '',
    },
    priorRevenue: centsToInput(profile.priorRevenueCents, locale),
  };
}
