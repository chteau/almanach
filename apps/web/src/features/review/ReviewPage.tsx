import type { WeeklyReview } from '@almanach/shared';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/Button/Button.tsx';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { Row } from '../../components/Row/Row.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { formatDate, formatMoney } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { labelOf } from '../planning/types.ts';
import styles from './Review.module.css';

/**
 * Weekly review: what to do this week, deadlines, money in, quotes, thresholds and reserve, printable
 *
 * @returns {JSX.Element} - the page
 */
export function ReviewPage() {
  const { t, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const date = params.get('date');
  const { data, error, loading, reload } = useResource<{ review: WeeklyReview }>(
    `/api/review/weekly${date ? `?date=${date}` : ''}`,
  );
  const review = data?.review;
  const money = (cents: number, currency = review?.currency ?? 'EUR') => formatMoney(cents, currency, locale);
  const title = t('review.title');

  if (error !== undefined)
    return (
      <>
        <PageHeader title={title} />
        <LoadError error={error} onRetry={reload} />
      </>
    );
  if (loading && !review)
    return (
      <>
        <PageHeader title={title} />
        <Skeleton rows={6} />
      </>
    );
  if (!review) return null;

  return (
    <>
      <PageHeader
        title={title}
        subtitle={t('review.week', {
          from: formatDate(review.week.start, locale),
          to: formatDate(review.week.end, locale),
        })}
      >
        <Button variant="ghost" onClick={() => window.print()} className={styles.noPrint}>
          {t('review.print')}
        </Button>
      </PageHeader>
      <div className={styles.page}>
        <div className={styles.noPrint}>
          <TextField
            label={t('review.date')}
            type="date"
            value={date ?? review.week.today}
            onChange={(event) => event.target.value && setParams({ date: event.target.value })}
          />
        </div>
        {review.notices.map((notice) => (
          <Notice key={notice} tone="info">
            {t(`review.notice.${notice}`)}
          </Notice>
        ))}

        <SettingsSection title={t('review.actions')} description={t('review.actions.hint')}>
          {review.actions.length === 0 ? (
            <EmptyState inline title={t('review.actions.none')} body={t('review.actions.none.body')} />
          ) : (
            <ul className={styles.list}>
              {review.actions.map((action) => (
                <li key={action.id}>
                  <Row
                    primary={<Link to={action.link}>{labelOf(action.title, locale)}</Link>}
                    meta={[
                      t(`review.why.${action.why}` as MessageKey),
                      action.due && formatDate(action.due, locale),
                      action.amountCents !== null && money(action.amountCents, action.currency ?? undefined),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>

        <SettingsSection title={t('review.cash')}>
          <dl className={styles.facts}>
            <div>
              <dt>{t('review.cash.thisWeek')}</dt>
              <dd>{money(review.cash.collectedThisWeekCents)}</dd>
            </div>
            <div>
              <dt>{t('review.cash.lastWeek')}</dt>
              <dd>{money(review.cash.collectedLastWeekCents)}</dd>
            </div>
            {review.reserve && (
              <div>
                <dt>{t('reserve.title')}</dt>
                <dd>
                  {money(review.reserve.reserveCents)}{' '}
                  <span className={styles.caption}>
                    {t('review.reserve.delta', {
                      amount: `${review.reserve.deltaThisWeekCents >= 0 ? '+' : '−'}${money(Math.abs(review.reserve.deltaThisWeekCents))}`,
                    })}
                  </span>
                </dd>
              </div>
            )}
          </dl>
          {review.cash.invoicesDueThisWeek.length > 0 && (
            <>
              <h3 className={styles.subtitle}>{t('review.invoicesDue')}</h3>
              <ul className={styles.list}>
                {review.cash.invoicesDueThisWeek.map((invoice) => (
                  <li key={invoice.id}>
                    <Row
                      primary={<Link to={`/documents/${invoice.id}`}>{invoice.number}</Link>}
                      meta={`${invoice.clientName} · ${money(invoice.dueCents, invoice.currency)}`}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </SettingsSection>

        {review.quotes.awaitingAnswer.length > 0 && (
          <SettingsSection title={t('review.quotes')}>
            <ul className={styles.list}>
              {review.quotes.awaitingAnswer.map((quote) => (
                <li key={quote.id}>
                  <Row
                    primary={<Link to={`/documents/${quote.id}`}>{quote.number ?? quote.clientName}</Link>}
                    meta={`${quote.clientName} · ${money(quote.totalCents, quote.currency)} · ${t('review.age', { days: quote.ageDays })}`}
                  />
                </li>
              ))}
            </ul>
          </SettingsSection>
        )}

        {review.thresholds.length > 0 && (
          <SettingsSection title={t('nav.thresholds')}>
            <ul className={styles.list}>
              {review.thresholds.map((threshold) => (
                <li key={threshold.id}>
                  <Row
                    primary={<Link to="/thresholds">{labelOf(threshold.label, locale)}</Link>}
                    meta={`${Math.floor(threshold.reachedBp / 100)} %`}
                  />
                </li>
              ))}
            </ul>
          </SettingsSection>
        )}
        <p className={styles.caption}>{t('review.disclaimer')}</p>
      </div>
    </>
  );
}
