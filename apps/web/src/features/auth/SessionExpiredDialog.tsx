import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button/Button.tsx';
import dialogStyles from '../../components/ConfirmDialog/ConfirmDialog.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import styles from './LoginPage.module.css';
import { useLogin } from './useLogin.ts';

interface SessionExpiredDialogProps {
  email: string;
  onSignedIn: () => void;
  onLeave: () => void;
}

/**
 * Modal sign-in shown over the current page when the session expired, so unsaved input survives (S-018)
 *
 * @param props {SessionExpiredDialogProps} - known e-mail and handlers
 * @returns {JSX.Element} - the dialog
 */
export function SessionExpiredDialog({ email, onSignedIn, onLeave }: SessionExpiredDialogProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const { submit, error, busy, needsCode } = useLogin(onSignedIn);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  /**
   * Submits the password for the known e-mail
   *
   * @param event {SyntheticEvent} - form submission
   * @returns {void} - nothing
   */
  function handleSubmit(event: SyntheticEvent): void {
    event.preventDefault();
    void submit(email, password, code);
  }

  return (
    <dialog ref={ref} className={dialogStyles.dialog} aria-labelledby="expired-title" onCancel={onLeave}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <h2 id="expired-title" className={dialogStyles.title}>
          {t('login.expired.title')}
        </h2>
        <p className={dialogStyles.body}>{t('login.expired.body', { email })}</p>
        {error && (
          <Notice tone="error" live>
            {error}
          </Notice>
        )}
        <TextField
          label={t('login.password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {needsCode && (
          <TextField
            label={t('login.code')}
            hint={t('login.code.hint')}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
        )}
        <div className={dialogStyles.actions}>
          <Button variant="ghost" onClick={onLeave}>
            {t('nav.logout')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('login.submit')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
