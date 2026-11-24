import { isLuhnValid, type PackMeta, type Profile, profileSchema } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextAreaField } from '../../components/TextAreaField/TextAreaField.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { ApiError, api } from '../../lib/api.ts';
import { fieldErrors, serverIssues, zodIssues } from '../../lib/form-errors.ts';
import { useResource } from '../../lib/useResource.ts';
import text from '../../styles/text.module.css';
import { useAuth } from '../auth/AuthProvider.tsx';
import { CURRENCIES, fromProfile, type OnboardingForm, toProfile } from '../onboarding/form.ts';
import { useAction } from './useAction.ts';

interface ProfileResponse {
  profile: Profile;
  pack: PackMeta | null;
}

/**
 * Business details printed on documents, edited in place (P20); status and country move through
 * the situation section below
 *
 * @returns {JSX.Element} - the section
 */
export function ProfileSettings() {
  const { data, error, reload } = useResource<ProfileResponse>('/api/profile');
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  return <ProfileForm data={data} />;
}

/**
 * Checks the identifiers against the patterns of the country pack
 *
 * @param values {OnboardingForm} - form values
 * @param pack {PackMeta | null} - country pack
 * @returns {Record<string, MessageKey>} - errors by field path
 */
function identifierErrors(values: OnboardingForm, pack: PackMeta | null): Record<string, MessageKey> {
  const found: Record<string, MessageKey> = {};
  for (const identifier of pack?.identifiers ?? []) {
    const value = (values.identifiers[identifier.id] ?? '').replace(/[\s.]/g, '').toUpperCase();
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
  return found;
}

/**
 * Profile form once loaded
 *
 * @param props {{ data: ProfileResponse }} - stored profile and its pack
 * @returns {JSX.Element} - the form
 */
function ProfileForm({ data }: { data: ProfileResponse }) {
  const { t, locale } = useI18n();
  const { refresh } = useAuth();
  const [saved, setSaved] = useState(() => fromProfile(data.profile, locale));
  const [values, setValues] = useState(saved);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const action = useAction();
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const pack = data.pack;

  /**
   * Validates, then saves the profile
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const parsed = profileSchema.safeParse(toProfile(values, pack ?? undefined));
    const found = {
      ...(parsed.success ? {} : fieldErrors(zodIssues(parsed.error))),
      ...identifierErrors(values, pack),
    };
    if (values.priorRevenue.trim() && toProfile(values, undefined).priorRevenueCents === null) {
      found.priorRevenue = 'errors.amount';
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || !parsed.success) {
      action.setFeedback({ tone: 'error', text: t('settings.form.invalid') });
      return;
    }
    await action.run(async () => {
      try {
        await api('/api/profile', { method: 'PUT', body: parsed.data });
      } catch (problem) {
        if (problem instanceof ApiError && problem.body.issues)
          setErrors(fieldErrors(serverIssues(problem.body)));
        throw problem;
      }
      setSaved(values);
      await refresh();
      return t('settings.profile.saved');
    });
  }

  /**
   * Props of a text input bound to a company field
   *
   * @param field {keyof OnboardingForm['company']} - field name
   * @returns {{ value: string; onChange: (event: { target: { value: string } }) => void; error: string | undefined }} - input props
   */
  const company = (field: keyof OnboardingForm['company']) => ({
    value: values.company[field],
    onChange: (event: { target: { value: string } }) =>
      setValues({ ...values, company: { ...values.company, [field]: event.target.value } }),
    error: errors[`company.${field}`] && t(errors[`company.${field}`] as MessageKey),
  });

  /**
   * Props of a text input bound to a bank field
   *
   * @param field {'iban' | 'bic' | 'sortCode' | 'account' | 'routing'} - field name
   * @returns {object} - input props
   */
  const bank = (field: 'iban' | 'bic' | 'sortCode' | 'account' | 'routing') => ({
    value: values.bank[field],
    onChange: (event: { target: { value: string } }) =>
      setValues({ ...values, bank: { ...values.bank, [field]: event.target.value } }),
    error:
      (errors[`bank.${field}`] ?? errors[field]) &&
      t((errors[`bank.${field}`] ?? errors[field]) as MessageKey),
    spellCheck: false,
    autoComplete: 'off',
  });

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <SettingsSection
        title={t('settings.profile.title')}
        description={t('settings.profile.body')}
        footer={
          <ActionBar
            primaryLabel={t('common.save')}
            busy={action.busy}
            dirty={dirty}
            feedback={action.feedback}
          />
        }
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
        <div className={form.grid}>
          <TextField
            label={t('onboarding.identity.email')}
            type="email"
            autoComplete="email"
            required
            {...company('email')}
          />
          <TextField
            label={t('onboarding.identity.phone')}
            type="tel"
            autoComplete="tel"
            {...company('phone')}
          />
          <TextField
            label={t('onboarding.identity.website')}
            type="url"
            autoComplete="url"
            {...company('website')}
          />
        </div>
        {pack && pack.identifiers.length > 0 && (
          <div className={form.grid}>
            {pack.identifiers.map((identifier) => {
              const error = errors[`identifiers.${identifier.id}`];
              return (
                <TextField
                  key={identifier.id}
                  label={`${identifier.label[locale]}${identifier.required ? '' : ` ${t('common.optional')}`}`}
                  hint={t('onboarding.identity.example', { example: identifier.example })}
                  value={values.identifiers[identifier.id] ?? ''}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      identifiers: { ...values.identifiers, [identifier.id]: event.target.value },
                    })
                  }
                  error={error && t(error)}
                  required={identifier.required}
                  spellCheck={false}
                />
              );
            })}
          </div>
        )}
        <h3 className={text.subTitle}>{t('onboarding.bank.title')}</h3>
        <SelectField
          label={t('onboarding.bank.format')}
          value={values.bank.format}
          onChange={(event) =>
            setValues({
              ...values,
              bank: { ...values.bank, format: event.target.value as OnboardingForm['bank']['format'] },
            })
          }
        >
          {(['iban', 'uk', 'us', 'none'] as const).map((format) => (
            <option key={format} value={format}>
              {t(`onboarding.bank.format.${format}`)}
            </option>
          ))}
        </SelectField>
        {values.bank.format === 'iban' && (
          <div className={form.grid}>
            <TextField label="IBAN" {...bank('iban')} required />
            <TextField label={`BIC ${t('common.optional')}`} {...bank('bic')} />
          </div>
        )}
        {values.bank.format === 'uk' && (
          <div className={form.grid}>
            <TextField
              label={t('onboarding.bank.sortCode')}
              inputMode="numeric"
              {...bank('sortCode')}
              required
            />
            <TextField
              label={t('onboarding.bank.account')}
              inputMode="numeric"
              {...bank('account')}
              required
            />
          </div>
        )}
        {values.bank.format === 'us' && (
          <div className={form.grid}>
            <TextField
              label={t('onboarding.bank.routing')}
              inputMode="numeric"
              {...bank('routing')}
              required
            />
            <TextField
              label={t('onboarding.bank.account')}
              inputMode="numeric"
              {...bank('account')}
              required
            />
          </div>
        )}
        <h3 className={text.subTitle}>{t('settings.profile.figures')}</h3>
        <div className={form.grid}>
          <TextField
            label={t('settings.activityStart')}
            type="date"
            value={values.activityStart}
            onChange={(event) => setValues({ ...values, activityStart: event.target.value })}
            error={errors.activityStart && t(errors.activityStart)}
          />
          <SelectField
            label={t('onboarding.identity.currency')}
            hint={t('onboarding.identity.currency.hint')}
            value={values.currency}
            onChange={(event) => setValues({ ...values, currency: event.target.value })}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField
          label={`${t('onboarding.revenue.amount', { currency: values.currency })} ${t('common.optional')}`}
          hint={t('onboarding.revenue.hint')}
          inputMode="decimal"
          value={values.priorRevenue}
          onChange={(event) => setValues({ ...values, priorRevenue: event.target.value })}
          error={errors.priorRevenue && t(errors.priorRevenue)}
        />
      </SettingsSection>
    </form>
  );
}
