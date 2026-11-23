import type { FederationLink } from '@almanach/shared';
import { useState } from 'react';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import list from '../../components/RowList/RowList.module.css';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { ApiError, api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';
import styles from '../planning/Planning.module.css';

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
 * Settings section "Linked instances" of the active company: switch, activity label, pairing, and each link
 * with its fingerprints, options, last sync and revocation
 *
 * @returns {JSX.Element | null} - the section, once loaded
 */
export function FederationSettings() {
  const { t, locale } = useI18n();
  const { data, reload } = useResource<FederationStatus>('/api/settings/federation');
  const [issued, setIssued] = useState<{ code: string; expiresAt: string; fingerprint: string }>();
  const [code, setCode] = useState('');
  const [revoking, setRevoking] = useState<string>();
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string }>();
  if (!data) return null;

  /**
   * Translates a failure code from the server or from the last exchange
   *
   * @param error {string} - error code
   * @param problem {unknown} - original failure, for the generic message
   * @returns {string} - message
   */
  const explain = (error: string, problem?: unknown): string =>
    ERRORS.includes(error) ? t(`federation.error.${error}` as MessageKey) : describeError(problem, t);

  /**
   * Runs a request and reloads the status
   *
   * @param request {() => Promise<string | undefined>} - API call returning an optional success message
   * @returns {Promise<void>} - resolves once handled
   */
  async function run(request: () => Promise<string | undefined>): Promise<void> {
    try {
      const text = await request();
      setMessage(text ? { tone: 'info', text } : undefined);
    } catch (problem) {
      const error = problem instanceof ApiError ? String(problem.body.error ?? '') : '';
      setMessage({ tone: 'error', text: explain(error, problem) });
    }
    reload();
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

  return (
    <section className={form.section} aria-labelledby="federation-title">
      <h2 id="federation-title" className={styles.sectionTitle}>
        {t('federation.title')}
      </h2>
      <p className={styles.text}>{t('federation.body')}</p>
      {!data.allowed && <Notice tone="info">{t('federation.notAllowed')}</Notice>}
      {data.allowed && !data.secretsKey && <Notice tone="warn">{t('federation.noSecretsKey')}</Notice>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {data.allowed && (
        <form
          className={form.form}
          onSubmit={(event) => {
            event.preventDefault();
            const target = event.currentTarget;
            const label = (target.elements.namedItem('label') as HTMLInputElement).value;
            void run(async () => {
              await api('/api/settings/federation', {
                method: 'PUT',
                body: { enabled: checked(target, 'enabled'), label },
              });
              return undefined;
            });
          }}
        >
          <TextField
            name="label"
            label={t('federation.label')}
            hint={t('federation.label.hint')}
            defaultValue={data.label}
            maxLength={60}
            required
          />
          <label className={styles.check}>
            <input type="checkbox" name="enabled" defaultChecked={data.enabled} key={String(data.enabled)} />
            {t('federation.enabled')}
          </label>
          <div className={form.actions}>
            <Button type="submit">{t('federation.save')}</Button>
          </div>
        </form>
      )}

      {data.links.length > 0 && (
        <ul className={list.list}>
          {data.links.map((link) => (
            <li key={link.id} className={list.item}>
              <p className={styles.text}>
                <strong>{link.peerLabel ?? link.peerUrl ?? t('federation.waiting')}</strong>{' '}
                <Badge tone={link.state === 'active' ? 'ok' : 'warn'}>
                  {t(`federation.state.${link.state}`)}
                </Badge>
              </p>
              {link.peerUrl && <p className={`${styles.caption} ${styles.wrap}`}>{link.peerUrl}</p>}
              {link.state === 'pending' && link.codeExpiresAt && (
                <p className={styles.caption}>
                  {t('federation.expires', { time: time(link.codeExpiresAt) })}
                </p>
              )}
              {link.state === 'imported' && <Notice tone="info">{t('federation.imported')}</Notice>}
              {link.state === 'active' && (
                <>
                  <p className={`${styles.caption} ${styles.wrap}`}>
                    {t('federation.fingerprints', {
                      own: grouped(link.fingerprint),
                      peer: grouped(link.peerFingerprint),
                    })}
                  </p>
                  <p className={styles.caption}>
                    {t('federation.syncedAt', {
                      synced: date(link.syncedAt),
                      received: date(link.receivedAt),
                    })}
                  </p>
                  {link.error && <Notice tone="warn">{explain(link.error)}</Notice>}
                  {(['share', 'receive', 'pulls'] as const).map((option) => (
                    <label key={option} className={styles.check}>
                      <input
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
                                [option]: event.target.checked,
                              },
                            });
                            return undefined;
                          })
                        }
                      />
                      {t(`federation.${option}`)}
                    </label>
                  ))}
                </>
              )}
              <div className={form.actions}>
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
                <Button variant="ghost" onClick={() => setRevoking(link.id)}>
                  {t('federation.revoke')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {ready && (
        <>
          <h3 className={styles.subTitle}>{t('federation.issue')}</h3>
          <p className={styles.caption}>{t('federation.issue.hint')}</p>
          {issued ? (
            <Notice tone="info">
              {t('federation.code', {
                time: time(issued.expiresAt),
                fingerprint: grouped(issued.fingerprint),
              })}
              <code className={`${styles.codes} ${styles.wrap}`}>{issued.code}</code>
            </Notice>
          ) : (
            <form
              className={form.form}
              onSubmit={(event) => {
                event.preventDefault();
                const target = event.currentTarget;
                void run(async () => {
                  setIssued(
                    await api('/api/settings/federation/links', {
                      method: 'POST',
                      body: {
                        url: (target.elements.namedItem('url') as HTMLInputElement).value,
                        share: checked(target, 'share'),
                        receive: checked(target, 'receive'),
                      },
                    }),
                  );
                  return undefined;
                });
              }}
            >
              <TextField
                name="url"
                type="url"
                label={t('federation.ownUrl')}
                hint={t('federation.ownUrl.hint')}
                defaultValue={data.publicUrl}
                required
              />
              <ShareChoices />
              <div className={form.actions}>
                <Button type="submit">{t('federation.issue.submit')}</Button>
              </div>
            </form>
          )}

          <h3 className={styles.subTitle}>{t('federation.join')}</h3>
          <form
            className={form.form}
            onSubmit={(event) => {
              event.preventDefault();
              const target = event.currentTarget;
              void run(async () => {
                await api('/api/settings/federation/links/join', {
                  method: 'POST',
                  body: {
                    code,
                    url: (target.elements.namedItem('url') as HTMLInputElement).value,
                    share: checked(target, 'share'),
                    receive: checked(target, 'receive'),
                  },
                });
                setCode('');
                return t('federation.paired');
              });
            }}
          >
            <TextField
              label={t('federation.code.field')}
              value={code}
              autoComplete="off"
              spellCheck={false}
              required
              onChange={(event) => setCode(event.target.value.trim())}
            />
            <TextField
              name="url"
              type="url"
              label={t('federation.ownUrl')}
              hint={t('federation.ownUrl.hint')}
              defaultValue={data.publicUrl}
              required
            />
            <ShareChoices />
            <div className={form.actions}>
              <Button type="submit">{t('federation.join.submit')}</Button>
            </div>
          </form>
        </>
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
            return undefined;
          });
        }}
      />
    </section>
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
      <label className={styles.check}>
        <input type="checkbox" name="share" defaultChecked />
        {t('federation.share')}
      </label>
      <label className={styles.check}>
        <input type="checkbox" name="receive" defaultChecked />
        {t('federation.receive')}
      </label>
    </>
  );
}
