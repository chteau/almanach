import { type DocumentView, PAYMENT_METHODS, type PaymentView, parseAmount } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { centsToInput, formatDate, formatMoney, today } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';
import { useProfile } from '../profile/useProfile.ts';
import styles from './DocumentEditor.module.css';
import { STATUS_TONE } from './labels.ts';

/**
 * Issued document: PDF, sending, quote answers and conversion, payments and credit notes
 * (P12, P15, P16, P17)
 *
 * @param props {{ document: DocumentView; onChange: () => void }} - the document and a reload callback
 * @returns {JSX.Element} - the page
 */
export function DocumentDetail({
  document: doc,
  onChange,
}: {
  document: DocumentView;
  onChange: () => void;
}) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const profile = useProfile();
  const allPayments = useResource<{ payments: PaymentView[] }>(
    doc.type === 'invoice' || doc.type === 'deposit' ? '/api/payments' : null,
  );
  const [failure, setFailure] = useState<string>();
  const [confirm, setConfirm] = useState<null | {
    title: string;
    body: string;
    label: string;
    danger?: boolean;
    run: () => Promise<void>;
  }>(null);
  const money = (cents: number) => formatMoney(cents, doc.currency, locale);
  const payments = (allPayments.data?.payments ?? []).filter((payment) => payment.documentId === doc.id);
  const dueCents = Math.max(0, doc.totals.totalCents - doc.creditedCents - doc.paidCents);
  const payable = (doc.type === 'invoice' || doc.type === 'deposit') && doc.status !== 'cancelled';

  /**
   * Runs an action and reports failures
   *
   * @param action {() => Promise<void>} - the action
   * @returns {Promise<void>} - resolves when done
   */
  async function run(action: () => Promise<void>): Promise<void> {
    setFailure(undefined);
    try {
      await action();
    } catch (error) {
      setFailure(describeError(error, t));
    }
  }

  /**
   * Creates a derived draft (duplicate, invoice from quote, deposit, credit note) and opens it
   *
   * @param as {'duplicate' | 'invoice' | 'deposit' | 'credit_note'} - what to create
   * @returns {Promise<void>} - resolves when navigated
   */
  async function derive(as: 'duplicate' | 'invoice' | 'deposit' | 'credit_note'): Promise<void> {
    const { id } = await api<{ id: string }>(`/api/documents/${doc.id}/derive`, {
      method: 'POST',
      body: { as },
    });
    navigate(`/documents/${id}`);
  }

  const facts: [string, string][] = [
    [t('missions.client'), doc.clientName],
    [t('documents.issueDate'), formatDate(doc.issueDate, locale)],
    ...(doc.dueDate
      ? ([[t('documents.dueDate'), formatDate(doc.dueDate, locale)]] as [string, string][])
      : []),
    ...(doc.validUntil
      ? ([[t('documents.validUntil'), formatDate(doc.validUntil, locale)]] as [string, string][])
      : []),
    [t('documents.net'), money(doc.totals.netCents)],
    ...(doc.totals.vatRateBp > 0
      ? ([[t('documents.vat', { rate: doc.totals.vatRateBp / 100 }), money(doc.totals.vatCents)]] as [
          string,
          string,
        ][])
      : []),
    [t('documents.total'), money(doc.totals.totalCents)],
    ...(payable
      ? ([
          [t('documents.paid'), money(doc.paidCents)],
          [t('documents.due'), money(dueCents)],
        ] as [string, string][])
      : []),
    ...(doc.creditedCents > 0
      ? ([[t('documents.credited'), money(doc.creditedCents)]] as [string, string][])
      : []),
    [t('documents.sent'), doc.sentAt ? formatDate(doc.sentAt.slice(0, 10), locale) : t('documents.notSent')],
  ];

  return (
    <>
      <PageHeader
        title={`${t(`documents.type.${doc.type}`)} ${doc.number ?? ''}`}
        subtitle={
          <Badge tone={STATUS_TONE[doc.status]}>
            {t(`documents.status.${doc.status}` as 'documents.status.draft')}
          </Badge>
        }
      >
        <a href={`/api/documents/${doc.id}/pdf?download=1`} className={`${styles.link}`}>
          {t('documents.downloadPdf')}
        </a>
        {!doc.sentAt && (
          <Button
            variant="ghost"
            onClick={() =>
              void run(async () => {
                await api(`/api/documents/${doc.id}/sent`, { method: 'POST' });
                onChange();
              })
            }
          >
            {t('documents.markSent')}
          </Button>
        )}
      </PageHeader>
      <div className={form.form}>
        {failure && <Notice tone="error">{failure}</Notice>}
        <Notice tone="info">{t('documents.frozen')}</Notice>
        <section className={form.section} aria-label={t('documents.section.totals')}>
          <dl className={form.facts}>
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {doc.mentions.map((mention) => (
            <p key={mention} className={styles.mention}>
              {mention}
            </p>
          ))}
        </section>

        <div className={form.actions}>
          {doc.type === 'quote' && doc.status !== 'accepted' && (
            <>
              <Button
                variant="ghost"
                onClick={() =>
                  void run(async () => {
                    await api(`/api/documents/${doc.id}/answer`, {
                      method: 'POST',
                      body: { answer: 'declined' },
                    });
                    onChange();
                  })
                }
              >
                {t('documents.quote.decline')}
              </Button>
              <Button variant="ghost" onClick={() => void run(() => derive('deposit'))}>
                {t('documents.quote.toDeposit')}
              </Button>
              <Button onClick={() => void run(() => derive('invoice'))}>
                {t('documents.quote.toInvoice')}
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => void run(() => derive('duplicate'))}>
            {t('documents.duplicate')}
          </Button>
          {payable && doc.totals.totalCents > doc.creditedCents && (
            <Button
              variant="ghost"
              onClick={() =>
                setConfirm({
                  title: t('documents.creditNote'),
                  body: t('documents.creditNote.body'),
                  label: t('documents.creditNote'),
                  run: () => derive('credit_note'),
                })
              }
            >
              {t('documents.creditNote')}
            </Button>
          )}
        </div>

        {payable && (
          <section className={form.section} aria-labelledby="payments-title">
            <h2 id="payments-title" className={styles.sectionTitle}>
              {t('payments.title')}
            </h2>
            {payments.length === 0 ? (
              <p className={form.summary}>{t('payments.none')}</p>
            ) : (
              <ul className={styles.payments}>
                {payments.map((payment) => (
                  <li key={payment.id} className={styles.payment}>
                    <span>
                      {formatDate(payment.date, locale)} · {t(`payments.method.${payment.method}`)}
                      {payment.reference ? ` · ${payment.reference}` : ''}
                    </span>
                    <strong>{money(payment.amountCents)}</strong>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setConfirm({
                          title: t('payments.delete'),
                          body: t('payments.delete.body'),
                          label: t('common.delete'),
                          danger: true,
                          run: async () => {
                            await api(`/api/payments/${payment.id}`, { method: 'DELETE' });
                            allPayments.reload();
                            onChange();
                          },
                        })
                      }
                    >
                      {t('common.delete')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {dueCents > 0 && (
              <PaymentForm
                document={doc}
                dueCents={dueCents}
                mainCurrency={profile?.currency ?? doc.currency}
                onSaved={() => {
                  allPayments.reload();
                  onChange();
                }}
              />
            )}
          </section>
        )}
        {doc.relatedId && (
          <p className={form.summary}>
            <Link to={`/documents/${doc.relatedId}`}>{t('documents.related')}</Link>
          </p>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        body={confirm?.body ?? ''}
        confirmLabel={confirm?.label ?? ''}
        danger={confirm?.danger}
        onConfirm={() => {
          const action = confirm?.run;
          setConfirm(null);
          if (action) void run(action);
        }}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

interface PaymentFormProps {
  document: DocumentView;
  dueCents: number;
  mainCurrency: string;
  onSaved: () => void;
}

/**
 * Records a payment: full or partial, overpayment warning, foreign currency and bank fees (S-190 to S-194)
 *
 * @param props {PaymentFormProps} - invoice, amount due, main currency and callback
 * @returns {JSX.Element} - the form
 */
function PaymentForm({ document: doc, dueCents, mainCurrency, onSaved }: PaymentFormProps) {
  const { t, locale } = useI18n();
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState(centsToInput(dueCents, locale));
  const [received, setReceived] = useState('');
  const [fees, setFees] = useState('');
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('transfer');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string>();
  const foreign = doc.currency !== mainCurrency;
  const amountCents = parseAmount(amount);

  /**
   * Validates and sends the payment
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const receivedCents = received.trim() ? parseAmount(received) : null;
    const feesCents = fees.trim() ? parseAmount(fees) : 0;
    if (!amountCents || (received.trim() && receivedCents === null) || feesCents === null) {
      setError(t('errors.amount'));
      return;
    }
    try {
      await api(`/api/documents/${doc.id}/payments`, {
        method: 'POST',
        body: { date, amountCents, receivedCents, feesCents, method, reference },
      });
      setError(undefined);
      onSaved();
    } catch (failure) {
      setError(describeError(failure, t));
    }
  }

  return (
    <form
      className={form.form}
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-labelledby="payment-form-title"
    >
      <h3 id="payment-form-title" className={styles.sectionTitle}>
        {t('payments.add')}
      </h3>
      {error && <Notice tone="error">{error}</Notice>}
      {amountCents !== null && amountCents > dueCents && (
        <Notice tone="warn">
          {t('payments.overpaid', { amount: formatMoney(amountCents - dueCents, doc.currency, locale) })}
        </Notice>
      )}
      <div className={form.grid}>
        <TextField
          label={t('payments.date')}
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
        <TextField
          label={t('payments.amount', { currency: doc.currency })}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
        <SelectField
          label={t('payments.method')}
          value={method}
          onChange={(event) => setMethod(event.target.value as typeof method)}
        >
          {PAYMENT_METHODS.map((value) => (
            <option key={value} value={value}>
              {t(`payments.method.${value}`)}
            </option>
          ))}
        </SelectField>
        <TextField
          label={`${t('payments.reference')} ${t('common.optional')}`}
          value={reference}
          maxLength={120}
          onChange={(event) => setReference(event.target.value)}
        />
        {foreign && (
          <TextField
            label={t('payments.received', { currency: mainCurrency })}
            hint={t('payments.received.hint')}
            inputMode="decimal"
            value={received}
            onChange={(event) => setReceived(event.target.value)}
          />
        )}
        <TextField
          label={`${t('payments.fees', { currency: doc.currency })} ${t('common.optional')}`}
          hint={t('payments.fees.hint')}
          inputMode="decimal"
          value={fees}
          onChange={(event) => setFees(event.target.value)}
        />
      </div>
      <div className={form.actions}>
        <Button type="submit">{t('payments.save')}</Button>
      </div>
    </form>
  );
}
