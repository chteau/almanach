import { daysBetween } from '@almanach/shared';
import { Link } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import buttonStyles from '../../components/Button/Button.module.css';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { Gauge } from '../../components/Gauge/Gauge.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import list from '../../components/RowList/RowList.module.css';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { formatDate, formatMoney } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { LinkedActivities } from './LinkedActivities.tsx';
import styles from './Planning.module.css';
import { type CalendarItem, labelOf, type Outlook, TYPE_STYLE } from './types.ts';

interface PeriodTotals {
  collectedCents: number;
  invoicedCents: number;
  previous: { collectedCents: number; invoicedCents: number };
}

interface Dashboard {
  today: string;
  currency: string;
  revenue: {
    month: PeriodTotals;
    quarter: PeriodTotals;
    year: PeriodTotals & { start: string; end: string };
  };
  unconverted: number;
  overdueDeadlines: CalendarItem[];
  upcoming: CalendarItem[];
  overdueInvoices: {
    id: string;
    number: string;
    clientName: string;
    dueDate: string;
    currency: string;
    dueCents: number;
  }[];
  outlook: Outlook | null;
}

/**
 * Home page: revenue, deadlines, late invoices, thresholds and amounts to set aside (P04, S-040 to S-050)
 *
 * @returns {JSX.Element} - the page
 */
export function DashboardPage() {
  const { t, locale } = useI18n();
  const { data, error, loading, reload } = useResource<Dashboard>('/api/dashboard');
  const clients = useResource<{ clients: unknown[] }>('/api/clients');
  const money = (cents: number) => formatMoney(cents, data?.currency ?? 'EUR', locale);

  if (error !== undefined) {
    return (
      <>
        <PageHeader title={t('nav.dashboard')} />
        <LoadError error={error} onRetry={reload} />
      </>
    );
  }
  if (loading && !data) {
    return (
      <>
        <PageHeader title={t('nav.dashboard')} />
        <Skeleton rows={6} />
      </>
    );
  }
  if (!data) return null;

  const fresh =
    clients.data?.clients.length === 0 &&
    data.revenue.year.invoicedCents === 0 &&
    data.revenue.year.collectedCents === 0;

  /**
   * Describes the change from the previous period, in words and not only colour
   *
   * @param current {number} - this period
   * @param previous {number} - previous period
   * @returns {string} - e.g. "+12 % vs previous"
   */
  const trend = (current: number, previous: number): string => {
    if (previous === 0) return current === 0 ? t('dashboard.trend.flat') : t('dashboard.trend.new');
    const change = Math.round(((current - previous) * 100) / previous);
    return t('dashboard.trend', { change: `${change > 0 ? '+' : ''}${change}` });
  };

  const periods = [
    ['month', data.revenue.month],
    ['quarter', data.revenue.quarter],
    ['year', data.revenue.year],
  ] as const;
  const outlook = data.outlook;
  const setAside = outlook?.estimates.reduce((sum, item) => sum + item.cents, 0) ?? 0;

  return (
    <>
      <PageHeader title={t('nav.dashboard')} subtitle={formatDate(data.today, locale)} />
      {fresh && (
        <EmptyState title={t('dashboard.empty.title')} body={t('dashboard.empty.body')}>
          <Link to="/clients/new" className={`${buttonStyles.button} ${buttonStyles.primary}`}>
            {t('clients.new')}
          </Link>
          <Link to="/documents/new?type=invoice" className={`${buttonStyles.button} ${buttonStyles.ghost}`}>
            {t('documents.new.invoice')}
          </Link>
        </EmptyState>
      )}

      {data.overdueDeadlines.length > 0 && (
        <section className={styles.alert} aria-labelledby="overdue-title">
          <h2 id="overdue-title">{t('dashboard.overdue.title', { count: data.overdueDeadlines.length })}</h2>
          <ul>
            {data.overdueDeadlines.map((item) => (
              <li key={item.key}>
                <Link to={item.type === 'custom' ? '/calendar' : `/calendar/${encodeURIComponent(item.key)}`}>
                  {labelOf(item.title, locale)}
                </Link>{' '}
                — {formatDate(item.date, locale)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {outlook?.fallback && (
        <Notice tone="warn">{t('outlook.fallback', { year: outlook.year, rules: outlook.rulesYear })}</Notice>
      )}
      {data.unconverted > 0 && (
        <Notice tone="info">{t('outlook.unconverted', { count: data.unconverted })}</Notice>
      )}

      <div className={styles.cards}>
        {periods.map(([key, totals]) => (
          <section key={key} className={styles.card} aria-labelledby={`revenue-${key}`}>
            <h2 id={`revenue-${key}`} className={styles.cardTitle}>
              {t(`dashboard.period.${key}`)}
            </h2>
            <p className={styles.figure}>{money(totals.collectedCents)}</p>
            <p className={styles.caption}>
              {t('dashboard.collected')} · {trend(totals.collectedCents, totals.previous.collectedCents)}
            </p>
            <p className={styles.caption}>
              {t('dashboard.invoiced')} {money(totals.invoicedCents)}
            </p>
          </section>
        ))}
      </div>

      <div className={styles.columns}>
        <section className={form.section} aria-labelledby="upcoming-title">
          <div className={styles.sectionHead}>
            <h2 id="upcoming-title" className={styles.sectionTitle}>
              {t('dashboard.upcoming')}
            </h2>
            <Link to="/calendar">{t('dashboard.seeCalendar')}</Link>
          </div>
          {data.upcoming.length === 0 ? (
            <p className={form.summary}>{t('dashboard.upcoming.none')}</p>
          ) : (
            <ul className={styles.timeline}>
              {data.upcoming.map((item) => {
                const days = daysBetween(data.today, item.date);
                return (
                  <li key={item.key} className={days <= 7 ? styles.soon : undefined}>
                    <Badge tone={TYPE_STYLE[item.type].tone}>{t(`calendar.type.${item.type}`)}</Badge>
                    <span className={styles.timelineText}>
                      {item.link?.startsWith('/') || item.type === 'tax' || item.type === 'social' ? (
                        <Link
                          to={
                            item.type === 'tax' || item.type === 'social'
                              ? `/calendar/${encodeURIComponent(item.key)}`
                              : (item.link ?? '/calendar')
                          }
                        >
                          {labelOf(item.title, locale)}
                        </Link>
                      ) : (
                        labelOf(item.title, locale)
                      )}
                    </span>
                    <span className={styles.when}>
                      {days === 0 ? t('calendar.today') : t('calendar.inDays', { days })} ·{' '}
                      {formatDate(item.date, locale)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={form.section} aria-labelledby="late-title">
          <h2 id="late-title" className={styles.sectionTitle}>
            {t('dashboard.lateInvoices')}
          </h2>
          {data.overdueInvoices.length === 0 ? (
            <p className={form.summary}>{t('dashboard.lateInvoices.none')}</p>
          ) : (
            <ul className={list.list}>
              {data.overdueInvoices.map((invoice) => (
                <li key={invoice.id} className={list.item}>
                  <Link to={`/documents/${invoice.id}`} className={list.row}>
                    <span className={list.primary}>
                      <strong>{invoice.number}</strong>
                      <span className={list.secondary}>{invoice.clientName}</span>
                    </span>
                    <span className={`${list.secondary} ${list.amount}`}>
                      {formatMoney(invoice.dueCents, invoice.currency, locale)}
                    </span>
                    <span className={list.badges}>
                      <Badge tone="err">
                        {t('documents.lateDays', { days: daysBetween(invoice.dueDate, data.today) })}
                      </Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {outlook && (
        <div className={styles.columns}>
          <section className={form.section} aria-labelledby="thresholds-title">
            <div className={styles.sectionHead}>
              <h2 id="thresholds-title" className={styles.sectionTitle}>
                {t('nav.thresholds')}
              </h2>
              <Link to="/thresholds">{t('dashboard.details')}</Link>
            </div>
            {outlook.thresholds.length === 0 && <p className={form.summary}>{t('outlook.noThresholds')}</p>}
            {outlook.thresholds.map((threshold) => (
              <div key={threshold.id}>
                <Gauge
                  label={labelOf(threshold.label, locale)}
                  valueBp={threshold.reachedBp}
                  detail={t('outlook.gauge', {
                    reached: money(threshold.reachedCents),
                    limit: money(threshold.limitCents),
                  })}
                />
                {threshold.linkedCents !== 0 && (
                  <p className={styles.caption}>
                    {t('outlook.linked', {
                      amount: money(threshold.linkedCents),
                      labels: outlook.linked.map((link) => link.label).join(', '),
                    })}
                  </p>
                )}
                {threshold.exceeded && <Notice tone="warn">{labelOf(threshold.consequence, locale)}</Notice>}
              </div>
            ))}
          </section>
          <section className={form.section} aria-labelledby="aside-title">
            <h2 id="aside-title" className={styles.sectionTitle}>
              {t('dashboard.setAside')}
            </h2>
            <p className={styles.figure}>{money(setAside)}</p>
            <ul className={styles.plain}>
              {outlook.estimates.map((estimate) => (
                <li key={estimate.id}>
                  {labelOf(estimate.label, locale)} : <strong>{money(estimate.cents)}</strong>
                  <span className={styles.caption}>
                    {' '}
                    {estimate.steps
                      .map(
                        (step) =>
                          `${money(step.baseCents)} × ${(step.rateBp / 100).toLocaleString(locale)} %`,
                      )
                      .join(' + ')}
                  </span>
                </li>
              ))}
            </ul>
            <LinkedActivities outlook={outlook} money={money} />
            <p className={styles.caption}>{t('outlook.disclaimer')}</p>
          </section>
        </div>
      )}
    </>
  );
}
