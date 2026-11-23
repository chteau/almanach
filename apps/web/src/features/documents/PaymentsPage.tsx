import type { LinkedRecords, PaymentView } from '@almanach/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import list from '../../components/RowList/RowList.module.css';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { formatDate, formatMoney } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { ActivityFilter } from '../linked/ActivityFilter.tsx';
import { labelsOf, linkedPath, showsLink, showsLocal } from '../linked/activity.ts';
import { DevBadge, HideTestToggle, useHideTest } from '../linked/TestData.tsx';

/** A payment of this instance, or one received read-only from a linked instance (with its activity label). */
interface Row {
  key: string;
  to: string;
  title: string;
  clientName: string;
  date: string;
  method: string;
  amountCents: number;
  currency: string;
  linkId?: string;
  source?: string;
  /** Test data (Stripe test mode): greyed with a DEV pill. */
  test?: boolean;
}

/**
 * Every payment received, newest first (P16); payments and Stripe receipts of linked instances show read-only
 * with their activity badge
 *
 * @returns {JSX.Element} - the page
 */
export function PaymentsPage() {
  const { t, locale } = useI18n();
  const { data, error, loading, reload } = useResource<{ payments: PaymentView[] }>('/api/payments');
  const linked = useResource<LinkedRecords>('/api/linked').data;
  const [activity, setActivity] = useState('');
  const [hideTest, setHideTest] = useHideTest();
  const payments = useMemo<Row[]>(() => {
    const labels = labelsOf(linked);
    return [
      ...(data?.payments ?? []).map((payment) => ({
        key: payment.id,
        to: `/documents/${payment.documentId}`,
        title: payment.documentNumber ?? '—',
        clientName: payment.clientName,
        date: payment.date,
        method: t(`payments.method.${payment.method}`),
        amountCents: payment.amountCents,
        currency: payment.currency,
      })),
      ...(linked?.payments ?? []).map((payment) => ({
        key: `${payment.linkId}:${payment.id}`,
        to: linkedPath('payment', payment.linkId, payment.id),
        title: payment.documentNumber ?? payment.reference ?? '—',
        clientName: payment.clientName ?? '—',
        date: payment.date,
        method: payment.source === 'stripe' ? t('linked.source.stripe') : '—',
        amountCents: payment.amountCents,
        currency: payment.currency,
        linkId: payment.linkId,
        source: labels.get(payment.linkId) ?? '',
        test: payment.test === true,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date));
  }, [data, linked, t]);
  const visible = payments.filter(
    (payment) =>
      (payment.linkId ? showsLink(activity, payment.linkId) : showsLocal(activity)) &&
      (!hideTest || !payment.test),
  );
  return (
    <>
      <PageHeader title={t('payments.title')} />
      {loading && !data && <Skeleton />}
      {error !== undefined && <LoadError error={error} onRetry={reload} />}
      {data && payments.length === 0 && (
        <EmptyState title={t('payments.empty.title')} body={t('payments.empty.body')} />
      )}
      {linked && linked.sources.length > 0 && payments.length > 0 && (
        <search className={list.toolbar}>
          <ActivityFilter linked={linked} value={activity} onChange={setActivity} />
          <HideTestToggle
            shown={payments.some((payment) => payment.test)}
            value={hideTest}
            onChange={setHideTest}
          />
        </search>
      )}
      {visible.length > 0 && (
        <ul className={list.list}>
          {visible.map((payment) => (
            <li key={payment.key} className={payment.test ? `${list.item} ${list.test}` : list.item}>
              <Link to={payment.to} className={list.row}>
                <span className={list.primary}>
                  <strong>{payment.title}</strong>
                  <span className={list.secondary}>{payment.clientName}</span>
                </span>
                <span className={list.secondary}>{formatDate(payment.date, locale)}</span>
                <span className={list.secondary}>
                  {payment.method}
                  {payment.source !== undefined && (
                    <>
                      {' '}
                      <Badge tone="accent">{payment.source}</Badge>
                      {payment.test && <DevBadge />}
                    </>
                  )}
                </span>
                <strong className={list.amount}>
                  {formatMoney(payment.amountCents, payment.currency, locale)}
                </strong>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
