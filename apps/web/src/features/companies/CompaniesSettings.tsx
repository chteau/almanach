import { useState } from 'react';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import list from '../../components/RowList/RowList.module.css';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { describeError } from '../install/errors.ts';
import styles from '../planning/Planning.module.css';
import local from './CompaniesSettings.module.css';
import { activateCompany, useCompanies } from './useCompanies.ts';

/**
 * Settings section listing the person's companies, to rename, switch or add one
 *
 * @returns {JSX.Element | null} - the section, once loaded
 */
export function CompaniesSettings() {
  const { t } = useI18n();
  const { data, reload } = useCompanies();
  const [names, setNames] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<string>();
  if (!data) return null;

  /**
   * Runs a request, then reloads the list or shows the failure
   *
   * @param request {Promise<unknown>} - API call
   * @returns {Promise<void>} - resolves once handled
   */
  async function run(request: Promise<unknown>): Promise<void> {
    try {
      await request;
      setFailure(undefined);
      reload();
    } catch (problem) {
      setFailure(describeError(problem, t));
    }
  }

  return (
    <section className={form.section} aria-labelledby="companies-title">
      <h2 id="companies-title" className={styles.sectionTitle}>
        {t('companies.title')}
      </h2>
      <p className={styles.text}>{t('companies.body')}</p>
      {failure && <Notice tone="error">{failure}</Notice>}
      <ul className={list.list}>
        {data.companies.map((company) => (
          <li key={company.id} className={list.item}>
            <form
              className={local.row}
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  api(`/api/companies/${company.id}`, { method: 'PATCH', body: { name: names[company.id] } }),
                );
              }}
            >
              <TextField
                label={t('companies.name')}
                value={names[company.id] ?? company.name}
                maxLength={120}
                required
                onChange={(event) => setNames({ ...names, [company.id]: event.target.value })}
              />
              {names[company.id] !== undefined && names[company.id] !== company.name && (
                <Button type="submit" variant="ghost">
                  {t('companies.rename')}
                </Button>
              )}
              {company.id === data.active ? (
                <Badge tone="ok">{t('companies.active')}</Badge>
              ) : (
                <Button variant="ghost" onClick={() => void run(activateCompany(company.id))}>
                  {t('companies.activate')}
                </Button>
              )}
            </form>
          </li>
        ))}
      </ul>
      <Notice tone="info">{t('companies.legal')}</Notice>
      <form
        className={local.row}
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            api<{ company: { id: string } }>('/api/companies', { method: 'POST', body: { name } }).then(
              ({ company }) => activateCompany(company.id),
            ),
          );
        }}
      >
        <TextField
          label={t('companies.new')}
          value={name}
          maxLength={120}
          required
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit">{t('companies.add')}</Button>
      </form>
    </section>
  );
}
