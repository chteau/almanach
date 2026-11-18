import type { PaymentView } from '@almanach/shared';
import { Link } from 'react-router';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import list from '../../components/RowList/RowList.module.css';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { formatDate, formatMoney } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';

/**
 * Every payment received, newest first (P16)
 *
 * @returns {JSX.Element} - the page
 */
export function PaymentsPage() {
  const { t, locale } = useI18n();
  const { data, error, loading, reload } = useResource<{ payments: PaymentView[] }>('/api/payments');
  const payments = data?.payments ?? [];
  return (
    <>
      <PageHeader title={t('payments.title')} />
      {loading && !data && <Skeleton />}
      {error !== undefined && <LoadError error={error} onRetry={reload} />}
      {data && payments.length === 0 && (
        <EmptyState title={t('payments.empty.title')} body={t('payments.empty.body')} />
      )}
      {payments.length > 0 && (
        <ul className={list.list}>
          {payments.map((payment) => (
            <li key={payment.id} className={list.item}>
              <Link to={`/documents/${payment.documentId}`} className={list.row}>
                <span className={list.primary}>
                  <strong>{payment.documentNumber}</strong>
                  <span className={list.secondary}>{payment.clientName}</span>
                </span>
                <span className={list.secondary}>{formatDate(payment.date, locale)}</span>
                <span className={list.secondary}>{t(`payments.method.${payment.method}`)}</span>
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
