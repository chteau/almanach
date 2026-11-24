import type { ExternalSource } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import { Field } from '../../components/Field/Field.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { Row } from '../../components/Row/Row.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { ApiError, api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import text from '../../styles/text.module.css';
import { describeError } from '../install/errors.ts';
import { DevBadge } from '../linked/TestData.tsx';
import { countKey } from './StripeSettings.tsx';
import { useAction } from './useAction.ts';

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
 * External document sources of the active company (docs/external-sources.md): name, HTTPS feed
 * address, access token (never shown again) and test environment
 *
 * @returns {JSX.Element} - the sections
 */
export function ExternalSourcesSettings() {
  const { t, locale } = useI18n();
  const { data, error, reload } = useResource<{
    allowed: boolean;
    secretsKey: boolean;
    sources: ExternalSource[];
  }>('/api/settings/external-sources');
  const [editing, setEditing] = useState<ExternalSource | 'new' | null>(null);
  const [removing, setRemoving] = useState<ExternalSource | null>(null);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string }>();
  /**
   * Translates a failure code from the server or from the last poll
   *
   * @param problem {unknown} - failure, or an error code
   * @returns {string} - message
   */
  const explain = (problem: unknown): string => {
    const code = problem instanceof ApiError ? String(problem.body.error ?? '') : String(problem ?? '');
    return ERRORS.includes(code) ? t(`external.error.${code}` as MessageKey) : describeError(problem, t);
  };
  const save = useAction(explain);
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={3} />;

  /**
   * Runs a call on a listed source and shows its outcome above the list
   *
   * @param request {() => Promise<string>} - API call returning a success message
   * @returns {Promise<void>} - resolves when done
   */
  async function run(request: () => Promise<string>): Promise<void> {
    try {
      setResult({ tone: 'success', text: await request() });
    } catch (problem) {
      setResult({ tone: 'error', text: explain(problem) });
    }
    reload();
  }

  /**
   * Adds or updates a source; a new source is fetched once right away
   *
   * @param event {SyntheticEvent<HTMLFormElement>} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const token = String(values.get('token') ?? '').trim();
    const body = {
      name: String(values.get('name') ?? ''),
      url: String(values.get('url') ?? '').trim(),
      test: values.get('test') === 'on',
      ...(token && { token }),
    };
    const target = editing;
    const done = await save.run(async () => {
      if (target === 'new') {
        const created = await api<{ result: { documents: number } | { error: string } }>(
          '/api/settings/external-sources',
          { method: 'POST', body },
        );
        if ('error' in created.result) throw created.result.error;
        return t(countKey(created.result.documents, 'settings.external.received'), {
          count: created.result.documents,
        });
      }
      if (target) await api(`/api/settings/external-sources/${target.id}`, { method: 'PATCH', body });
      return t('settings.external.saved');
    });
    reload();
    if (done) {
      setResult(undefined);
      setEditing(null);
    }
  }

  const usable = data.allowed && data.secretsKey;
  return (
    <>
      <SettingsSection title={t('external.title')} description={t('external.body')}>
        {!data.allowed && <Notice tone="info">{t('external.notAllowed')}</Notice>}
        {data.allowed && !data.secretsKey && <Notice tone="warn">{t('stripe.noSecretsKey')}</Notice>}
        {result && (
          <Notice tone={result.tone} live>
            {result.text}
          </Notice>
        )}
        {save.feedback?.tone === 'success' && editing === null && (
          <Notice tone="success" live>
            {save.feedback.text}
          </Notice>
        )}
        {data.sources.length === 0 ? (
          <EmptyState inline title={t('settings.external.empty')} body={t('settings.external.empty.body')}>
            {usable && editing === null && (
              <Button variant="ghost" onClick={() => setEditing('new')}>
                {t('external.add')}
              </Button>
            )}
          </EmptyState>
        ) : (
          <ul className={list.list}>
            {data.sources.map((source) => (
              <li key={source.id} className={list.item}>
                <Row
                  primary={
                    <>
                      <strong>{source.name}</strong> {source.test && <DevBadge />}{' '}
                      {source.error && <Badge tone="err">{explain(source.error)}</Badge>}
                    </>
                  }
                  meta={
                    <>
                      <span className={text.wrap}>{source.url}</span>
                      <br />
                      {t(countKey(source.documents, 'settings.external.documents'), {
                        count: source.documents,
                      })}{' '}
                      {t('settings.stripe.lastSync', {
                        date: source.syncedAt
                          ? formatDate(source.syncedAt.slice(0, 10), locale)
                          : t('stripe.never'),
                      })}
                    </>
                  }
                  actions={
                    usable && (
                      <>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            void run(async () => {
                              const response = await api<{ documents: number }>(
                                `/api/settings/external-sources/${source.id}/sync`,
                                { method: 'POST' },
                              );
                              return t(countKey(response.documents, 'settings.external.received'), {
                                count: response.documents,
                              });
                            })
                          }
                        >
                          {t('external.sync')}
                        </Button>
                        <Button variant="subtle" onClick={() => setEditing(source)}>
                          {t('common.edit')}
                        </Button>
                        <Button variant="danger" aria-haspopup="dialog" onClick={() => setRemoving(source)}>
                          {t('external.remove')}
                        </Button>
                      </>
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {usable && editing === null && data.sources.length > 0 && (
          <div>
            <Button variant="ghost" onClick={() => setEditing('new')}>
              {t('external.add')}
            </Button>
          </div>
        )}
      </SettingsSection>
      {usable && editing !== null && (
        <form onSubmit={(event) => void submit(event)} key={editing === 'new' ? 'new' : editing.id}>
          <SettingsSection
            title={editing === 'new' ? t('external.add') : editing.name}
            footer={
              <ActionBar primaryLabel={t('stripe.save')} busy={save.busy} feedback={save.feedback}>
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  {t('common.cancel')}
                </Button>
              </ActionBar>
            }
          >
            <TextField
              label={t('external.name')}
              name="name"
              required
              maxLength={60}
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
            <Field label={t('external.test')} hint={t('external.test.hint')} checkbox>
              {(control) => (
                <input
                  {...control}
                  type="checkbox"
                  name="test"
                  defaultChecked={editing !== 'new' && editing.test}
                />
              )}
            </Field>
            <details className={text.details}>
              <summary>{t('settings.technical')}</summary>
              <p>{t('settings.external.technical')}</p>
            </details>
          </SettingsSection>
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
            return t('settings.external.removed');
          });
        }}
      />
    </>
  );
}
