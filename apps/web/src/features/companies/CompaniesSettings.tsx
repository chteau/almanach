import { type SyntheticEvent, useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { Row } from '../../components/Row/Row.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { describeError } from '../install/errors.ts';
import { useAction } from '../settings/useAction.ts';
import { activateCompany, useCompanies } from './useCompanies.ts';

/**
 * Companies of the account: rename, switch to, and add one (several legal entities)
 *
 * @returns {JSX.Element} - the sections
 */
export function CompaniesSettings() {
  const { t } = useI18n();
  const { data, error, reload } = useCompanies();
  const [editing, setEditing] = useState<{ id: string; name: string }>();
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<string>();
  const add = useAction();
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={2} />;

  /**
   * Runs a call on a company and reports a failure in the list
   *
   * @param request {Promise<unknown>} - call
   * @returns {Promise<void>} - resolves when done
   */
  async function run(request: Promise<unknown>): Promise<void> {
    try {
      await request;
      setFailure(undefined);
      setEditing(undefined);
      reload();
    } catch (problem) {
      setFailure(describeError(problem, t));
    }
  }

  /**
   * Creates a company and switches to it
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    await add.run(async () => {
      const { company } = await api<{ company: { id: string } }>('/api/companies', {
        method: 'POST',
        body: { name: name.trim() },
      });
      await activateCompany(company.id);
    });
  }

  return (
    <>
      <SettingsSection title={t('companies.title')} description={t('companies.body')}>
        {failure && (
          <Notice tone="error" live>
            {failure}
          </Notice>
        )}
        <ul className={list.list}>
          {data.companies.map((company) =>
            editing?.id === company.id ? (
              <li key={company.id} className={list.item}>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(
                      api(`/api/companies/${company.id}`, { method: 'PATCH', body: { name: editing.name } }),
                    );
                  }}
                >
                  <Row
                    primary={
                      <TextField
                        label={t('companies.name')}
                        value={editing.name}
                        maxLength={160}
                        required
                        onChange={(event) => setEditing({ id: company.id, name: event.target.value })}
                      />
                    }
                    actions={
                      <>
                        <Button variant="ghost" onClick={() => setEditing(undefined)}>
                          {t('common.cancel')}
                        </Button>
                        <Button type="submit" disabled={!editing.name.trim()}>
                          {t('common.save')}
                        </Button>
                      </>
                    }
                  />
                </form>
              </li>
            ) : (
              <li key={company.id} className={list.item}>
                <Row
                  primary={
                    <>
                      <strong>{company.name}</strong>{' '}
                      {company.id === data.active && <Badge tone="ok">{t('companies.active')}</Badge>}
                    </>
                  }
                  actions={
                    <>
                      <Button
                        variant="subtle"
                        onClick={() => setEditing({ id: company.id, name: company.name })}
                      >
                        {t('companies.rename')}
                      </Button>
                      {company.id !== data.active && (
                        <Button variant="ghost" onClick={() => void run(activateCompany(company.id))}>
                          {t('companies.activate')}
                        </Button>
                      )}
                    </>
                  }
                />
              </li>
            ),
          )}
        </ul>
      </SettingsSection>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <SettingsSection
          title={t('companies.new')}
          description={t('companies.legal')}
          footer={
            <ActionBar
              primaryLabel={t('companies.add')}
              busy={add.busy}
              disabled={!name.trim()}
              feedback={add.feedback?.tone === 'error' ? add.feedback : null}
            />
          }
        >
          <TextField
            label={t('companies.name')}
            value={name}
            maxLength={160}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </SettingsSection>
      </form>
    </>
  );
}
