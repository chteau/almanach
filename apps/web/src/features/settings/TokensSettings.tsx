import type { ApiToken, TokenScope } from '@almanach/shared';
import { useState } from 'react';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';
import styles from '../planning/Planning.module.css';

/**
 * Personal access tokens for the MCP endpoint (docs/mcp.md): created with a name and a scope, shown once,
 * revocable, with their last use
 *
 * @returns {JSX.Element | null} - the section, once loaded
 */
export function TokensSettings() {
  const { t, locale } = useI18n();
  const { data, reload } = useResource<{ allowed: boolean; tokens: ApiToken[] }>('/api/settings/tokens');
  const [created, setCreated] = useState<string>();
  const [failure, setFailure] = useState<string>();
  if (!data) return null;
  const date = (value: string | null) => (value ? formatDate(value.slice(0, 10), locale) : t('stripe.never'));
  return (
    <section className={form.section} aria-labelledby="tokens-title">
      <h2 id="tokens-title" className={styles.sectionTitle}>
        {t('tokens.title')}
      </h2>
      <p className={styles.text}>{t('tokens.body')}</p>
      {!data.allowed && <Notice tone="info">{t('tokens.notAllowed')}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}
      {created && (
        <Notice tone="info">
          {t('tokens.created')} <code>{created}</code>
        </Notice>
      )}
      {data.tokens.length > 0 && (
        <ul className={list.list}>
          {data.tokens.map((token) => (
            <li key={token.id} className={list.item}>
              <div className={list.row}>
                <span className={list.primary}>
                  <strong>{token.name}</strong>
                  <span className={list.secondary}>
                    {t('tokens.used', { created: date(token.createdAt), used: date(token.lastUsedAt) })}
                  </span>
                </span>
                <span className={list.badges}>
                  <Badge tone={token.scope === 'read' ? 'neutral' : 'warn'}>
                    {t(`tokens.scope.${token.scope}`)}
                  </Badge>
                </span>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void api(`/api/settings/tokens/${token.id}`, { method: 'DELETE' })
                      .then(() => setCreated(undefined))
                      .catch((problem) => setFailure(describeError(problem, t)))
                      .finally(reload)
                  }
                >
                  {t('tokens.revoke')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data.allowed && (
        <form
          className={form.form}
          onSubmit={(event) => {
            event.preventDefault();
            const target = event.currentTarget;
            const values = new FormData(target);
            void api<{ token: string }>('/api/settings/tokens', {
              method: 'POST',
              body: { name: String(values.get('name') ?? ''), scope: values.get('scope') as TokenScope },
            })
              .then((result) => {
                setCreated(result.token);
                setFailure(undefined);
                target.reset();
              })
              .catch((problem) => setFailure(describeError(problem, t)))
              .finally(reload);
          }}
        >
          <TextField label={t('tokens.name')} name="name" required maxLength={60} placeholder="Claude Code" />
          <SelectField label={t('tokens.scope')} name="scope" defaultValue="read">
            <option value="read">{t('tokens.scope.read')}</option>
            <option value="read_drafts">{t('tokens.scope.read_drafts')}</option>
          </SelectField>
          <div className={form.actions}>
            <Button type="submit">{t('tokens.create')}</Button>
          </div>
        </form>
      )}
    </section>
  );
}
