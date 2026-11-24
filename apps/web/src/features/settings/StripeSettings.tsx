import { type SyntheticEvent, useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { DangerAction, DangerZone } from '../../components/DangerZone/DangerZone.tsx';
import { Field } from '../../components/Field/Field.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
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
import { useAction } from './useAction.ts';

const STRIPE_ERRORS = ['stripe_unauthorized', 'stripe_forbidden', 'stripe_unreachable', 'stripe_failed'];

interface StripeStatus {
  allowed: boolean;
  secretsKey: boolean;
  keySet: boolean;
  /** The saved key is a test key (sk_test_…, rk_test_…). */
  testKey: boolean;
  enabled: boolean;
  syncedAt: string | null;
  error: string | null;
  imported: number;
}

/**
 * Picks the message key for a count, so "0 receipts" and "1 receipt" read naturally
 *
 * @param count {number} - number of items
 * @param base {string} - key prefix, completed with .zero, .one or .many
 * @returns {MessageKey} - the key to translate
 */
export function countKey(count: number, base: string): MessageKey {
  return `${base}.${count === 0 ? 'zero' : count === 1 ? 'one' : 'many'}` as MessageKey;
}

/**
 * Settings panel for the Stripe sync of the active company
 *
 * @returns {JSX.Element} - the sections
 */
export function StripeSettings() {
  const { t, locale } = useI18n();
  const { data, error, reload } = useResource<StripeStatus>('/api/settings/stripe');
  const [key, setKey] = useState('');
  const [enabled, setEnabled] = useState<boolean>();
  /**
   * Translates a failure code from the server or from the last sync
   *
   * @param problem {unknown} - failure
   * @returns {string} - message
   */
  const explain = (problem: unknown): string => {
    const code = problem instanceof ApiError ? String(problem.body.error ?? '') : String(problem ?? '');
    return STRIPE_ERRORS.includes(code) ? t(`stripe.error.${code}` as MessageKey) : describeError(problem, t);
  };
  const save = useAction(explain);
  const sync = useAction(explain);
  const remove = useAction(explain);

  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={3} />;
  const on = enabled ?? data.enabled;
  const dirty = key !== '' || on !== data.enabled;

  /**
   * Saves the key and the schedule
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const done = await save.run(async () => {
      await api('/api/settings/stripe', { method: 'PUT', body: { enabled: on, ...(key ? { key } : {}) } });
    });
    if (done) {
      setKey('');
      setEnabled(undefined);
    }
    reload();
  }

  const ready = data.allowed && data.secretsKey;

  return (
    <>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <SettingsSection
          title={t('stripe.title')}
          description={t('stripe.body')}
          badge={
            data.keySet && (
              <Badge tone={data.enabled ? 'ok' : undefined}>
                {data.enabled ? t('settings.on') : t('settings.off')}
              </Badge>
            )
          }
          footer={
            ready && (
              <ActionBar
                primaryLabel={t('stripe.save')}
                busy={save.busy}
                dirty={dirty}
                feedback={sync.feedback ?? save.feedback}
              >
                {data.enabled && (
                  <Button
                    variant="ghost"
                    busy={sync.busy}
                    onClick={() =>
                      void sync
                        .run(async () => {
                          const result = await api<{ imported: number }>('/api/settings/stripe/sync', {
                            method: 'POST',
                          });
                          return t(countKey(result.imported, 'settings.stripe.synced'), {
                            count: result.imported,
                          });
                        })
                        .then(reload)
                    }
                  >
                    {t('stripe.sync')}
                  </Button>
                )}
              </ActionBar>
            )
          }
        >
          {!data.allowed && <Notice tone="info">{t('stripe.notAllowed')}</Notice>}
          {data.allowed && !data.secretsKey && <Notice tone="warn">{t('stripe.noSecretsKey')}</Notice>}
          {data.error && <Notice tone="error">{explain(data.error)}</Notice>}
          {(/^(sk|rk)_test_/.test(key) || (!key && data.testKey)) && (
            <Notice tone="warn">{t('stripe.testKey')}</Notice>
          )}
          {ready && (
            <>
              <TextField
                label={t('stripe.key')}
                hint={data.keySet ? t('stripe.key.saved') : t('stripe.key.hint')}
                value={key}
                autoComplete="off"
                spellCheck={false}
                placeholder={data.keySet ? '••••••••' : undefined}
                onChange={(event) => setKey(event.target.value.trim())}
              />
              <Field label={t('stripe.enabled')} checkbox>
                {(control) => (
                  <input
                    {...control}
                    type="checkbox"
                    checked={on}
                    onChange={(event) => setEnabled(event.target.checked)}
                  />
                )}
              </Field>
            </>
          )}
          <p className={text.caption}>
            {t(countKey(data.imported, 'settings.stripe.imported'), { count: data.imported })}{' '}
            {t('settings.stripe.lastSync', {
              date: data.syncedAt ? formatDate(data.syncedAt.slice(0, 10), locale) : t('stripe.never'),
            })}
          </p>
        </SettingsSection>
      </form>
      {data.keySet && (
        <DangerZone>
          {remove.feedback?.tone === 'error' && (
            <li>
              <Notice tone="error" live>
                {remove.feedback.text}
              </Notice>
            </li>
          )}
          <DangerAction
            label={t('stripe.remove')}
            consequence={t('settings.stripe.remove.consequence')}
            actionLabel={t('settings.remove')}
            busy={remove.busy}
            onConfirm={() =>
              void remove
                .run(() => api('/api/settings/stripe', { method: 'DELETE' }).then(() => undefined))
                .then(reload)
            }
          />
        </DangerZone>
      )}
    </>
  );
}
