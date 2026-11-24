import { type SyntheticEvent, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/Button/Button.tsx';
import { Logo } from '../../components/Logo/Logo.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { useAuth } from './AuthProvider.tsx';
import styles from './LoginPage.module.css';
import { useLogin } from './useLogin.ts';

const RESET_COMMAND =
  'docker compose exec almanach bun apps/server/src/cli/reset-password.ts you@example.com';

/**
 * Only allows redirects to local paths after sign-in, never to another site
 *
 * @param next {string | null} - requested path
 * @returns {string} - safe local path
 */
export function safeNext(next: string | null): string {
  return next?.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

/**
 * Sign-in page (S-010 to S-012, S-016)
 *
 * @returns {JSX.Element} - the page
 */
export function LoginPage() {
  const { t } = useI18n();
  const { state, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const { submit, error, busy, needsCode } = useLogin(() => {
    void refresh().then(() => navigate(next, { replace: true }));
  });

  if (state.status === 'signed-in') return <Navigate to={next} replace />;

  /**
   * Submits the credentials
   *
   * @param event {SyntheticEvent} - form submission
   * @returns {void} - nothing
   */
  function handleSubmit(event: SyntheticEvent): void {
    event.preventDefault();
    void submit(email, password, code);
  }

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Logo />
      </header>
      <main className={styles.main}>
        <PageHeader title={t('login.title')} />
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {error && (
            <Notice tone="error" live>
              {error}
            </Notice>
          )}
          <TextField
            label={t('login.email')}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
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
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          )}
          <Button type="submit" disabled={busy}>
            {busy ? t('common.loading') : t('login.submit')}
          </Button>
        </form>
        <details className={styles.forgot}>
          <summary>{t('login.forgot')}</summary>
          <p>{t('login.forgot.body')}</p>
          <code className={styles.code}>{RESET_COMMAND}</code>
        </details>
      </main>
    </div>
  );
}
