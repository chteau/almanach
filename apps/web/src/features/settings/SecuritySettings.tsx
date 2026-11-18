import { PASSWORD_MIN_LENGTH, passwordIssues } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import list from '../../components/RowList/RowList.module.css';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { useMe } from '../auth/AuthProvider.tsx';
import { describeError } from '../install/errors.ts';
import styles from '../planning/Planning.module.css';

interface Account {
  totpEnabled: boolean;
  recoveryCodesLeft: number;
  sessions: {
    id: string;
    createdAt: string;
    expiresAt: string;
    ip: string | null;
    userAgent: string | null;
    current: boolean;
  }[];
}

/**
 * Password, two-factor sign-in and active sessions (S-260 to S-263)
 *
 * @returns {JSX.Element} - the security sections
 */
export function SecuritySettings() {
  const { data, error, reload } = useResource<Account>('/api/account');
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={3} />;
  return (
    <>
      <PasswordForm />
      <TwoFactor account={data} onChange={reload} />
      <Sessions account={data} onChange={reload} />
    </>
  );
}

/**
 * Password change form
 *
 * @returns {JSX.Element} - the form
 */
function PasswordForm() {
  const { t } = useI18n();
  const me = useMe();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string }>();

  /**
   * Validates and changes the password
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const issues = passwordIssues(next, me.email);
    const found: Record<string, string> = {};
    if (!current) found.current = t('security.password.current.required');
    if (issues.length > 0) found.next = issues.map((issue) => t(`install.admin.password.${issue}`)).join(' ');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await api('/api/account/password', { method: 'PUT', body: { current, next } });
      setCurrent('');
      setNext('');
      setMessage({ tone: 'info', text: t('security.password.changed') });
    } catch (problem) {
      if (problem instanceof ApiError && problem.body.error === 'invalid_password')
        setErrors({ current: t('security.password.wrong') });
      else setMessage({ tone: 'error', text: describeError(problem, t) });
    }
  }

  return (
    <form
      className={form.section}
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-labelledby="password-title"
    >
      <h2 id="password-title" className={styles.sectionTitle}>
        {t('security.password')}
      </h2>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <input type="text" autoComplete="username" value={me.email} readOnly hidden />
      <div className={form.grid}>
        <TextField
          label={t('security.password.current')}
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          error={errors.current}
        />
        <TextField
          label={t('security.password.next')}
          hint={t('security.password.next.hint', { min: PASSWORD_MIN_LENGTH })}
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          error={errors.next}
        />
      </div>
      <div className={form.actions}>
        <Button type="submit">{t('security.password.submit')}</Button>
      </div>
    </form>
  );
}

/**
 * Two-factor sign-in with an authenticator app
 *
 * @param props {{ account: Account; onChange: () => void }} - account state and refresh callback
 * @returns {JSX.Element} - the section
 */
function TwoFactor({ account, onChange }: { account: Account; onChange: () => void }) {
  const { t } = useI18n();
  const [setup, setSetup] = useState<{ secret: string; uri: string }>();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[]>();
  const [failure, setFailure] = useState<string>();

  /**
   * Runs an API call and shows its error in the section
   *
   * @param action {() => Promise<void>} - call
   * @returns {Promise<void>} - resolves when done
   */
  const run = async (action: () => Promise<void>): Promise<void> => {
    try {
      setFailure(undefined);
      await action();
    } catch (problem) {
      const known = problem instanceof ApiError ? problem.body.error : undefined;
      setFailure(
        known === 'invalid_code'
          ? t('login.error.code')
          : known === 'invalid_password'
            ? t('security.password.wrong')
            : describeError(problem, t),
      );
    }
  };

  return (
    <section className={form.section} aria-labelledby="totp-title">
      <div className={styles.sectionHead}>
        <h2 id="totp-title" className={styles.sectionTitle}>
          {t('security.totp')}
        </h2>
        <Badge tone={account.totpEnabled ? 'ok' : 'neutral'}>
          {account.totpEnabled ? t('security.totp.on') : t('security.totp.off')}
        </Badge>
      </div>
      {failure && <Notice tone="error">{failure}</Notice>}
      {codes && (
        <Notice tone="warn">
          {t('security.totp.codes')}
          <code className={styles.codes}>{codes.join('\n')}</code>
        </Notice>
      )}
      {!account.totpEnabled && !setup && (
        <>
          <p className={styles.text}>{t('security.totp.body')}</p>
          <div className={form.actions}>
            <Button
              onClick={() =>
                void run(async () => setSetup(await api('/api/account/totp/setup', { method: 'POST' })))
              }
            >
              {t('security.totp.start')}
            </Button>
          </div>
        </>
      )}
      {!account.totpEnabled && setup && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const result = await api<{ recoveryCodes: string[] }>('/api/account/totp/enable', {
                method: 'POST',
                body: { code: code.trim() },
              });
              setCodes(result.recoveryCodes);
              setSetup(undefined);
              setCode('');
              onChange();
            });
          }}
          noValidate
        >
          <p className={styles.text}>{t('security.totp.scan')}</p>
          <p>
            <a href={setup.uri}>{t('security.totp.open')}</a>
          </p>
          <TextField
            label={t('security.totp.secret')}
            value={setup.secret.replace(/(.{4})/g, '$1 ').trim()}
            readOnly
          />
          <TextField
            label={t('login.code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <div className={form.actions}>
            <Button variant="ghost" onClick={() => setSetup(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('security.totp.confirm')}</Button>
          </div>
        </form>
      )}
      {account.totpEnabled && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api('/api/account/totp/disable', { method: 'POST', body: { password } });
              setPassword('');
              setCodes(undefined);
              onChange();
            });
          }}
          noValidate
        >
          <p className={styles.caption}>{t('security.totp.left', { count: account.recoveryCodesLeft })}</p>
          <TextField
            label={t('security.password.current')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className={form.actions}>
            <Button type="submit" variant="ghost">
              {t('security.totp.disable')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * Lists signed-in devices and lets the person sign them out
 *
 * @param props {{ account: Account; onChange: () => void }} - account state and refresh callback
 * @returns {JSX.Element} - the section
 */
function Sessions({ account, onChange }: { account: Account; onChange: () => void }) {
  const { t, locale } = useI18n();
  const others = account.sessions.filter((session) => !session.current).length;
  return (
    <section className={form.section} aria-labelledby="sessions-title">
      <h2 id="sessions-title" className={styles.sectionTitle}>
        {t('security.sessions')}
      </h2>
      <ul className={list.list}>
        {account.sessions.map((session) => (
          <li key={session.id} className={list.item}>
            <div className={list.row}>
              <span className={list.primary}>
                <strong>
                  {session.userAgent ? describeAgent(session.userAgent) : t('security.sessions.unknown')}
                </strong>
                <span className={list.secondary}>
                  {t('security.sessions.since', { date: formatDate(session.createdAt.slice(0, 10), locale) })}
                  {session.ip ? ` · ${session.ip}` : ''}
                </span>
              </span>
              {session.current ? (
                <Badge tone="ok">{t('security.sessions.current')}</Badge>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void api(`/api/account/sessions/${session.id}`, { method: 'DELETE' }).then(onChange)
                  }
                >
                  {t('security.sessions.revoke')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {others > 0 && (
        <div className={form.actions}>
          <Button
            variant="ghost"
            onClick={() => void api('/api/account/sessions/revoke-others', { method: 'POST' }).then(onChange)}
          >
            {t('security.sessions.revokeOthers')}
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * Short, readable name for a browser user agent
 *
 * @param agent {string} - User-Agent header
 * @returns {string} - e.g. "Firefox · Linux"
 */
export function describeAgent(agent: string): string {
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : agent.split(/[/ ]/)[0] || '?';
  const system = /Android/.test(agent)
    ? 'Android'
    : /iPhone|iPad/.test(agent)
      ? 'iOS'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Mac OS X/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : '';
  return system ? `${browser} · ${system}` : browser;
}
