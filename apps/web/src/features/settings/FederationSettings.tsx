import type { FederationLink } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { ButtonLink } from '../../components/Button/ButtonLink.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import { Field } from '../../components/Field/Field.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { Row } from '../../components/Row/Row.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { ApiError, api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import text from '../../styles/text.module.css';
import { statusLabel, useActivities } from '../activities/useActivities.ts';
import { describeError } from '../install/errors.ts';
import local from './FederationSettings.module.css';
import { useAction } from './useAction.ts';

const ERRORS = [
  'federation_not_allowed',
  'federation_off',
  'secrets_key_missing',
  'invalid_url',
  'invalid_code',
  'code_unknown',
  'code_expired',
  'peer_unreachable',
  'peer_refused',
  'peer_failed',
  'peer_bad_signature',
  'peer_invalid',
  'peer_too_large',
  'currency_mismatch',
];

interface FederationStatus {
  allowed: boolean;
  secretsKey: boolean;
  enabled: boolean;
  label: string;
  publicUrl: string;
  intervalMinutes: number;
  links: FederationLink[];
}

/**
 * Groups a key fingerprint by four characters, for a visual comparison
 *
 * @param value {string | null} - fingerprint
 * @returns {string} - grouped fingerprint, or a dash
 */
const grouped = (value: string | null): string => value?.match(/.{1,4}/g)?.join(' ') ?? '—';

/**
 * Settings panel "Linked instances" of the active company: switch, pairing, and each link with its
 * fingerprints, options, last sync and revocation
 *
 * @returns {JSX.Element} - the sections
 */
export function FederationSettings() {
  const { t, locale } = useI18n();
  const { data, error, reload } = useResource<FederationStatus>('/api/settings/federation');
  const activities = useActivities();
  const [issued, setIssued] = useState<{ code: string; expiresAt: string; fingerprint: string }>();
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'issue' | 'join'>('issue');
  const [revoking, setRevoking] = useState<string>();
  const [enabled, setEnabled] = useState<boolean>();
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string }>();
  /**
   * Translates a failure code from the server or from the last exchange
   *
   * @param problem {unknown} - failure, or an error code
   * @returns {string} - message
   */
  const explain = (problem: unknown): string => {
    const code = problem instanceof ApiError ? String(problem.body.error ?? '') : String(problem ?? '');
    return ERRORS.includes(code) ? t(`federation.error.${code}` as MessageKey) : describeError(problem, t);
  };
  const save = useAction(explain);
  const pair = useAction(explain);
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={3} />;

  /**
   * Runs a change on a link and shows its outcome above the list
   *
   * @param request {() => Promise<string | undefined>} - API call returning an optional success message
   * @returns {Promise<void>} - resolves once handled
   */
  async function run(request: () => Promise<string | undefined>): Promise<void> {
    try {
      const text = await request();
      setResult(text ? { tone: 'success', text } : undefined);
    } catch (problem) {
      setResult({ tone: 'error', text: explain(problem) });
    }
    reload();
    activities.reload();
  }

  /**
   * Reads a checkbox of a submitted form
   *
   * @param target {HTMLFormElement} - form
   * @param name {string} - checkbox name
   * @returns {boolean} - whether it is checked
   */
  const checked = (target: HTMLFormElement, name: string) =>
    (target.elements.namedItem(name) as HTMLInputElement).checked;
  const date = (value: string | null) =>
    value ? formatDate(value.slice(0, 10), locale) : t('federation.never');
  const time = (value: string) =>
    new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const ready = data.allowed && data.enabled && data.secretsKey;
  const statuses = activities.data?.statuses ?? [];
  const activityName = (status: string) => statusLabel(statuses, status, locale);
  const on = enabled ?? data.enabled;

  /**
   * Submits a pairing form: issue a code, or join with the other instance's code
   *
   * @param event {SyntheticEvent<HTMLFormElement>} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submitPairing(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const target = event.currentTarget;
    const body = {
      url: (target.elements.namedItem('url') as HTMLInputElement).value,
      share: checked(target, 'share'),
      receive: checked(target, 'receive'),
    };
    await pair.run(async () => {
      if (mode === 'issue') {
        setIssued(await api('/api/settings/federation/links', { method: 'POST', body }));
        return;
      }
      await api('/api/settings/federation/links/join', { method: 'POST', body: { ...body, code } });
      setCode('');
      return t('federation.paired');
    });
    reload();
    activities.reload();
  }

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save
            .run(async () => {
              await api('/api/settings/federation', {
                method: 'PUT',
                body: { enabled: on, label: data.label },
              });
              setEnabled(undefined);
            })
            .then(reload);
        }}
        noValidate
      >
        <SettingsSection
          title={t('federation.title')}
          description={t('federation.body')}
          badge={
            data.allowed && (
              <Badge tone={data.enabled ? 'ok' : undefined}>
                {data.enabled ? t('settings.on') : t('settings.off')}
              </Badge>
            )
          }
          footer={
            data.allowed && (
              <ActionBar
                primaryLabel={t('federation.save')}
                busy={save.busy}
                dirty={on !== data.enabled}
                feedback={save.feedback}
              />
            )
          }
        >
          {!data.allowed && <Notice tone="info">{t('federation.notAllowed')}</Notice>}
          {data.allowed && !data.secretsKey && <Notice tone="warn">{t('federation.noSecretsKey')}</Notice>}
          {data.allowed && (
            <>
              <Field label={t('federation.enabled')} checkbox>
                {(control) => (
                  <input
                    {...control}
                    type="checkbox"
                    checked={on}
                    onChange={(event) => setEnabled(event.target.checked)}
                  />
                )}
              </Field>
              <p className={text.caption}>
                {t('settings.federation.label', { label: data.label })}{' '}
                <ButtonLink to="/settings/companies" variant="subtle">
                  {t('common.edit')}
                </ButtonLink>
              </p>
            </>
          )}
        </SettingsSection>
      </form>

      {data.links.length > 0 && (
        <SettingsSection title={t('federation.links')}>
          {result && (
            <Notice tone={result.tone} live>
              {result.text}
            </Notice>
          )}
          <ul className={list.list}>
            {data.links.map((link) => (
              <li key={link.id} className={`${list.item} ${local.link}`}>
                <Row
                  primary={
                    <span className={local.name}>
                      <strong>{link.peerLabel ?? link.peerUrl ?? t('federation.waiting')}</strong>
                      <Badge tone={link.state === 'active' ? 'ok' : 'warn'}>
                        {t(`federation.state.${link.state}`)}
                      </Badge>
                    </span>
                  }
                  meta={link.peerUrl ?? undefined}
                  actions={
                    <>
                      {link.state === 'active' && ready && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            void run(async () => {
                              await api(`/api/settings/federation/links/${link.id}/sync`, { method: 'POST' });
                              return t('federation.synced');
                            })
                          }
                        >
                          {t('federation.sync')}
                        </Button>
                      )}
                      <Button variant="danger" aria-haspopup="dialog" onClick={() => setRevoking(link.id)}>
                        {t('federation.revoke')}
                      </Button>
                    </>
                  }
                />
                <div className={local.body}>
                  {link.state === 'pending' && link.codeExpiresAt && (
                    <p className={text.caption}>
                      {t('federation.expires', { time: time(link.codeExpiresAt) })}
                    </p>
                  )}
                  {link.state === 'imported' && <Notice tone="info">{t('federation.imported')}</Notice>}
                  {link.state === 'active' && (
                    <>
                      <p className={text.caption}>
                        {t('federation.syncedAt', {
                          synced: date(link.syncedAt),
                          received: date(link.receivedAt),
                        })}
                      </p>
                      {link.error && <Notice tone="warn">{explain(link.error)}</Notice>}
                      <div className={local.options}>
                        {(['share', 'receive', 'pulls', 'shareDetail', 'receiveDetail'] as const).map(
                          (option) => (
                            <Field
                              key={option}
                              label={t(`federation.${option}`, { minutes: data.intervalMinutes })}
                              checkbox
                            >
                              {(control) => (
                                <input
                                  {...control}
                                  type="checkbox"
                                  checked={link[option]}
                                  disabled={!ready}
                                  onChange={(event) =>
                                    void run(async () => {
                                      await api(`/api/settings/federation/links/${link.id}`, {
                                        method: 'PATCH',
                                        body: {
                                          share: link.share,
                                          receive: link.receive,
                                          pulls: link.pulls,
                                          shareDetail: link.shareDetail,
                                          receiveDetail: link.receiveDetail,
                                          [option]: event.target.checked,
                                        },
                                      });
                                      return t('settings.federation.optionSaved');
                                    })
                                  }
                                />
                              )}
                            </Field>
                          ),
                        )}
                        <p className={text.caption}>{t('federation.detail.hint')}</p>
                      </div>
                      {activities.data && activities.data.activities.length > 0 && (
                        <SelectField
                          label={t('federation.activity')}
                          hint={t('federation.activity.hint')}
                          value={link.activityAuto ? 'auto' : (link.activity ?? 'none')}
                          disabled={!ready}
                          onChange={(event) =>
                            void run(async () => {
                              await api(`/api/settings/federation/links/${link.id}/activity`, {
                                method: 'PUT',
                                body: { activity: event.target.value },
                              });
                              return t('settings.federation.optionSaved');
                            })
                          }
                        >
                          <option value="auto">
                            {link.peerActivity
                              ? t('federation.activity.auto', { activity: activityName(link.peerActivity) })
                              : t('federation.activity.autoUnknown')}
                          </option>
                          {activities.data.activities.map((activity) => (
                            <option key={activity.id ?? 'main'} value={activity.id ?? 'main'}>
                              {activity.main
                                ? t('activities.mainOption', { activity: activityName(activity.status) })
                                : activityName(activity.status)}
                            </option>
                          ))}
                          <option value="none">{t('federation.activity.none')}</option>
                        </SelectField>
                      )}
                      {activities.data?.activities
                        .filter((activity) => activity.linkId === link.id)
                        .map((activity) => (
                          <Notice key={activity.id} tone="info">
                            {t('federation.activity.created', {
                              activity: activityName(activity.status),
                              label: link.peerLabel ?? '',
                            })}
                          </Notice>
                        ))}
                      <details className={text.details}>
                        <summary>{t('federation.fingerprints.title')}</summary>
                        <p className={text.wrap}>
                          {t('federation.fingerprints', {
                            own: grouped(link.fingerprint),
                            peer: grouped(link.peerFingerprint),
                          })}
                        </p>
                      </details>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}

      {ready && (
        <form onSubmit={(event) => void submitPairing(event)} noValidate>
          <SettingsSection
            title={t('federation.issue')}
            description={t('federation.issue.hint')}
            footer={
              !(mode === 'issue' && issued) && (
                <ActionBar
                  primaryLabel={mode === 'issue' ? t('federation.issue.submit') : t('federation.join.submit')}
                  busy={pair.busy}
                  disabled={mode === 'join' && !code}
                  feedback={pair.feedback}
                />
              )
            }
          >
            <div className={local.modes} role="radiogroup" aria-label={t('federation.issue')}>
              {(['issue', 'join'] as const).map((value) => (
                <label key={value} className={local.mode}>
                  <input
                    type="radio"
                    name="federation-mode"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  <span>
                    <strong>{t(`federation.mode.${value}`)}</strong>
                    <span className={text.caption}>{t(`federation.mode.${value}.hint`)}</span>
                  </span>
                </label>
              ))}
            </div>
            {mode === 'issue' && issued ? (
              <Notice tone="success" live>
                {t('federation.code', {
                  time: time(issued.expiresAt),
                  fingerprint: grouped(issued.fingerprint),
                })}
                <code className={`${text.codes} ${text.wrap}`}>{issued.code}</code>
              </Notice>
            ) : (
              <>
                {mode === 'join' && (
                  <TextField
                    label={t('federation.code.field')}
                    value={code}
                    autoComplete="off"
                    spellCheck={false}
                    required
                    onChange={(event) => setCode(event.target.value.trim())}
                  />
                )}
                <TextField
                  key={mode}
                  name="url"
                  type="url"
                  label={t('federation.ownUrl')}
                  hint={t('federation.ownUrl.hint')}
                  defaultValue={data.publicUrl}
                  required
                />
                <ShareChoices />
              </>
            )}
          </SettingsSection>
        </form>
      )}
      <ConfirmDialog
        open={revoking !== undefined}
        title={t('federation.revoke.title')}
        body={t('federation.revoke.body')}
        confirmLabel={t('federation.revoke')}
        danger
        onCancel={() => setRevoking(undefined)}
        onConfirm={() => {
          const id = revoking;
          setRevoking(undefined);
          void run(async () => {
            await api(`/api/settings/federation/links/${id}`, { method: 'DELETE' });
            setIssued(undefined);
            return t('settings.federation.revoked');
          });
        }}
      />
    </>
  );
}

/**
 * Share and receive checkboxes of a new link, both on by default
 *
 * @returns {JSX.Element} - the two checkboxes
 */
function ShareChoices() {
  const { t } = useI18n();
  return (
    <>
      <Field label={t('federation.share')} checkbox>
        {(control) => <input {...control} type="checkbox" name="share" defaultChecked />}
      </Field>
      <Field label={t('federation.receive')} checkbox>
        {(control) => <input {...control} type="checkbox" name="receive" defaultChecked />}
      </Field>
    </>
  );
}
