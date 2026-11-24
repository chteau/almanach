import { BILLING_TYPES, endsSoon, MISSION_STATUSES, type Mission } from '@almanach/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import { ButtonLink } from '../../components/Button/ButtonLink.tsx';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { formatDate, formatMoney, today } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';

const STATUS_TONE = { prospect: 'neutral', active: 'accent', done: 'ok', cancelled: 'warn' } as const;

/**
 * Mission list (P09): list or board by status, filters by client and billing type, "ends soon" badge
 * (S-110 to S-112, S-114)
 *
 * @returns {JSX.Element} - the page
 */
export function MissionsPage() {
  const { t, locale } = useI18n();
  const { data, error, loading, reload } = useResource<{ missions: Mission[] }>('/api/missions');
  const [view, setView] = useState<'list' | 'board'>('list');
  const [client, setClient] = useState('');
  const [billing, setBilling] = useState('');
  const [status, setStatus] = useState('');
  const missions = data?.missions ?? [];
  const now = today();

  const clients = useMemo(
    () => [...new Map(missions.map((mission) => [mission.clientId, mission.clientName])).entries()],
    [missions],
  );
  const visible = missions.filter(
    (mission) =>
      (!client || mission.clientId === client) &&
      (!billing || mission.billing === billing) &&
      (!status || mission.status === status),
  );

  const newButton = (
    <ButtonLink to="/missions/new" variant="primary">
      {t('missions.new')}
    </ButtonLink>
  );

  /**
   * Renders one mission as a list row
   *
   * @param mission {Mission} - mission to show
   * @returns {JSX.Element} - the row
   */
  const row = (mission: Mission) => (
    <li key={mission.id} className={list.item}>
      <Link to={`/missions/${mission.id}`} className={list.row}>
        <span className={list.primary}>
          <strong>{mission.name}</strong>
          <span className={list.secondary}>{mission.clientName}</span>
        </span>
        <span className={list.secondary}>
          {formatDate(mission.startDate, locale)}
          {mission.endDate ? ` → ${formatDate(mission.endDate, locale)}` : ''}
        </span>
        <span className={list.secondary}>
          {formatMoney(mission.rateCents, mission.currency, locale)}{' '}
          {t(`missions.billing.per.${mission.billing}`)}
        </span>
        <span className={list.badges}>
          <Badge tone={STATUS_TONE[mission.status]}>{t(`missions.status.${mission.status}`)}</Badge>
          {endsSoon(mission, now) && <Badge tone="warn">{t('missions.endsSoon')}</Badge>}
        </span>
      </Link>
    </li>
  );

  return (
    <>
      <PageHeader title={t('missions.title')}>{missions.length > 0 && newButton}</PageHeader>
      {loading && !data && <Skeleton />}
      {error !== undefined && <LoadError error={error} onRetry={reload} />}
      {data && missions.length === 0 && (
        <EmptyState title={t('missions.empty.title')} body={t('missions.empty.body')}>
          {newButton}
        </EmptyState>
      )}
      {missions.length > 0 && (
        <>
          <div className={list.toolbar}>
            <SelectField
              label={t('missions.view')}
              value={view}
              onChange={(event) => setView(event.target.value as 'list' | 'board')}
            >
              <option value="list">{t('missions.view.list')}</option>
              <option value="board">{t('missions.view.board')}</option>
            </SelectField>
            <SelectField
              label={t('missions.client')}
              value={client}
              onChange={(event) => setClient(event.target.value)}
            >
              <option value="">{t('common.all')}</option>
              {clients.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t('missions.billing')}
              value={billing}
              onChange={(event) => setBilling(event.target.value)}
            >
              <option value="">{t('common.all')}</option>
              {BILLING_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`missions.billing.${type}`)}
                </option>
              ))}
            </SelectField>
            {view === 'list' && (
              <SelectField
                label={t('missions.status')}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">{t('common.all')}</option>
                {MISSION_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`missions.status.${value}`)}
                  </option>
                ))}
              </SelectField>
            )}
          </div>
          <p className={list.count} aria-live="polite">
            {t('common.results', { count: visible.length })}
          </p>
          {view === 'list' ? (
            visible.length > 0 && <ul className={list.list}>{visible.map(row)}</ul>
          ) : (
            <div className={list.board}>
              {MISSION_STATUSES.map((value) => {
                const column = visible.filter((mission) => mission.status === value);
                return (
                  <section key={value} className={list.column} aria-labelledby={`col-${value}`}>
                    <h2 id={`col-${value}`}>
                      {t(`missions.status.${value}`)} · {column.length}
                    </h2>
                    {column.length > 0 && <ul className={list.list}>{column.map(row)}</ul>}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
