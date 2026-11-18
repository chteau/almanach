import {
  bankSchema,
  COUNTRY_CODES,
  companySchema,
  isLuhnValid,
  isoDateSchema,
  parseAmount,
} from '@almanach/shared';
import { useState } from 'react';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { TextAreaField } from '../../components/TextAreaField/TextAreaField.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { ApiError } from '../../lib/api.ts';
import { fieldErrors, zodIssues } from '../../lib/form-errors.ts';
import { countryName, formatDate, formatMoney } from '../../lib/format.ts';
import { describeError } from '../install/errors.ts';
import wizard from '../install/InstallWizard.module.css';
import { StepShell } from '../install/steps/StepShell.tsx';
import { CURRENCIES } from './form.ts';
import type { OnboardingStepProps } from './OnboardingPage.tsx';

const MATURITY_TONE = { verified: 'ok', community: 'neutral', experimental: 'warn' } as const;

/**
 * S-020 to S-022: pick a country with a pack (maturity visible) or any other country in generic mode
 *
 * @param props {OnboardingStepProps} - wizard state and navigation
 * @returns {JSX.Element} - the step
 */
export function CountryStep({ form, pack, packs, update, next }: OnboardingStepProps) {
  const { t, locale } = useI18n();
  const [error, setError] = useState<string>();
  const others = COUNTRY_CODES.filter((code) => !packs.some((candidate) => candidate.country === code)).sort(
    (a, b) => countryName(a, locale).localeCompare(countryName(b, locale), locale),
  );

  /**
   * Picks a country and pre-fills its currency and bank format
   *
   * @param country {string} - ISO country code
   * @returns {void} - nothing
   */
  function choose(country: string): void {
    const chosen = packs.find((candidate) => candidate.country === country);
    update({
      country,
      acknowledged: false,
      status: '',
      declarationPeriod: chosen?.declarationPeriods[0] ?? '',
      options: [],
      identifiers: {},
      currency: chosen?.currency ?? (country === 'CH' ? 'CHF' : form.currency),
      bank: { ...form.bank, format: chosen?.bank ?? 'iban' },
    });
  }

  /**
   * Requires a country, and an explicit acknowledgement for experimental packs (S-022)
   *
   * @returns {void} - nothing
   */
  function submit(): void {
    if (!form.country) {
      setError(t('onboarding.country.required'));
      return;
    }
    if (pack?.maturity === 'experimental' && !form.acknowledged) {
      setError(t('onboarding.country.ack.required'));
      return;
    }
    next();
  }

  return (
    <StepShell title={t('onboarding.country.title')} body={t('onboarding.country.body')} onSubmit={submit}>
      {error && <Notice tone="error">{error}</Notice>}
      <fieldset className={wizard.choices}>
        <legend className="visually-hidden">{t('onboarding.country.title')}</legend>
        {packs.map((candidate) => (
          <label key={candidate.country} className={wizard.choice}>
            <input
              type="radio"
              name="country"
              checked={form.country === candidate.country}
              onChange={() => choose(candidate.country)}
            />
            <span>{candidate.name[locale]}</span>
            <Badge tone={MATURITY_TONE[candidate.maturity]}>{t(`pack.maturity.${candidate.maturity}`)}</Badge>
          </label>
        ))}
      </fieldset>
      <SelectField
        label={t('onboarding.country.other')}
        hint={t('onboarding.country.other.hint')}
        value={pack ? '' : form.country}
        onChange={(event) => choose(event.target.value)}
      >
        <option value="">—</option>
        {others.map((code) => (
          <option key={code} value={code}>
            {countryName(code, locale)}
          </option>
        ))}
      </SelectField>
      {form.country && !pack && (
        <Notice tone="info">
          {t('onboarding.country.generic', { country: countryName(form.country, locale) })}{' '}
          <a
            href="https://github.com/chteau/almanach/blob/main/CONTRIBUTING.md"
            target="_blank"
            rel="noreferrer"
          >
            {t('onboarding.country.contribute')}
          </a>
        </Notice>
      )}
      {pack?.maturity === 'experimental' && (
        <Notice tone="warn">
          <p>{t('onboarding.country.experimental', { country: pack.name[locale] })}</p>
          <label className={wizard.inlineCheck}>
            <input
              type="checkbox"
              checked={form.acknowledged}
              onChange={(event) => update({ acknowledged: event.target.checked })}
            />
            {t('onboarding.country.ack')}
          </label>
        </Notice>
      )}
    </StepShell>
  );
}

/**
 * S-023 to S-026: legal status, start of activity, declaration period and pack options
 *
 * @param props {OnboardingStepProps} - wizard state and navigation
 * @returns {JSX.Element} - the step
 */
export function StatusStep({ form, pack, update, next, back }: OnboardingStepProps) {
  const { t, locale } = useI18n();
  const [errors, setErrors] = useState<{ status?: string; activityStart?: string }>({});
  if (!pack) return null;

  /**
   * Requires a status and a valid start date
   *
   * @returns {void} - nothing
   */
  function submit(): void {
    const found = {
      status: form.status ? undefined : t('errors.required'),
      activityStart: isoDateSchema.safeParse(form.activityStart).success ? undefined : t('errors.invalid'),
    };
    setErrors(found);
    if (!found.status && !found.activityStart) next();
  }

  return (
    <StepShell
      title={t('onboarding.status.title')}
      body={t('onboarding.status.body')}
      onSubmit={submit}
      onBack={back}
    >
      <fieldset className={wizard.choices} aria-describedby={errors.status ? 'status-error' : undefined}>
        <legend className={wizard.commandLabel}>{t('onboarding.status.label')}</legend>
        {pack.statuses.map((status) => (
          <label key={status.id} className={wizard.choice}>
            <input
              type="radio"
              name="status"
              checked={form.status === status.id}
              onChange={() => update({ status: status.id })}
            />
            <span>
              {status.label[locale]}
              {status.hint && <span className={wizard.note}> — {status.hint[locale]}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      {errors.status && (
        <p id="status-error" className={wizard.note} role="alert">
          {errors.status}
        </p>
      )}
      <TextField
        label={t('onboarding.status.start')}
        hint={t('onboarding.status.start.hint')}
        type="date"
        value={form.activityStart}
        onChange={(event) => update({ activityStart: event.target.value })}
        error={errors.activityStart}
        required
      />
      {pack.declarationPeriods.length > 1 && (
        <SelectField
          label={t('onboarding.status.period')}
          value={form.declarationPeriod}
          onChange={(event) => update({ declarationPeriod: event.target.value })}
        >
          {pack.declarationPeriods.map((period) => (
            <option key={period} value={period}>
              {t(`period.${period}`)}
            </option>
          ))}
        </SelectField>
      )}
      {pack.options.length > 0 && (
        <fieldset className={wizard.choices}>
          <legend className={wizard.commandLabel}>{t('onboarding.status.options')}</legend>
          {pack.options.map((option) => (
            <label key={option.id} className={wizard.inlineCheck}>
              <input
                type="checkbox"
                checked={form.options.includes(option.id)}
                onChange={(event) =>
                  update({
                    options: event.target.checked
                      ? [...form.options, option.id]
                      : form.options.filter((id) => id !== option.id),
                  })
                }
              />
              {option.label[locale]}
            </label>
          ))}
        </fieldset>
      )}
    </StepShell>
  );
}

/**
 * S-027, S-028, S-030: company details, legal identifiers checked against the pack, main currency
 *
 * @param props {OnboardingStepProps} - wizard state and navigation
 * @returns {JSX.Element} - the step
 */
export function IdentityStep({ form, pack, update, next, back }: OnboardingStepProps) {
  const { t, locale } = useI18n();
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});

  /**
   * Validates company fields and identifier formats before moving on
   *
   * @returns {void} - nothing
   */
  function submit(): void {
    const result = companySchema.safeParse(form.company);
    const found = result.success
      ? {}
      : fieldErrors(zodIssues(result.error).map((i) => ({ ...i, path: `company.${i.path}` })));
    for (const identifier of pack?.identifiers ?? []) {
      const value = (form.identifiers[identifier.id] ?? '').replace(/[\s.]/g, '').toUpperCase();
      const path = `identifiers.${identifier.id}`;
      if (!value) {
        if (identifier.required) found[path] = 'errors.required';
      } else if (
        !new RegExp(identifier.pattern).test(value) ||
        (identifier.checksum === 'luhn' && !isLuhnValid(value))
      ) {
        found[path] = 'errors.invalid_format';
      }
    }
    setErrors(found);
    if (Object.keys(found).length === 0) next();
  }

  const company = (field: keyof typeof form.company) => ({
    value: form.company[field],
    onChange: (event: { target: { value: string } }) =>
      update({ company: { ...form.company, [field]: event.target.value } }),
    error: errors[`company.${field}`] && t(errors[`company.${field}`] as MessageKey),
  });

  return (
    <StepShell
      title={t('onboarding.identity.title')}
      body={t('onboarding.identity.body')}
      onSubmit={submit}
      onBack={back}
    >
      <TextField
        label={t('onboarding.identity.name')}
        autoComplete="organization"
        maxLength={160}
        required
        {...company('name')}
      />
      <TextAreaField
        label={t('onboarding.identity.address')}
        autoComplete="street-address"
        maxLength={500}
        required
        {...company('address')}
      />
      <TextField
        label={t('onboarding.identity.email')}
        type="email"
        autoComplete="email"
        required
        {...company('email')}
      />
      <TextField label={t('onboarding.identity.phone')} type="tel" autoComplete="tel" {...company('phone')} />
      <TextField
        label={t('onboarding.identity.website')}
        type="url"
        autoComplete="url"
        {...company('website')}
      />
      {pack?.identifiers.map((identifier) => {
        const error = errors[`identifiers.${identifier.id}`];
        return (
          <TextField
            key={identifier.id}
            label={`${identifier.label[locale]}${identifier.required ? '' : ` ${t('common.optional')}`}`}
            hint={t('onboarding.identity.example', { example: identifier.example })}
            value={form.identifiers[identifier.id] ?? ''}
            onChange={(event) =>
              update({ identifiers: { ...form.identifiers, [identifier.id]: event.target.value } })
            }
            error={error && t(error)}
            required={identifier.required}
            spellCheck={false}
          />
        );
      })}
      <SelectField
        label={t('onboarding.identity.currency')}
        hint={t('onboarding.identity.currency.hint')}
        value={form.currency}
        onChange={(event) => update({ currency: event.target.value })}
      >
        {CURRENCIES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </SelectField>
    </StepShell>
  );
}

/**
 * S-029: bank details in the format of the country (IBAN/BIC, sort code, routing number), optional
 *
 * @param props {OnboardingStepProps} - wizard state and navigation
 * @returns {JSX.Element} - the step
 */
export function BankStep({ form, update, next, back }: OnboardingStepProps) {
  const { t } = useI18n();
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const bank = form.bank;

  /**
   * Validates the bank details for the chosen format
   *
   * @returns {void} - nothing
   */
  function submit(): void {
    const payload =
      bank.format === 'iban'
        ? { format: 'iban', iban: bank.iban, bic: bank.bic }
        : bank.format === 'uk'
          ? { format: 'uk', sortCode: bank.sortCode, account: bank.account }
          : bank.format === 'us'
            ? { format: 'us', routing: bank.routing, account: bank.account }
            : { format: 'none' };
    const result = bankSchema.safeParse(payload);
    const found = result.success ? {} : fieldErrors(zodIssues(result.error));
    setErrors(found);
    if (result.success) next();
  }

  const field = (name: 'iban' | 'bic' | 'sortCode' | 'account' | 'routing') => ({
    value: bank[name],
    onChange: (event: { target: { value: string } }) =>
      update({ bank: { ...bank, [name]: event.target.value } }),
    error: errors[name] && t(errors[name] as MessageKey),
    spellCheck: false,
    autoComplete: 'off',
  });

  return (
    <StepShell
      title={t('onboarding.bank.title')}
      body={t('onboarding.bank.body')}
      onSubmit={submit}
      onBack={back}
    >
      <SelectField
        label={t('onboarding.bank.format')}
        value={bank.format}
        onChange={(event) => update({ bank: { ...bank, format: event.target.value as typeof bank.format } })}
      >
        {(['iban', 'uk', 'us', 'none'] as const).map((format) => (
          <option key={format} value={format}>
            {t(`onboarding.bank.format.${format}`)}
          </option>
        ))}
      </SelectField>
      {bank.format === 'iban' && (
        <>
          <TextField label="IBAN" {...field('iban')} required />
          <TextField label={`BIC ${t('common.optional')}`} {...field('bic')} />
        </>
      )}
      {bank.format === 'uk' && (
        <>
          <TextField
            label={t('onboarding.bank.sortCode')}
            inputMode="numeric"
            {...field('sortCode')}
            required
          />
          <TextField
            label={t('onboarding.bank.account')}
            inputMode="numeric"
            {...field('account')}
            required
          />
        </>
      )}
      {bank.format === 'us' && (
        <>
          <TextField
            label={t('onboarding.bank.routing')}
            inputMode="numeric"
            {...field('routing')}
            required
          />
          <TextField
            label={t('onboarding.bank.account')}
            inputMode="numeric"
            {...field('account')}
            required
          />
        </>
      )}
      <p className={wizard.note}>{t('onboarding.bank.note')}</p>
    </StepShell>
  );
}

/**
 * S-033: revenue already collected this fiscal year, so thresholds and estimates start right
 *
 * @param props {OnboardingStepProps} - wizard state and navigation
 * @returns {JSX.Element} - the step
 */
export function RevenueStep({ form, update, next, back }: OnboardingStepProps) {
  const { t } = useI18n();
  const [error, setError] = useState<string>();

  /**
   * Accepts an empty value or a valid amount
   *
   * @returns {void} - nothing
   */
  function submit(): void {
    if (form.priorRevenue.trim() && parseAmount(form.priorRevenue) === null) {
      setError(t('errors.amount'));
      return;
    }
    next();
  }

  return (
    <StepShell
      title={t('onboarding.revenue.title')}
      body={t('onboarding.revenue.body')}
      onSubmit={submit}
      onBack={back}
    >
      <TextField
        label={`${t('onboarding.revenue.amount', { currency: form.currency })} ${t('common.optional')}`}
        hint={t('onboarding.revenue.hint')}
        inputMode="decimal"
        value={form.priorRevenue}
        onChange={(event) => update({ priorRevenue: event.target.value })}
        error={error}
      />
    </StepShell>
  );
}

/**
 * Review and confirm; server-side errors are shown here with the step to fix
 *
 * @param props {OnboardingStepProps & { finish: () => Promise<void> }} - wizard state and the save action
 * @returns {JSX.Element} - the step
 */
export function SummaryStep({
  form,
  pack,
  back,
  finish,
}: OnboardingStepProps & { finish: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const status = pack?.statuses.find((candidate) => candidate.id === form.status);
  const revenue = parseAmount(form.priorRevenue);

  /**
   * Saves the profile
   *
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await finish();
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 422
          ? t('onboarding.summary.invalid')
          : describeError(failure, t),
      );
      setBusy(false);
    }
  }

  const rows: [string, string][] = [
    [
      t('onboarding.summary.country'),
      pack ? pack.name[locale] : `${countryName(form.country, locale)} — ${t('onboarding.summary.generic')}`,
    ],
    ...(status ? ([[t('onboarding.status.label'), status.label[locale]]] as [string, string][]) : []),
    [t('onboarding.status.start'), formatDate(form.activityStart, locale)],
    [t('onboarding.identity.name'), form.company.name],
    [t('onboarding.identity.currency'), form.currency],
    [t('onboarding.bank.format'), t(`onboarding.bank.format.${form.bank.format}`)],
    ...(revenue !== null
      ? ([[t('onboarding.revenue.title'), formatMoney(revenue, form.currency, locale)]] as [string, string][])
      : []),
  ];

  return (
    <StepShell
      title={t('onboarding.summary.title')}
      body={t('onboarding.summary.body')}
      onSubmit={() => void submit()}
      onBack={back}
      submitLabel={t('onboarding.summary.submit')}
      submitDisabled={busy}
    >
      {error && <Notice tone="error">{error}</Notice>}
      <dl className={wizard.summary}>
        {rows.map(([label, value]) => (
          <div key={label} className={wizard.summaryRow}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </StepShell>
  );
}
