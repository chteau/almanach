import type { Client } from '@almanach/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import buttonStyles from '../../components/Button/Button.module.css';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { countryName } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';

/**
 * Client list (P07): search, filters by kind, country and archived state, sort by name or date (S-090, S-091)
 *
 * @returns {JSX.Element} - the page
 */
export function ClientsPage() {
  const { t, locale } = useI18n();
  const { data, error, loading, reload } = useResource<{ clients: Client[] }>('/api/clients');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [country, setCountry] = useState('');
  const [archived, setArchived] = useState('active');
  const [sort, setSort] = useState('name');

  const clients = data?.clients ?? [];
  const countries = [...new Set(clients.map((client) => client.country))];
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return clients
      .filter((client) => (archived === 'archived' ? client.archived : !client.archived))
      .filter((client) => !kind || client.kind === kind)
      .filter((client) => !country || client.country === country)
      .filter(
        (client) =>
          !needle ||
          [client.name, client.email, client.vatNumber].some((value) =>
            value?.toLocaleLowerCase(locale).includes(needle),
          ),
      )
      .sort((a, b) =>
        sort === 'recent' ? b.createdAt.localeCompare(a.createdAt) : a.name.localeCompare(b.name, locale),
      );
  }, [clients, query, kind, country, archived, sort, locale]);

  const newButton = (
    <Link to="/clients/new" className={`${buttonStyles.button} ${buttonStyles.primary}`}>
      {t('clients.new')}
    </Link>
  );

  const importButton = (
    <Link to="/clients/import" className={`${buttonStyles.button} ${buttonStyles.ghost}`}>
      {t('import.open')}
    </Link>
  );

  return (
    <>
      <PageHeader title={t('clients.title')}>
        {clients.length > 0 && (
          <>
            {importButton}
            {newButton}
          </>
        )}
      </PageHeader>
      {loading && !data && <Skeleton />}
      {error !== undefined && <LoadError error={error} onRetry={reload} />}
      {data && clients.length === 0 && (
        <EmptyState title={t('clients.empty.title')} body={t('clients.empty.body')}>
          {newButton}
          {importButton}
        </EmptyState>
      )}
      {clients.length > 0 && (
        <>
          <search className={list.toolbar}>
            <div className={list.search}>
              <TextField
                label={t('common.search')}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <SelectField
              label={t('clients.kind')}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="">{t('common.all')}</option>
              <option value="company">{t('clients.kind.company')}</option>
              <option value="individual">{t('clients.kind.individual')}</option>
            </SelectField>
            <SelectField
              label={t('clients.country')}
              value={country}
              onChange={(event) => setCountry(event.target.value)}
            >
              <option value="">{t('common.all')}</option>
              {countries.map((code) => (
                <option key={code} value={code}>
                  {countryName(code, locale)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t('clients.state')}
              value={archived}
              onChange={(event) => setArchived(event.target.value)}
            >
              <option value="active">{t('clients.state.active')}</option>
              <option value="archived">{t('clients.state.archived')}</option>
            </SelectField>
            <SelectField
              label={t('common.sort')}
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="name">{t('common.sort.name')}</option>
              <option value="recent">{t('common.sort.recent')}</option>
            </SelectField>
          </search>
          <p className={list.count} aria-live="polite">
            {t('common.results', { count: visible.length })}
          </p>
          {visible.length > 0 && (
            <ul className={list.list}>
              {visible.map((client) => (
                <li key={client.id} className={list.item}>
                  <Link to={`/clients/${client.id}`} className={list.row}>
                    <span className={list.primary}>
                      <strong>{client.name}</strong>
                      <span className={list.secondary}>{client.email ?? '—'}</span>
                    </span>
                    <span className={list.secondary}>{countryName(client.country, locale)}</span>
                    <span className={list.secondary}>{client.currency}</span>
                    <span className={list.badges}>
                      <Badge>{t(`clients.kind.${client.kind}`)}</Badge>
                      {client.archived && <Badge tone="warn">{t('clients.state.archived')}</Badge>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
