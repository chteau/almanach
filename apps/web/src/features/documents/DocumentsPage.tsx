import { type DocumentView, daysBetween } from '@almanach/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import buttonStyles from '../../components/Button/Button.module.css';
import { Button } from '../../components/Button/Button.tsx';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { formatDate, formatMoney, today } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { STATUS_TONE, toCsv } from './labels.ts';

type Kind = 'invoice' | 'quote' | 'credit_note';

const STATUSES: Record<Kind, string[]> = {
  invoice: ['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled'],
  quote: ['draft', 'sent', 'accepted', 'declined', 'expired'],
  credit_note: ['draft', 'issued'],
};

/**
 * Lists invoices, quotes or credit notes with filters, per-currency totals and CSV export
 * (P12, P13: S-150 to S-154)
 *
 * @param props {{ kind: Kind }} - which documents to list
 * @returns {JSX.Element} - the page
 */
export function DocumentsPage({ kind }: { kind: Kind }) {
  const { t, locale } = useI18n();
  const now = today();
  const { data, error, loading, reload } = useResource<{ documents: DocumentView[] }>(
    `/api/documents?type=${kind}&today=${now}`,
  );
  const [status, setStatus] = useState('');
  const [client, setClient] = useState('');
  const [currency, setCurrency] = useState('');
  const [year, setYear] = useState('');
  const docs = data?.documents ?? [];

  const clients = useMemo(
    () => [...new Map(docs.map((doc) => [doc.clientId, doc.clientName])).entries()],
    [docs],
  );
  const currencies = [...new Set(docs.map((doc) => doc.currency))];
  const years = [...new Set(docs.map((doc) => doc.issueDate.slice(0, 4)))];
  const visible = docs.filter(
    (doc) =>
      (!status || doc.status === status) &&
      (!client || doc.clientId === client) &&
      (!currency || doc.currency === currency) &&
      (!year || doc.issueDate.startsWith(year)),
  );

  const totals = new Map<string, { billed: number; paid: number; due: number }>();
  for (const doc of visible) {
    if (doc.state === 'draft') continue;
    const entry = totals.get(doc.currency) ?? { billed: 0, paid: 0, due: 0 };
    entry.billed += doc.totals.totalCents;
    entry.paid += doc.paidCents;
    entry.due += Math.max(0, doc.totals.totalCents - doc.creditedCents - doc.paidCents);
    totals.set(doc.currency, entry);
  }

  /**
   * Downloads the visible documents as CSV (S-153)
   *
   * @returns {void} - nothing
   */
  function exportCsv(): void {
    const rows: (string | number)[][] = [
      ['number', 'status', 'client', 'issue_date', 'due_date', 'currency', 'net', 'vat', 'total', 'paid'],
      ...visible.map((doc) => [
        doc.number ?? '',
        doc.status,
        doc.clientName,
        doc.issueDate,
        doc.dueDate ?? '',
        doc.currency,
        (doc.totals.netCents / 100).toFixed(2),
        (doc.totals.vatCents / 100).toFixed(2),
        (doc.totals.totalCents / 100).toFixed(2),
        (doc.paidCents / 100).toFixed(2),
      ]),
    ];
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `almanach-${kind}-${now}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const newButton =
    kind === 'credit_note' ? null : (
      <Link to={`/documents/new?type=${kind}`} className={`${buttonStyles.button} ${buttonStyles.primary}`}>
        {t(`documents.new.${kind}`)}
      </Link>
    );

  return (
    <>
      <PageHeader title={t(`documents.title.${kind}`)}>
        {docs.length > 0 && (
          <Button variant="ghost" onClick={exportCsv}>
            {t('documents.exportCsv')}
          </Button>
        )}
        {docs.length > 0 && newButton}
      </PageHeader>
      {loading && !data && <Skeleton />}
      {error !== undefined && <LoadError error={error} onRetry={reload} />}
      {data && docs.length === 0 && (
        <EmptyState title={t(`documents.empty.title.${kind}`)} body={t(`documents.empty.body.${kind}`)}>
          {newButton}
        </EmptyState>
      )}
      {docs.length > 0 && (
        <>
          <search className={list.toolbar}>
            <SelectField
              label={t('documents.status')}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">{t('common.all')}</option>
              {STATUSES[kind].map((value) => (
                <option key={value} value={value}>
                  {t(`documents.status.${value}` as 'documents.status.draft')}
                </option>
              ))}
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
              label={t('documents.year')}
              value={year}
              onChange={(event) => setYear(event.target.value)}
            >
              <option value="">{t('common.all')}</option>
              {years.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </SelectField>
            {currencies.length > 1 && (
              <SelectField
                label={t('clients.currency')}
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                <option value="">{t('common.all')}</option>
                {currencies.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </SelectField>
            )}
          </search>
          <p className={list.count} aria-live="polite">
            {t('common.results', { count: visible.length })}
          </p>
          {visible.length > 0 && (
            <ul className={list.list}>
              {visible.map((doc) => (
                <li key={doc.id} className={list.item}>
                  <Link to={`/documents/${doc.id}`} className={list.row}>
                    <span className={list.primary}>
                      <strong>{doc.number ?? t('documents.status.draft')}</strong>
                      <span className={list.secondary}>{doc.clientName}</span>
                    </span>
                    <span className={list.secondary}>{formatDate(doc.issueDate, locale)}</span>
                    <span className={list.secondary}>
                      {formatMoney(doc.totals.totalCents, doc.currency, locale)}
                    </span>
                    <span className={list.badges}>
                      {doc.type === 'deposit' && <Badge>{t('documents.type.deposit')}</Badge>}
                      <Badge tone={STATUS_TONE[doc.status]}>
                        {t(`documents.status.${doc.status}` as 'documents.status.draft')}
                      </Badge>
                      {doc.status === 'overdue' && doc.dueDate && (
                        <Badge tone="err">
                          {t('documents.lateDays', { days: daysBetween(doc.dueDate, now) })}
                        </Badge>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {totals.size > 0 && kind === 'invoice' && (
            <section className={form.section} aria-label={t('documents.totals')}>
              <dl className={form.facts}>
                {[...totals.entries()].flatMap(([code, entry]) => [
                  <div key={`${code}-b`}>
                    <dt>{t('documents.totals.billed', { currency: code })}</dt>
                    <dd>{formatMoney(entry.billed, code, locale)}</dd>
                  </div>,
                  <div key={`${code}-p`}>
                    <dt>{t('documents.totals.paid', { currency: code })}</dt>
                    <dd>{formatMoney(entry.paid, code, locale)}</dd>
                  </div>,
                  <div key={`${code}-d`}>
                    <dt>{t('documents.totals.due', { currency: code })}</dt>
                    <dd>{formatMoney(entry.due, code, locale)}</dd>
                  </div>,
                ])}
              </dl>
            </section>
          )}
        </>
      )}
    </>
  );
}
