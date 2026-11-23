import { useState } from 'react';
import { Button } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { ApiError, api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';
import styles from '../planning/Planning.module.css';

const STRIPE_ERRORS = ['stripe_unauthorized', 'stripe_forbidden', 'stripe_unreachable', 'stripe_failed'];

interface StripeStatus {
  allowed: boolean;
  secretsKey: boolean;
  keySet: boolean;
  enabled: boolean;
  syncedAt: string | null;
  error: string | null;
  imported: number;
}

/**
 * Settings section for the Stripe sync of the active company
 *
 * @returns {JSX.Element | null} - the section, once loaded
 */
export function StripeSettings() {
  const { t, locale } = useI18n();
  const { data, reload } = useResource<StripeStatus>('/api/settings/stripe');
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string }>();
  if (!data) return null;

  /**
   * Translates a failure code from the server or from the last sync
   *
   * @param code {string} - error code
   * @param problem {unknown} - original failure, for the generic message
   * @returns {string} - message
   */
  const explain = (code: string, problem?: unknown): string =>
    STRIPE_ERRORS.includes(code) ? t(`stripe.error.${code}` as MessageKey) : describeError(problem, t);

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
      setKey('');
    } catch (problem) {
      const code = problem instanceof ApiError ? String(problem.body.error ?? '') : '';
      setMessage({ tone: 'error', text: explain(code, problem) });
    }
    reload();
  }

  return (
    <section className={form.section} aria-labelledby="stripe-title">
      <h2 id="stripe-title" className={styles.sectionTitle}>
        {t('stripe.title')}
      </h2>
      <p className={styles.text}>{t('stripe.body')}</p>
      {!data.allowed && <Notice tone="info">{t('stripe.notAllowed')}</Notice>}
      {data.allowed && !data.secretsKey && <Notice tone="warn">{t('stripe.noSecretsKey')}</Notice>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {!message && data.error && <Notice tone="error">{explain(data.error)}</Notice>}
      {data.allowed && data.secretsKey && (
        <form
          className={form.form}
          onSubmit={(event) => {
            event.preventDefault();
            const enabled = (event.currentTarget.elements.namedItem('enabled') as HTMLInputElement).checked;
            void run(async () => {
              await api('/api/settings/stripe', {
                method: 'PUT',
                body: { enabled, ...(key ? { key } : {}) },
              });
              return undefined;
            });
          }}
        >
          <TextField
            label={t('stripe.key')}
            hint={data.keySet ? t('stripe.key.saved') : t('stripe.key.hint')}
            value={key}
            autoComplete="off"
            spellCheck={false}
            placeholder={data.keySet ? '••••••••' : 'rk_live_…'}
            onChange={(event) => setKey(event.target.value.trim())}
          />
          <label className={styles.check}>
            <input type="checkbox" name="enabled" defaultChecked={data.enabled} key={String(data.enabled)} />
            {t('stripe.enabled')}
          </label>
          <div className={form.actions}>
            <Button type="submit">{t('stripe.save')}</Button>
            {data.enabled && (
              <Button
                variant="ghost"
                onClick={() =>
                  void run(async () => {
                    const result = await api<{ imported: number }>('/api/settings/stripe/sync', {
                      method: 'POST',
                    });
                    return t('stripe.synced', { count: result.imported });
                  })
                }
              >
                {t('stripe.sync')}
              </Button>
            )}
            {data.keySet && (
              <Button
                variant="ghost"
                onClick={() =>
                  void run(async () => {
                    await api('/api/settings/stripe', { method: 'DELETE' });
                    return undefined;
                  })
                }
              >
                {t('stripe.remove')}
              </Button>
            )}
          </div>
        </form>
      )}
      <p className={styles.caption}>
        {t('stripe.status', {
          count: data.imported,
          date: data.syncedAt ? formatDate(data.syncedAt.slice(0, 10), locale) : t('stripe.never'),
        })}
      </p>
    </section>
  );
}
