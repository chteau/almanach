import type { InstallCheck } from '@almanach/shared';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../components/Button/Button.tsx';
import { Notice } from '../../../components/Notice/Notice.tsx';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../../i18n/messages.ts';
import { api } from '../../../lib/api.ts';
import { describeError } from '../errors.ts';
import styles from '../InstallWizard.module.css';
import type { StepProps } from '../types.ts';
import { StepShell } from './StepShell.tsx';

/**
 * Step 3: run the server-side environment checks; red items block the wizard
 *
 * @param props {StepProps} - form state and navigation
 * @returns {JSX.Element} - the step
 */
export function ChecksStep({ form, next, back }: StepProps) {
  const { t } = useI18n();
  const [checks, setChecks] = useState<InstallCheck[] | null>(null);
  const [error, setError] = useState<string>();

  const run = useCallback(async () => {
    setChecks(null);
    setError(undefined);
    try {
      const result = await api<{ checks: InstallCheck[] }>('/api/install/checks', {
        installToken: form.token.trim(),
      });
      setChecks(result.checks);
    } catch (failure) {
      setError(describeError(failure, t));
    }
  }, [form.token, t]);

  useEffect(() => {
    void run();
  }, [run]);

  const blocked = !checks || checks.some((check) => check.status === 'fail');

  return (
    <StepShell
      title={t('install.checks.title')}
      body={t('install.checks.body')}
      onSubmit={next}
      onBack={back}
      submitDisabled={blocked}
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!checks && !error && <p aria-live="polite">{t('common.loading')}</p>}
      {checks && (
        <ul className={styles.checks}>
          {checks.map((check) => (
            <li key={check.id} className={styles.check}>
              <span className={`${styles.badge} ${styles[check.status]}`}>
                {t(`install.checks.status.${check.status}`)}
              </span>
              <span className={styles.checkText}>
                <strong>{t(`install.checks.${check.id}.label` as MessageKey)}</strong>
                <span>
                  {t(`install.checks.${check.id}.${check.status}` as MessageKey, {
                    detail: check.detail ?? '',
                  })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {checks && blocked && <Notice tone="warn">{t('install.checks.blocked')}</Notice>}
      <Button variant="ghost" onClick={run}>
        {t('common.retry')}
      </Button>
    </StepShell>
  );
}
