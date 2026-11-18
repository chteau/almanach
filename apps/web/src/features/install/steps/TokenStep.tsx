import { useState } from 'react';
import { Link } from 'react-router';
import { Notice } from '../../../components/Notice/Notice.tsx';
import { TextField } from '../../../components/TextField/TextField.tsx';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { ApiError, api } from '../../../lib/api.ts';
import { describeError } from '../errors.ts';
import styles from '../InstallWizard.module.css';
import type { StepProps } from '../types.ts';
import { StepShell } from './StepShell.tsx';

const LOG_COMMAND = 'docker compose logs almanach | grep "installation token"';

/**
 * Step 2: prove ownership of the server with the one-time token printed in its logs
 *
 * @param props {StepProps} - form state and navigation
 * @returns {JSX.Element} - the step
 */
export function TokenStep({ form, update, next, back }: StepProps) {
  const { t } = useI18n();
  const [error, setError] = useState<string>();
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  /**
   * Asks the server to verify the token before moving on
   *
   * @returns {Promise<void>} - resolves when the check is done
   */
  async function submit(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/install/token', { method: 'POST', installToken: form.token.trim() });
      next();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 410) setInstalled(true);
      else if (failure instanceof ApiError && failure.status === 401) setError(t('install.token.invalid'));
      else setError(describeError(failure, t));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Copies the log command to the clipboard
   *
   * @returns {Promise<void>} - resolves once copied, silently ignores refusals
   */
  async function copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(LOG_COMMAND);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <StepShell
      title={t('install.token.title')}
      body={t('install.token.body')}
      onSubmit={submit}
      onBack={back}
      submitDisabled={busy || form.token.trim().length === 0}
    >
      <div className={styles.command}>
        <span className={styles.commandLabel}>{t('install.token.command')}</span>
        <div className={styles.commandRow}>
          <code className={styles.code}>{LOG_COMMAND}</code>
          <button type="button" className={styles.copy} onClick={copyCommand}>
            {copied ? t('common.copied') : t('common.copy')}
          </button>
        </div>
      </div>
      <TextField
        label={t('install.token.field')}
        value={form.token}
        onChange={(event) => update({ token: event.target.value })}
        error={error}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="off"
        required
      />
      {installed && (
        <Notice tone="info">
          {t('install.token.used')} <Link to="/login">{t('login.title')}</Link>
        </Notice>
      )}
    </StepShell>
  );
}
