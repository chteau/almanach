import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { ActionBar, type ActionFeedback } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { DangerAction, DangerZone } from '../../components/DangerZone/DangerZone.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { ApiError, api } from '../../lib/api.ts';
import { useResource } from '../../lib/useResource.ts';
import text from '../../styles/text.module.css';
import { useMe } from '../auth/AuthProvider.tsx';
import { describeError } from '../install/errors.ts';
import styles from './MailSettings.module.css';
import { useAction } from './useAction.ts';

export const MAIL_PROVIDERS = [
  'gmail',
  'outlook',
  'icloud',
  'yahoo',
  'fastmail',
  'ovh',
  'infomaniak',
  'proton_bridge',
  'proton_token',
  'other',
] as const;

export type MailProvider = (typeof MAIL_PROVIDERS)[number];
type Security = 'tls' | 'starttls';

/** Server and ports of each provider, from its documentation (docs/email.md); "other" is free, on 465 or 587. */
export const MAIL_PRESETS: Record<MailProvider, { host: string; ports: number[] }> = {
  gmail: { host: 'smtp.gmail.com', ports: [465, 587] },
  outlook: { host: 'smtp-mail.outlook.com', ports: [587] },
  icloud: { host: 'smtp.mail.me.com', ports: [587] },
  yahoo: { host: 'smtp.mail.yahoo.com', ports: [465, 587] },
  fastmail: { host: 'smtp.fastmail.com', ports: [465, 587] },
  ovh: { host: 'ssl0.ovh.net', ports: [465, 587] },
  infomaniak: { host: 'mail.infomaniak.com', ports: [465, 587] },
  proton_bridge: { host: '127.0.0.1', ports: [1025] },
  proton_token: { host: 'smtp.protonmail.ch', ports: [587] },
  other: { host: '', ports: [587, 465] },
};

const ERRORS = [
  'auth_failed',
  'connection_failed',
  'timeout',
  'tls_failed',
  'oauth_failed',
  'not_configured',
  'secrets_key_missing',
  'port_not_allowed',
  'outlook_unavailable',
  'failed',
];

const FIELD_ERRORS = ['loopback_required', 'preset_host', 'security_mismatch', 'required', 'invalid_address'];

interface MailStatus {
  source: 'env' | 'db' | 'none';
  envHost: string | null;
  outlookAvailable: boolean;
  secretsKey: boolean;
  config: null | {
    provider: MailProvider;
    host: string;
    port: number;
    security: Security;
    username: string;
    from: string;
    hasPassword: boolean;
    oauthConnected: boolean;
  };
}

interface Values {
  provider: MailProvider;
  host: string;
  port: number;
  username: string;
  from: string;
  password: string;
}

/**
 * Security that goes with a port: implicit TLS on 465, STARTTLS otherwise (587, Proton Mail Bridge)
 *
 * @param port {number} - SMTP port
 * @returns {Security} - the security mode
 */
export function securityFor(port: number): Security {
  return port === 465 ? 'tls' : 'starttls';
}

/**
 * Values of the form after choosing a provider: its server and first port, the rest kept
 *
 * @param values {Values} - current values
 * @param provider {MailProvider} - chosen provider
 * @returns {Values} - prefilled values
 */
export function applyPreset(values: Values, provider: MailProvider): Values {
  const preset = MAIL_PRESETS[provider];
  return {
    ...values,
    provider,
    host: provider === 'other' ? (values.provider === 'other' ? values.host : '') : preset.host,
    port: preset.ports[0] ?? 587,
  };
}

/**
 * Settings panel "Sending e-mails": the server's own SMTP settings when present, otherwise a
 * provider chosen here, with a test message (docs/email.md)
 *
 * @returns {JSX.Element} - the sections
 */
export function MailSettings() {
  const { t } = useI18n();
  const me = useMe();
  const { data, error, reload } = useResource<MailStatus>('/api/settings/mail');
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  const admin = me.role === 'admin';

  return (
    <>
      <SettingsSection
        title={t('settings.mail.status')}
        description={t('settings.mail.body')}
        badge={
          <Badge tone={data.source === 'none' ? 'warn' : 'ok'}>
            {data.source === 'none' ? t('settings.mail.off') : t('settings.mail.on')}
          </Badge>
        }
      >
        {data.source === 'env' && (
          <Notice tone="info">{t('settings.mail.env', { host: data.envHost ?? '' })}</Notice>
        )}
        {data.source === 'db' && data.config && (
          <p className={text.text}>
            {t('settings.mail.db', {
              provider: t(`settings.mail.provider.${data.config.provider}` as MessageKey),
              from: data.config.from,
            })}
          </p>
        )}
        {data.source === 'none' && <p className={text.text}>{t('settings.mail.none')}</p>}
        {!admin && <p className={text.caption}>{t('settings.mail.adminOnly')}</p>}
      </SettingsSection>
      {admin && <MailForm status={data} onChange={reload} />}
    </>
  );
}

/**
 * Explains a failure of the mail routes in plain words
 *
 * @param problem {unknown} - failure
 * @param t {(key: MessageKey, params?: Record<string, string | number>) => string} - translator
 * @returns {string} - message
 */
function explainMail(
  problem: unknown,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
) {
  const code = problem instanceof ApiError ? problem.body.error : '';
  if (code === 'validation') return t('settings.form.invalid');
  if (!ERRORS.includes(code)) return describeError(problem, t);
  const detail = problem instanceof ApiError ? (problem.body as { detail?: string }).detail : undefined;
  const message = t(`settings.mail.error.${code}` as MessageKey);
  return detail ? `${message} ${t('settings.mail.detail', { detail })}` : message;
}

/**
 * Administrator form: provider, account, server, test and removal
 *
 * @param props {{ status: MailStatus; onChange: () => void }} - stored state, refresh callback
 * @returns {JSX.Element} - the sections
 */
function MailForm({ status, onChange }: { status: MailStatus; onChange: () => void }) {
  const { t } = useI18n();
  const config = status.config;
  const [saved, setSaved] = useState<Values>(() => ({
    provider: config?.provider ?? 'gmail',
    host: config?.host ?? MAIL_PRESETS.gmail.host,
    port: config?.port ?? 465,
    username: config?.username ?? '',
    from: config?.from ?? '',
    password: '',
  }));
  const [values, setValues] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const explain = (problem: unknown) => explainMail(problem, t);
  const save = useAction(explain);
  const test = useAction(explain);
  const remove = useAction(explain);
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const preset = MAIL_PRESETS[values.provider];
  const outlook = values.provider === 'outlook';
  const disabled = !status.secretsKey;

  /**
   * Updates some fields
   *
   * @param patch {Partial<Values>} - changed fields
   * @returns {void} - nothing
   */
  const set = (patch: Partial<Values>): void => setValues({ ...values, ...patch });

  /**
   * Saves the configuration; field errors from the server are shown under their field
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    setErrors({});
    await save.run(async () => {
      try {
        await api('/api/settings/mail', {
          method: 'PUT',
          body: {
            provider: values.provider,
            host: values.host.trim(),
            port: values.port,
            security: securityFor(values.port),
            username: values.username.trim(),
            from: values.from.trim() || values.username.trim(),
            ...(values.password ? { password: values.password } : {}),
          },
        });
      } catch (problem) {
        if (problem instanceof ApiError && problem.body.issues) {
          setErrors(
            Object.fromEntries(
              problem.body.issues.map((issue) => [
                issue.path,
                t(
                  (FIELD_ERRORS.includes(issue.message)
                    ? `settings.mail.field.${issue.message}`
                    : 'errors.invalid') as MessageKey,
                ),
              ]),
            ),
          );
          throw new ApiError(422, { error: 'validation' });
        }
        throw problem;
      }
      setSaved({ ...values, password: '' });
      setValues({ ...values, password: '' });
      onChange();
      return t('settings.mail.saved');
    });
  }

  /**
   * Sends a test message to the administrator's own address
   *
   * @returns {Promise<void>} - resolves when done
   */
  async function sendTest(): Promise<void> {
    await test.run(async () => {
      const result = await api<{ to: string }>('/api/settings/mail/test', { method: 'POST', body: {} });
      return t('settings.mail.test.sent', { to: result.to });
    });
  }

  const configured = config !== null && (config.provider !== 'outlook' || config.oauthConnected);

  return (
    <>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <SettingsSection
          title={t('settings.mail.account')}
          description={
            status.source === 'env' ? t('settings.mail.account.env') : t('settings.mail.account.body')
          }
          footer={
            !outlook && (
              <ActionBar
                primaryLabel={t('common.save')}
                busy={save.busy}
                dirty={dirty}
                disabled={disabled}
                feedback={test.feedback ?? save.feedback}
              >
                {configured && (
                  <Button variant="ghost" busy={test.busy} disabled={dirty} onClick={() => void sendTest()}>
                    {t('settings.mail.test')}
                  </Button>
                )}
              </ActionBar>
            )
          }
        >
          {disabled && <Notice tone="warn">{t('settings.mail.noSecretsKey')}</Notice>}
          <SelectField
            label={t('settings.mail.provider')}
            value={values.provider}
            disabled={disabled}
            onChange={(event) => setValues(applyPreset(values, event.target.value as MailProvider))}
          >
            {MAIL_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {t(`settings.mail.provider.${provider}` as MessageKey)}
              </option>
            ))}
          </SelectField>
          <ProviderHelp provider={values.provider} outlookAvailable={status.outlookAvailable} />
          <div className={form.grid}>
            <TextField
              label={t('settings.mail.username')}
              type={values.provider === 'other' || values.provider === 'proton_bridge' ? 'text' : 'email'}
              autoComplete="off"
              spellCheck={false}
              value={values.username}
              disabled={disabled}
              onChange={(event) => set({ username: event.target.value })}
              error={errors.username}
            />
            <TextField
              label={`${t('settings.mail.from')} ${t('common.optional')}`}
              hint={t('settings.mail.from.hint')}
              spellCheck={false}
              value={values.from}
              disabled={disabled}
              placeholder={values.username}
              onChange={(event) => set({ from: event.target.value })}
              error={errors.from}
            />
          </div>
          {!outlook && (
            <>
              <TextField
                label={t(
                  values.provider === 'gmail' || values.provider === 'icloud' || values.provider === 'yahoo'
                    ? 'settings.mail.appPassword'
                    : values.provider === 'proton_token'
                      ? 'settings.mail.smtpToken'
                      : 'settings.mail.password',
                )}
                hint={
                  config?.hasPassword ? t('settings.mail.password.saved') : t('settings.mail.password.hint')
                }
                type="password"
                autoComplete="new-password"
                value={values.password}
                disabled={disabled}
                placeholder={config?.hasPassword ? '••••••••' : undefined}
                onChange={(event) => set({ password: event.target.value })}
                error={errors.password}
              />
              <div className={form.grid}>
                <TextField
                  label={t('settings.mail.host')}
                  value={values.host}
                  spellCheck={false}
                  readOnly={values.provider !== 'other' && values.provider !== 'proton_bridge'}
                  disabled={disabled}
                  onChange={(event) => set({ host: event.target.value })}
                  error={errors.host}
                />
                {values.provider === 'proton_bridge' ? (
                  <TextField
                    label={t('settings.mail.port')}
                    inputMode="numeric"
                    value={String(values.port)}
                    disabled={disabled}
                    onChange={(event) => set({ port: Number(event.target.value.replace(/\D/g, '')) || 0 })}
                    error={errors.port}
                  />
                ) : (
                  <SelectField
                    label={t('settings.mail.port')}
                    value={String(values.port)}
                    disabled={disabled || preset.ports.length === 1}
                    onChange={(event) => set({ port: Number(event.target.value) })}
                    error={errors.port ?? errors.security}
                  >
                    {preset.ports.map((port) => (
                      <option key={port} value={port}>
                        {t(`settings.mail.port.${port === 465 ? 'tls' : 'starttls'}`, { port })}
                      </option>
                    ))}
                  </SelectField>
                )}
              </div>
              <p className={text.caption}>{t('settings.mail.port.hint')}</p>
            </>
          )}
        </SettingsSection>
      </form>
      {outlook && status.outlookAvailable && (
        <OutlookConnect
          values={values}
          connected={config?.provider === 'outlook' && config.oauthConnected}
          disabled={disabled || !values.username.trim()}
          onConnected={() => {
            setSaved(values);
            onChange();
          }}
          testButton={
            configured && config?.provider === 'outlook' ? (
              <Button variant="ghost" busy={test.busy} onClick={() => void sendTest()}>
                {t('settings.mail.test')}
              </Button>
            ) : null
          }
          testFeedback={test.feedback}
        />
      )}
      {config && (
        <DangerZone>
          {remove.feedback?.tone === 'error' && (
            <li>
              <Notice tone="error" live>
                {remove.feedback.text}
              </Notice>
            </li>
          )}
          <DangerAction
            label={t('settings.mail.remove')}
            consequence={
              status.source === 'env' ? t('settings.mail.remove.env') : t('settings.mail.remove.consequence')
            }
            actionLabel={t('settings.remove')}
            busy={remove.busy}
            onConfirm={() =>
              void remove
                .run(async () => {
                  await api('/api/settings/mail', { method: 'DELETE' });
                })
                .then((done) => done && onChange())
            }
          />
        </DangerZone>
      )}
    </>
  );
}

/**
 * Provider-specific instructions: app passwords, Proton Mail Bridge, Outlook registration
 *
 * @param props {{ provider: MailProvider; outlookAvailable: boolean }} - chosen provider, whether Outlook sign-in is set up
 * @returns {JSX.Element | null} - the help, if any
 */
export function ProviderHelp({
  provider,
  outlookAvailable,
}: {
  provider: MailProvider;
  outlookAvailable: boolean;
}) {
  const { t } = useI18n();
  if (provider === 'gmail') {
    return (
      <Notice tone="info">
        {t('settings.mail.help.gmail')}{' '}
        <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
          myaccount.google.com/apppasswords
        </a>
      </Notice>
    );
  }
  if (provider === 'icloud') {
    return (
      <Notice tone="info">
        {t('settings.mail.help.icloud')}{' '}
        <a href="https://account.apple.com" target="_blank" rel="noreferrer">
          account.apple.com
        </a>
      </Notice>
    );
  }
  if (provider === 'outlook' && !outlookAvailable) {
    return (
      <Notice tone="warn">
        <p className={text.text}>{t('settings.mail.help.outlookSetup')}</p>
        <ol className={styles.steps}>
          <li>{t('settings.mail.help.outlookStep1')}</li>
          <li>{t('settings.mail.help.outlookStep2')}</li>
          <li>{t('settings.mail.help.outlookStep3')}</li>
          <li>{t('settings.mail.help.outlookStep4')}</li>
        </ol>
      </Notice>
    );
  }
  const key = {
    outlook: 'settings.mail.help.outlook',
    yahoo: 'settings.mail.help.yahoo',
    proton_bridge: 'settings.mail.help.protonBridge',
    proton_token: 'settings.mail.help.protonToken',
  }[provider as string];
  return key ? <Notice tone="info">{t(key as MessageKey)}</Notice> : null;
}

/**
 * Outlook / Hotmail sign-in with a Microsoft code (device code flow): shows the code and the address to
 * open, then waits for the person to approve
 *
 * @param props {{ values: Values; connected: boolean; disabled: boolean; onConnected: () => void; testButton: JSX.Element | null; testFeedback: ActionFeedback | null | undefined }} - form values, state, callbacks
 * @returns {JSX.Element} - the section
 */
function OutlookConnect({
  values,
  connected,
  disabled,
  onConnected,
  testButton,
  testFeedback,
}: {
  values: Values;
  connected: boolean;
  disabled: boolean;
  onConnected: () => void;
  testButton: ReactNode;
  testFeedback: ActionFeedback | null | undefined;
}) {
  const { t } = useI18n();
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string; interval: number }>();
  const action = useAction((problem) => explainMail(problem, t));
  const connectedRef = useRef(onConnected);
  connectedRef.current = onConnected;
  const { setFeedback } = action;

  useEffect(() => {
    if (!device) return;
    let stopped = false;
    const timer = setInterval(() => {
      void api<{ status: 'pending' | 'connected' | 'declined' | 'expired' }>(
        '/api/settings/mail/outlook/poll',
        {
          method: 'POST',
        },
      )
        .then(({ status }) => {
          if (stopped || status === 'pending') return;
          setDevice(undefined);
          if (status === 'connected') {
            setFeedback({ tone: 'success', text: t('settings.mail.outlook.connected') });
            connectedRef.current();
          } else {
            setFeedback({ tone: 'error', text: t(`settings.mail.outlook.${status}`) });
          }
        })
        .catch((problem: unknown) => {
          if (stopped) return;
          setDevice(undefined);
          setFeedback({ tone: 'error', text: explainMail(problem, t) });
        });
    }, Math.max(device.interval, 2) * 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [device, t, setFeedback]);

  /**
   * Asks Microsoft for a sign-in code
   *
   * @returns {Promise<void>} - resolves when the code is shown
   */
  async function start(): Promise<void> {
    await action.run(async () => {
      setDevice(
        await api('/api/settings/mail/outlook/start', {
          method: 'POST',
          body: { username: values.username.trim(), from: values.from.trim() || values.username.trim() },
        }),
      );
      return t('settings.mail.outlook.waiting');
    });
  }

  return (
    <SettingsSection
      title={t('settings.mail.outlook.title')}
      badge={connected && <Badge tone="ok">{t('settings.mail.outlook.badge')}</Badge>}
      description={connected ? t('settings.mail.outlook.connectedBody') : t('settings.mail.outlook.body')}
      footer={
        <ActionBar
          primaryLabel={connected ? t('settings.mail.outlook.reconnect') : t('settings.mail.outlook.connect')}
          busy={action.busy}
          disabled={disabled || device !== undefined}
          feedback={testFeedback ?? action.feedback}
          onPrimary={() => void start()}
        >
          {testButton}
        </ActionBar>
      }
    >
      {device && (
        <div className={styles.device}>
          <p className={text.text}>{t('settings.mail.outlook.step')}</p>
          <a href={device.verificationUri} target="_blank" rel="noreferrer" className={text.wrap}>
            {device.verificationUri}
          </a>
          <span className={text.caption}>{t('settings.mail.outlook.code')}</span>
          <code className={styles.code}>{device.userCode}</code>
          <Button variant="subtle" onClick={() => setDevice(undefined)}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
