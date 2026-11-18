import { useState } from 'react';
import { Notice } from '../../../components/Notice/Notice.tsx';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { ApiError, api } from '../../../lib/api.ts';
import { describeError } from '../errors.ts';
import styles from '../InstallWizard.module.css';
import type { StepProps } from '../types.ts';
import { StepShell } from './StepShell.tsx';

const KNOWN_ERRORS = ['already_installed', 'checks_failed', 'validation_failed'] as const;

/**
 * Step 6: review and submit; the server validates everything again and creates the instance atomically
 *
 * @param props {StepProps} - form state and navigation
 * @returns {JSX.Element} - the step
 */
export function SummaryStep({ form, back }: StepProps) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  /**
   * Sends the installation and opens the next page on success
   *
   * @returns {Promise<void>} - resolves when the request settles
   */
  async function submit(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<{ redirect: string }>('/api/install/complete', {
        method: 'POST',
        installToken: form.token.trim(),
        body: { locale, admin: form.admin, instance: form.instance },
      });
      window.location.assign(result.redirect);
    } catch (failure) {
      const code =
        failure instanceof ApiError ? KNOWN_ERRORS.find((known) => known === failure.body.error) : undefined;
      setError(code ? t(`install.summary.error.${code}`) : describeError(failure, t));
      setBusy(false);
    }
  }

  const rows = [
    [t('install.summary.language'), t(`lang.${locale}`)],
    [t('install.summary.admin'), form.admin.email.trim().toLowerCase()],
    [t('install.summary.name'), form.instance.name.trim()],
    [t('install.summary.url'), form.instance.publicUrl],
    [t('install.summary.timezone'), form.instance.timezone],
  ] as const;

  return (
    <StepShell
      title={t('install.summary.title')}
      body={t('install.summary.body')}
      onSubmit={submit}
      onBack={back}
      submitDisabled={busy}
      submitLabel={busy ? t('install.summary.submitting') : t('install.summary.submit')}
    >
      <dl className={styles.summary}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.summaryRow}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {error && <Notice tone="error">{error}</Notice>}
    </StepShell>
  );
}
