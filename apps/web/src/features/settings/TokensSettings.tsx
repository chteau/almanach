import type { ApiToken, TokenScope } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { Row } from '../../components/Row/Row.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import text from '../../styles/text.module.css';
import { describeError } from '../install/errors.ts';
import { useAction } from './useAction.ts';

/**
 * Personal access tokens for AI assistants (MCP endpoint, docs/mcp.md): created with a name and a
 * scope, shown once, revocable after confirmation, with their last use
 *
 * @returns {JSX.Element} - the sections
 */
export function TokensSettings() {
  const { t, locale } = useI18n();
  const { data, error, reload } = useResource<{ allowed: boolean; tokens: ApiToken[] }>(
    '/api/settings/tokens',
  );
  const [created, setCreated] = useState<string>();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<TokenScope>('read');
  const [revoking, setRevoking] = useState<ApiToken>();
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string }>();
  const create = useAction();
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={3} />;

  /**
   * Formats an optional timestamp as a date
   *
   * @param value {string | null} - ISO timestamp
   * @returns {string} - the date, or "never"
   */
  const date = (value: string | null) => (value ? formatDate(value.slice(0, 10), locale) : t('stripe.never'));

  /**
   * Creates a token and shows it once
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    setResult(undefined);
    await create.run(async () => {
      const response = await api<{ token: string }>('/api/settings/tokens', {
        method: 'POST',
        body: { name: name.trim(), scope },
      });
      setCreated(response.token);
      setName('');
      return t('settings.tokens.created');
    });
    reload();
  }

  /**
   * Revokes a token after confirmation
   *
   * @param token {ApiToken} - token to revoke
   * @returns {Promise<void>} - resolves when done
   */
  async function revoke(token: ApiToken): Promise<void> {
    setRevoking(undefined);
    try {
      await api(`/api/settings/tokens/${token.id}`, { method: 'DELETE' });
      setCreated(undefined);
      setResult({ tone: 'success', text: t('settings.tokens.revoked', { name: token.name }) });
    } catch (problem) {
      setResult({ tone: 'error', text: describeError(problem, t) });
    }
    reload();
  }

  return (
    <>
      <SettingsSection title={t('tokens.title')} description={t('tokens.body')}>
        {!data.allowed && <Notice tone="info">{t('tokens.notAllowed')}</Notice>}
        {result && (
          <Notice tone={result.tone} live>
            {result.text}
          </Notice>
        )}
        {created && (
          <Notice tone="success" live>
            {t('tokens.created')} <code className={text.mono}>{created}</code>
          </Notice>
        )}
        {data.tokens.length === 0 ? (
          <EmptyState inline title={t('settings.tokens.empty')} body={t('settings.tokens.empty.body')} />
        ) : (
          <ul className={list.list}>
            {data.tokens.map((token) => (
              <li key={token.id} className={list.item}>
                <Row
                  primary={<strong>{token.name}</strong>}
                  meta={t('tokens.used', { created: date(token.createdAt), used: date(token.lastUsedAt) })}
                  actions={
                    <>
                      <Badge tone={token.scope === 'read' ? 'neutral' : 'warn'}>
                        {t(`tokens.scope.${token.scope}`)}
                      </Badge>
                      <Button variant="danger" aria-haspopup="dialog" onClick={() => setRevoking(token)}>
                        {t('tokens.revoke')}
                      </Button>
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <details className={text.details}>
          <summary>{t('settings.technical')}</summary>
          <p>{t('settings.tokens.technical', { url: `${window.location.origin}/mcp` })}</p>
        </details>
      </SettingsSection>
      {data.allowed && (
        <form onSubmit={(event) => void submit(event)} noValidate>
          <SettingsSection
            title={t('tokens.create')}
            footer={
              <ActionBar
                primaryLabel={t('tokens.create')}
                busy={create.busy}
                disabled={!name.trim()}
                feedback={create.feedback?.tone === 'error' ? create.feedback : null}
              />
            }
          >
            <TextField
              label={t('tokens.name')}
              hint={t('settings.tokens.name.hint')}
              required
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <SelectField
              label={t('tokens.scope')}
              value={scope}
              onChange={(event) => setScope(event.target.value as TokenScope)}
            >
              <option value="read">{t('tokens.scope.read')}</option>
              <option value="read_drafts">{t('tokens.scope.read_drafts')}</option>
            </SelectField>
          </SettingsSection>
        </form>
      )}
      <ConfirmDialog
        open={revoking !== undefined}
        danger
        title={t('tokens.revoke')}
        body={t('settings.tokens.revoke.body', { name: revoking?.name ?? '' })}
        confirmLabel={t('tokens.revoke')}
        onCancel={() => setRevoking(undefined)}
        onConfirm={() => revoking && void revoke(revoking)}
      />
    </>
  );
}
