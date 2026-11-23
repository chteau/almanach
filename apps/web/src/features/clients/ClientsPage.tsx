import type { Client, LinkedRecords } from '@almanach/shared';
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
import { ActivityFilter } from '../linked/ActivityFilter.tsx';
import { labelsOf, linkedPath, showsLink, showsLocal } from '../linked/activity.ts';
import { DevBadge, HideTestToggle, useHideTest } from '../linked/TestData.tsx';

/** A client of this instance, or one received read-only from a linked instance (with its activity label). */
type Row = Pick<Client, 'kind' | 'name' | 'email' | 'country' | 'vatNumber' | 'archived'> & {
  key: string;
  to: string;
  currency: string | null;
  createdAt: string;
  linkId?: string;
  source?: string;
  origin?: string;
  /** Test data (Stripe test mode, test source): greyed with a DEV pill. */
  test?: boolean;
};

/**
 * Client list (P07): search, filters by kind, country, archived state and activity, sort by name or date
 * (S-090, S-091); clients of linked instances show read-only with their activity badge
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
  const linked = useResource<LinkedRecords>('/api/linked').data;
  const [activity, setActivity] = useState('');
  const [hideTest, setHideTest] = useHideTest();

  const clients = useMemo<Row[]>(() => {
    const labels = labelsOf(linked);
    return [
      ...(data?.clients ?? []).map((client) => ({
        ...client,
        key: client.id,
        to: `/clients/${client.id}`,
        test: client.livemode === false,
      })),
      ...(linked?.clients ?? []).map((client) => ({
        ...client,
        key: `${client.linkId}:${client.id}`,
        to: linkedPath('client', client.linkId, client.id),
        archived: false,
        currency: null,
        createdAt: '',
        source: labels.get(client.linkId) ?? '',
      })),
    ];
  }, [data, linked]);
  const countries = [...new Set(clients.map((client) => client.country))];
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return clients
      .filter((client) => (client.linkId ? showsLink(activity, client.linkId) : showsLocal(activity)))
      .filter((client) => !hideTest || !client.test)
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
  }, [clients, query, kind, country, archived, sort, locale, activity, hideTest]);

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
            <ActivityFilter linked={linked} value={activity} onChange={setActivity} />
            <HideTestToggle
              shown={clients.some((client) => client.test)}
              value={hideTest}
              onChange={setHideTest}
            />
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
                <li key={client.key} className={client.test ? `${list.item} ${list.test}` : list.item}>
                  <Link to={client.to} className={list.row}>
                    <span className={list.primary}>
                      <strong>{client.name}</strong>
                      <span className={list.secondary}>{client.email ?? '—'}</span>
                    </span>
                    <span className={list.secondary}>{countryName(client.country, locale)}</span>
                    <span className={list.secondary}>{client.currency ?? '—'}</span>
                    <span className={list.badges}>
                      {client.source !== undefined && <Badge tone="accent">{client.source}</Badge>}
                      {client.origin && <Badge>{client.origin}</Badge>}
                      {client.test && <DevBadge />}
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
