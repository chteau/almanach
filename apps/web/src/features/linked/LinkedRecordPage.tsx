import { type LinkedRecords, QUANTITY_SCALE } from '@almanach/shared';
import type { ReactNode } from 'react';
import { useParams } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import buttonStyles from '../../components/Button/Button.module.css';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { countryName, formatDate, formatMoney } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { STATUS_TONE } from '../documents/labels.ts';
import styles from '../planning/Planning.module.css';
import { type LinkedKind, originUrl } from './activity.ts';
import { DevBadge } from './TestData.tsx';

/**
 * Read-only record of a client, document or payment received from a linked instance: no edit, no delete, no
 * PDF, and a link to the record on its instance of origin when its address is known
 *
 * @returns {JSX.Element} - the page
 */
export function LinkedRecordPage() {
  const { kind = '', linkId = '', id = '' } = useParams();
  const { t, locale } = useI18n();
  const { data, error, reload } = useResource<LinkedRecords>('/api/linked');
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton />;
  const source = data.sources.find((item) => item.id === linkId);
  const pick = <T extends { id: string; linkId: string }>(items: T[]) =>
    items.find((item) => item.id === id && item.linkId === linkId);
  const client = kind === 'client' ? pick(data.clients) : undefined;
  const doc = kind === 'document' ? pick(data.documents) : undefined;
  const payment = kind === 'payment' ? pick(data.payments) : undefined;
  const record = client ?? doc ?? payment;
  if (!source || !record) return <EmptyState title={t('linked.gone')} body={t('linked.gone.body')} />;

  const date = (value: string | null) => (value ? formatDate(value, locale) : '—');
  const facts: [string, ReactNode][] = client
    ? [
        [t('clients.email'), client.email ?? '—'],
        [t('clients.country'), countryName(client.country, locale)],
        [t('clients.siret'), client.siret ?? '—'],
        [t('clients.vat'), client.vatNumber ?? '—'],
      ]
    : doc
      ? [
          [t('linked.client'), doc.clientName],
          [t('documents.issueDate'), date(doc.issueDate)],
          [
            doc.type === 'quote' ? t('documents.validUntil') : t('documents.dueDate'),
            date(doc.type === 'quote' ? doc.validUntil : doc.dueDate),
          ],
          [t('documents.net'), formatMoney(doc.netCents, doc.currency, locale)],
          [t('documents.total'), formatMoney(doc.totalCents, doc.currency, locale)],
          ...(doc.type === 'quote'
            ? []
            : ([
                [t('linked.paid'), formatMoney(doc.paidCents, doc.currency, locale)],
                [t('linked.due'), formatMoney(doc.dueCents, doc.currency, locale)],
              ] as [string, ReactNode][])),
        ]
      : payment
        ? [
            [t('payments.date'), date(payment.date)],
            [t('payments.amount'), formatMoney(payment.amountCents, payment.currency, locale)],
            [t('linked.client'), payment.clientName ?? '—'],
            [t('linked.document'), payment.documentNumber ?? '—'],
            [t('payments.reference'), payment.reference ?? '—'],
          ]
        : [];
  const title =
    client?.name ?? doc?.number ?? (payment && formatMoney(payment.amountCents, payment.currency, locale));
  const origin = originUrl(source.url, kind as LinkedKind, record);

  return (
    <>
      <PageHeader title={title ?? '—'}>
        <button
          type="button"
          className={`${buttonStyles.button} ${buttonStyles.ghost}`}
          onClick={() => history.back()}
        >
          {t('common.back')}
        </button>
        {origin && (
          <a
            href={origin}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonStyles.button} ${buttonStyles.ghost}`}
          >
            {t('linked.open')}
          </a>
        )}
      </PageHeader>
      <Notice tone="info">{t('linked.readOnly', { label: source.label })}</Notice>
      <section className={form.section}>
        <p>
          <Badge tone="accent">{source.label}</Badge> {record.origin && <Badge>{record.origin}</Badge>}{' '}
          {record.test && <DevBadge />}{' '}
          {doc && (
            <>
              <Badge>{t(`documents.type.${doc.type}`)}</Badge>{' '}
              <Badge tone={STATUS_TONE[doc.status]}>
                {t(`documents.status.${doc.status}` as MessageKey)}
              </Badge>
            </>
          )}
          {payment?.source === 'stripe' && <Badge>{t('linked.source.stripe')}</Badge>}
        </p>
        <dl className={form.facts}>
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {doc && (
          <>
            <h2 className={styles.sectionTitle}>{t('linked.lines')}</h2>
            {doc.lines ? (
              <ul>
                {doc.lines.map((line, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a read-only snapshot, never reordered
                  <li key={index}>
                    {line.description} — {(line.quantity / QUANTITY_SCALE).toLocaleString(locale)}{' '}
                    {t(`documents.unit.${line.unit}` as MessageKey)} ×{' '}
                    {formatMoney(line.unitPriceCents, doc.currency, locale)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={form.summary}>{t('linked.lines.none')}</p>
            )}
          </>
        )}
      </section>
    </>
  );
}
