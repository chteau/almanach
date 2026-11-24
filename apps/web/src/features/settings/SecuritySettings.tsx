import { PASSWORD_MIN_LENGTH, passwordIssues } from '@almanach/shared';
import { type ReactNode, type SyntheticEvent, useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import { DangerAction, DangerZone } from '../../components/DangerZone/DangerZone.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { Row } from '../../components/Row/Row.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import text from '../../styles/text.module.css';
import { useMe } from '../auth/AuthProvider.tsx';
import { describeError } from '../install/errors.ts';
import { useAction } from './useAction.ts';

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
 * Password change form (S-260)
 *
 * @returns {JSX.Element} - the form
 */
export function PasswordSettings() {
  const { t } = useI18n();
  const me = useMe();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();

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
    if (Object.keys(found).length > 0) {
      action.setFeedback({ tone: 'error', text: t('settings.form.invalid') });
      return;
    }
    await action.run(async () => {
      try {
        await api('/api/account/password', { method: 'PUT', body: { current, next } });
      } catch (problem) {
        if (problem instanceof ApiError && problem.body.error === 'invalid_password') {
          setErrors({ current: t('security.password.wrong') });
        }
        throw problem;
      }
      setCurrent('');
      setNext('');
      return t('security.password.changed');
    });
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <SettingsSection
        title={t('security.password')}
        footer={
          <ActionBar
            primaryLabel={t('security.password.submit')}
            busy={action.busy}
            dirty={current !== '' || next !== ''}
            feedback={action.feedback}
          />
        }
      >
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
      </SettingsSection>
    </form>
  );
}

/**
 * Loads the account security state for a panel
 *
 * @param render {(account: Account, reload: () => void) => JSX.Element} - panel body
 * @returns {JSX.Element} - the body, a skeleton, or the load error
 */
function WithAccount({ render }: { render: (account: Account, reload: () => void) => ReactNode }) {
  const { data, error, reload } = useResource<Account>('/api/account');
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={3} />;
  return render(data, reload);
}

/**
 * Two-step sign-in panel (S-261, S-262)
 *
 * @returns {JSX.Element} - the panel
 */
export function TwoFactorSettings() {
  return <WithAccount render={(account, reload) => <TwoFactor account={account} onChange={reload} />} />;
}

/**
 * Signed-in devices panel (S-263)
 *
 * @returns {JSX.Element} - the panel
 */
export function DevicesSettings() {
  return <WithAccount render={(account, reload) => <Sessions account={account} onChange={reload} />} />;
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
  /**
   * Names the known failures of the two-step calls
   *
   * @param problem {unknown} - failure
   * @returns {string | undefined} - specific message, if any
   */
  const explain = (problem: unknown): string | undefined => {
    const known = problem instanceof ApiError ? problem.body.error : undefined;
    return known === 'invalid_code'
      ? t('login.error.code')
      : known === 'invalid_password'
        ? t('security.password.wrong')
        : undefined;
  };
  const action = useAction(explain);

  const badge = (
    <Badge tone={account.totpEnabled ? 'ok' : 'neutral'}>
      {account.totpEnabled ? t('security.totp.on') : t('security.totp.off')}
    </Badge>
  );

  return (
    <>
      {codes && (
        <Notice tone="warn" live>
          {t('security.totp.codes')}
          <code className={text.codes}>{codes.join('\n')}</code>
        </Notice>
      )}
      {!account.totpEnabled && !setup && (
        <SettingsSection
          title={t('security.totp')}
          description={t('security.totp.body')}
          badge={badge}
          footer={
            <ActionBar
              primaryLabel={t('security.totp.start')}
              busy={action.busy}
              feedback={action.feedback?.tone === 'error' ? action.feedback : null}
              onPrimary={() =>
                void action.run(async () => {
                  setSetup(await api('/api/account/totp/setup', { method: 'POST' }));
                })
              }
            />
          }
        />
      )}
      {!account.totpEnabled && setup && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              const result = await api<{ recoveryCodes: string[] }>('/api/account/totp/enable', {
                method: 'POST',
                body: { code: code.trim() },
              });
              setCodes(result.recoveryCodes);
              setSetup(undefined);
              setCode('');
              onChange();
              return t('settings.totp.enabled');
            });
          }}
          noValidate
        >
          <SettingsSection
            title={t('security.totp')}
            description={t('security.totp.scan')}
            badge={badge}
            footer={
              <ActionBar
                primaryLabel={t('security.totp.confirm')}
                busy={action.busy}
                feedback={action.feedback}
              >
                <Button variant="ghost" onClick={() => setSetup(undefined)}>
                  {t('common.cancel')}
                </Button>
              </ActionBar>
            }
          >
            <p className={text.text}>
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
          </SettingsSection>
        </form>
      )}
      {account.totpEnabled && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              await api('/api/account/totp/disable', { method: 'POST', body: { password } });
              setPassword('');
              setCodes(undefined);
              onChange();
              return t('settings.totp.disabled');
            });
          }}
          noValidate
        >
          <SettingsSection
            title={t('security.totp')}
            description={t('security.totp.left', { count: account.recoveryCodesLeft })}
            badge={badge}
            footer={
              <ActionBar
                primaryLabel={t('security.totp.disable')}
                busy={action.busy}
                feedback={action.feedback}
              />
            }
          >
            <TextField
              label={t('security.password.current')}
              hint={t('settings.totp.disable.hint')}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </SettingsSection>
        </form>
      )}
    </>
  );
}

/**
 * Lists signed-in devices and lets the person sign them out after confirmation
 *
 * @param props {{ account: Account; onChange: () => void }} - account state and refresh callback
 * @returns {JSX.Element} - the sections
 */
function Sessions({ account, onChange }: { account: Account; onChange: () => void }) {
  const { t, locale } = useI18n();
  const [target, setTarget] = useState<Account['sessions'][number]>();
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);
  const others = account.sessions.filter((session) => !session.current).length;

  /**
   * Signs out devices and reports the outcome
   *
   * @param call {() => Promise<unknown>} - API call
   * @param success {string} - text when it worked
   * @returns {Promise<void>} - resolves when done
   */
  async function signOut(call: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true);
    try {
      await call();
      setResult({ tone: 'success', text: success });
    } catch (problem) {
      setResult({ tone: 'error', text: describeError(problem, t) });
    } finally {
      setBusy(false);
    }
    onChange();
  }

  /**
   * Readable name of a session's device
   *
   * @param session {Account['sessions'][number]} - session
   * @returns {string} - e.g. "Firefox · Linux"
   */
  const device = (session: Account['sessions'][number]): string =>
    session.userAgent ? describeAgent(session.userAgent) : t('security.sessions.unknown');

  return (
    <>
      <SettingsSection title={t('security.sessions')} description={t('settings.sessions.body')}>
        {result && (
          <Notice tone={result.tone} live>
            {result.text}
          </Notice>
        )}
        <ul className={list.list}>
          {account.sessions.map((session) => (
            <li key={session.id} className={list.item}>
              <Row
                primary={<strong>{device(session)}</strong>}
                meta={`${t('security.sessions.since', { date: formatDate(session.createdAt.slice(0, 10), locale) })}${
                  session.ip ? ` · ${session.ip}` : ''
                }`}
                actions={
                  session.current ? (
                    <Badge tone="ok">{t('security.sessions.current')}</Badge>
                  ) : (
                    <Button variant="ghost" aria-haspopup="dialog" onClick={() => setTarget(session)}>
                      {t('security.sessions.revoke')}
                    </Button>
                  )
                }
              />
            </li>
          ))}
        </ul>
      </SettingsSection>
      {others > 0 && (
        <DangerZone>
          <DangerAction
            label={t('security.sessions.revokeOthers')}
            consequence={
              others === 1
                ? t('settings.sessions.revokeOthers.one')
                : t('settings.sessions.revokeOthers.many', { count: others })
            }
            actionLabel={t('settings.sessions.signOut')}
            busy={busy}
            onConfirm={() =>
              void signOut(
                () => api('/api/account/sessions/revoke-others', { method: 'POST' }),
                t('settings.sessions.othersSignedOut'),
              )
            }
          />
        </DangerZone>
      )}
      <ConfirmDialog
        open={target !== undefined}
        danger
        title={t('security.sessions.revoke')}
        body={t('settings.sessions.revoke.body', { device: target ? device(target) : '' })}
        confirmLabel={t('settings.sessions.signOut')}
        onCancel={() => setTarget(undefined)}
        onConfirm={() => {
          const session = target;
          setTarget(undefined);
          if (session) {
            void signOut(
              () => api(`/api/account/sessions/${session.id}`, { method: 'DELETE' }),
              t('settings.sessions.signedOut', { device: device(session) }),
            );
          }
        }}
      />
    </>
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
