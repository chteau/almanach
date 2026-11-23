import type { ExternalSource } from '@almanach/shared';
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
import { DevBadge } from '../linked/TestData.tsx';
import styles from '../planning/Planning.module.css';

const ERRORS = [
  'external_not_allowed',
  'token_required',
  'feed_unreachable',
  'feed_unauthorized',
  'feed_http',
  'feed_too_large',
  'feed_invalid',
  'feed_failed',
];

/**
 * Settings section of the external document sources of the active company (docs/external-sources.md): name,
 * HTTPS feed address, Bearer token (never shown again) and test environment
 *
 * @returns {JSX.Element | null} - the section, once loaded
 */
export function ExternalSourcesSettings() {
  const { t, locale } = useI18n();
  const { data, reload } = useResource<{ allowed: boolean; secretsKey: boolean; sources: ExternalSource[] }>(
    '/api/settings/external-sources',
  );
  const [editing, setEditing] = useState<ExternalSource | 'new' | null>(null);
  const [removing, setRemoving] = useState<ExternalSource | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string }>();
  if (!data) return null;

  /**
   * Translates a failure code from the server or from the last poll
   *
   * @param code {string} - error code
   * @param problem {unknown} - original failure, for the generic message
   * @returns {string} - message
   */
  const explain = (code: string, problem?: unknown): string =>
    ERRORS.includes(code) ? t(`external.error.${code}` as MessageKey) : describeError(problem, t);

  /**
   * Runs a request, shows its outcome and reloads the list
   *
   * @param request {() => Promise<string | undefined>} - API call returning an optional success message
   * @returns {Promise<boolean>} - true on success
   */
  async function run(request: () => Promise<string | undefined>): Promise<boolean> {
    try {
      const text = await request();
      setMessage(text ? { tone: 'info', text } : undefined);
      return true;
    } catch (problem) {
      const code = problem instanceof ApiError ? String(problem.body.error ?? '') : '';
      setMessage({ tone: 'error', text: explain(code, problem) });
      return false;
    } finally {
      reload();
    }
  }

  const usable = data.allowed && data.secretsKey;
  return (
    <section className={form.section} aria-labelledby="external-title">
      <h2 id="external-title" className={styles.sectionTitle}>
        {t('external.title')}
      </h2>
      <p className={styles.text}>{t('external.body')}</p>
      {!data.allowed && <Notice tone="info">{t('external.notAllowed')}</Notice>}
      {data.allowed && !data.secretsKey && <Notice tone="warn">{t('stripe.noSecretsKey')}</Notice>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {data.sources.length > 0 && (
        <ul className={list.list}>
          {data.sources.map((source) => (
            <li key={source.id} className={list.item}>
              <div className={list.row}>
                <span className={list.primary}>
                  <strong>{source.name}</strong>
                  <span className={list.secondary}>{source.url}</span>
                </span>
                <span className={list.secondary}>
                  {t('external.status', {
                    count: source.documents,
                    date: source.syncedAt
                      ? formatDate(source.syncedAt.slice(0, 10), locale)
                      : t('stripe.never'),
                  })}
                </span>
                <span className={list.badges}>
                  {source.test && <DevBadge />}
                  {source.error && <Badge tone="err">{explain(source.error)}</Badge>}
                </span>
              </div>
              {usable && (
                <div className={form.actions}>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void run(async () => {
                        const result = await api<{ documents: number }>(
                          `/api/settings/external-sources/${source.id}/sync`,
                          { method: 'POST' },
                        );
                        return t('external.synced', { count: result.documents });
                      })
                    }
                  >
                    {t('external.sync')}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(source)}>
                    {t('common.edit')}
                  </Button>
                  <Button variant="ghost" onClick={() => setRemoving(source)}>
                    {t('external.remove')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {usable && editing === null && (
        <div className={form.actions}>
          <Button variant="ghost" onClick={() => setEditing('new')}>
            {t('external.add')}
          </Button>
        </div>
      )}
      {usable && editing !== null && (
        <form
          className={form.form}
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const token = String(values.get('token') ?? '').trim();
            const body = {
              name: String(values.get('name') ?? ''),
              url: String(values.get('url') ?? '').trim(),
              test: values.get('test') === 'on',
              ...(token && { token }),
            };
            void run(async () => {
              if (editing === 'new') {
                const created = await api<{ result: { documents: number } | { error: string } }>(
                  '/api/settings/external-sources',
                  { method: 'POST', body },
                );
                return 'error' in created.result
                  ? explain(created.result.error)
                  : t('external.synced', { count: created.result.documents });
              }
              await api(`/api/settings/external-sources/${editing.id}`, { method: 'PATCH', body });
              return undefined;
            }).then((ok) => ok && setEditing(null));
          }}
        >
          <TextField
            label={t('external.name')}
            name="name"
            required
            maxLength={60}
            placeholder="SEKLYR prod"
            defaultValue={editing === 'new' ? '' : editing.name}
          />
          <TextField
            label={t('external.url')}
            hint={t('external.url.hint')}
            name="url"
            type="url"
            required
            pattern="https://.*"
            defaultValue={editing === 'new' ? '' : editing.url}
          />
          <TextField
            label={t('external.token')}
            hint={editing === 'new' ? t('external.token.hint') : t('external.token.saved')}
            name="token"
            type="password"
            autoComplete="off"
            required={editing === 'new'}
            minLength={16}
          />
          <label className={styles.check}>
            <input type="checkbox" name="test" defaultChecked={editing !== 'new' && editing.test} />
            {t('external.test')}
          </label>
          <p className={styles.caption}>{t('external.test.hint')}</p>
          <div className={form.actions}>
            <Button type="submit">{t('stripe.save')}</Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={t('external.remove.title', { name: removing?.name ?? '' })}
        body={t('external.remove.body')}
        confirmLabel={t('external.remove')}
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const id = removing?.id;
          setRemoving(null);
          void run(async () => {
            await api(`/api/settings/external-sources/${id}`, { method: 'DELETE' });
            return undefined;
          });
        }}
      />
    </section>
  );
}
