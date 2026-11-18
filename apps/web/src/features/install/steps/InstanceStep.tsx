import { instanceSchema } from '@almanach/shared';
import { useId, useMemo, useState } from 'react';
import textStyles from '../../../components/TextField/TextField.module.css';
import { TextField } from '../../../components/TextField/TextField.tsx';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import type { StepProps } from '../types.ts';
import { StepShell } from './StepShell.tsx';

/**
 * Lists the time zones offered in the selector
 *
 * @param current {string} - zone that must be present even if the runtime omits it (e.g. "UTC")
 * @returns {string[]} - sorted IANA zone names
 */
function timeZones(current: string): string[] {
  const zones = new Set(Intl.supportedValuesOf('timeZone'));
  zones.add(current);
  return [...zones].sort();
}

/**
 * Step 5: name the instance, its public address and default time zone
 *
 * @param props {StepProps} - form state and navigation
 * @returns {JSX.Element} - the step
 */
export function InstanceStep({ form, update, next, back }: StepProps) {
  const { t } = useI18n();
  const [errors, setErrors] = useState<{ name?: string; publicUrl?: string }>({});
  const zoneId = useId();
  const zones = useMemo(() => timeZones(form.instance.timezone), [form.instance.timezone]);

  /**
   * Validates the instance settings locally, then continues
   *
   * @returns {void} - nothing
   */
  function submit(): void {
    const result = instanceSchema.safeParse(form.instance);
    if (result.success) {
      setErrors({});
      next();
      return;
    }
    const paths = new Set(result.error.issues.map((issue) => issue.path[0]));
    setErrors({
      name: paths.has('name') ? t('install.instance.name.invalid') : undefined,
      publicUrl: paths.has('publicUrl') ? t('install.instance.url.invalid') : undefined,
    });
  }

  return (
    <StepShell
      title={t('install.instance.title')}
      body={t('install.instance.body')}
      onSubmit={submit}
      onBack={back}
    >
      <TextField
        label={t('install.instance.name')}
        value={form.instance.name}
        onChange={(event) => update({ instance: { ...form.instance, name: event.target.value } })}
        error={errors.name}
        maxLength={80}
        required
      />
      <TextField
        label={t('install.instance.url')}
        type="url"
        inputMode="url"
        value={form.instance.publicUrl}
        onChange={(event) => update({ instance: { ...form.instance, publicUrl: event.target.value } })}
        error={errors.publicUrl}
        hint={t('install.instance.url.hint')}
        required
      />
      <div className={textStyles.field}>
        <label htmlFor={zoneId} className={textStyles.label}>
          {t('install.instance.timezone')}
        </label>
        <select
          id={zoneId}
          className={textStyles.input}
          value={form.instance.timezone}
          aria-describedby={`${zoneId}-hint`}
          onChange={(event) => update({ instance: { ...form.instance, timezone: event.target.value } })}
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <span id={`${zoneId}-hint`} className={textStyles.hint}>
          {t('install.instance.timezone.hint')}
        </span>
      </div>
    </StepShell>
  );
}
