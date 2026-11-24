import { type PreparedDeclaration, type PrepareMethod, parseAmount } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { Link } from 'react-router';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Button } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { TableScroll } from '../../components/TableScroll/TableScroll.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { api } from '../../lib/api.ts';
import { centsToInput, formatDate, formatMoney } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { useAction } from '../settings/useAction.ts';
import styles from './Planning.module.css';
import { type DeadlineDetail, labelOf } from './types.ts';

interface PreparedProps {
  prepared: PreparedDeclaration;
  ruleId: string;
  money: (cents: number) => string;
  onSaved: () => void;
}

/**
 * Figures to copy into each box of the form, with a copy button per box
 *
 * @param props {PreparedProps} - prepared declaration and money formatter
 * @returns {JSX.Element | null} - the section, null without lines
 */
export function PreparedLines({ prepared, money }: PreparedProps) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState<string>();
  if (prepared.lines.length === 0) return null;
  return (
    <section className={form.section} aria-labelledby="declare-title">
      <h2 id="declare-title" className={styles.sectionTitle}>
        {t('prepared.declare')}
      </h2>
      <p className={styles.caption}>
        {t(`prepared.basis.${prepared.basis}`, {
          from: formatDate(prepared.periodStart, locale),
          to: formatDate(prepared.periodEnd, locale),
        })}
      </p>
      <TableScroll>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('prepared.box')}</th>
              <th scope="col">{t('prepared.amount')}</th>
              <th scope="col">
                <span className="visually-hidden">{t('prepared.copy')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {prepared.lines.map((line) => (
              <tr key={line.id}>
                <th scope="row">{labelOf(line.label, locale)}</th>
                <td>{line.cents === null ? t('prepared.notTracked') : money(line.cents)}</td>
                <td>
                  {line.cents !== null && (
                    <Button
                      variant="subtle"
                      aria-label={t('prepared.copyLine', { label: labelOf(line.label, locale) })}
                      onClick={() => {
                        void navigator.clipboard?.writeText(centsToInput(line.cents, locale));
                        setCopied(line.id);
                      }}
                    >
                      {copied === line.id ? t('prepared.copied') : t('prepared.copy')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {prepared.note && <p className={styles.caption}>{labelOf(prepared.note, locale)}</p>}
      <p className={styles.caption}>
        <a href={prepared.source} target="_blank" rel="noreferrer">
          {t('deadline.source')}
        </a>{' '}
        · {t('deadline.verifiedOn', { date: formatDate(prepared.verifiedOn, locale) })}
      </p>
    </section>
  );
}

/**
 * Amount to pay, its steps and the notice form (amount from a notice, previous year's tax, method)
 *
 * @param props {PreparedProps} - prepared declaration, rule, money formatter and refresh callback
 * @returns {JSX.Element | null} - the section, null when the deadline prepares no amount
 */
export function PreparedAmount({ prepared, ruleId, money, onSaved }: PreparedProps) {
  const { t, locale } = useI18n();
  const amount = prepared.amount;
  const notice = prepared.notice;
  const [values, setValues] = useState({
    method: notice?.method ?? amount?.method ?? 'estimates',
    perOccurrence: centsToInput(notice?.perOccurrenceCents ?? null, locale),
    priorTax: centsToInput(notice?.priorYearTaxCents ?? null, locale),
    priorIncome: centsToInput(notice?.priorYearIncomeCents ?? null, locale),
  });
  const [invalid, setInvalid] = useState(false);
  const action = useAction();
  if (!amount) return null;
  const method = values.method as PrepareMethod;

  /**
   * Saves the notice of this rule and fiscal year
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const cents = (value: string) => (value.trim() ? parseAmount(value) : null);
    const body = {
      method: values.method,
      perOccurrenceCents: cents(values.perOccurrence),
      priorYearTaxCents: cents(values.priorTax),
      priorYearIncomeCents: cents(values.priorIncome),
      note: '',
    };
    const typed = [values.perOccurrence, values.priorTax, values.priorIncome];
    if (
      typed.some(
        (value, index) =>
          value.trim() &&
          [body.perOccurrenceCents, body.priorYearTaxCents, body.priorYearIncomeCents][index] === null,
      )
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    await action.run(async () => {
      await api(`/api/deadline-notices/${ruleId}/${prepared.fiscalYear}`, { method: 'PUT', body });
      onSaved();
    });
  }

  /**
   * Label of a step: a line of the form, or a step of the method
   *
   * @param step {{ kind: string; rateBp?: number }} - the step
   * @returns {string} - its label
   */
  const stepLabel = (step: { kind: string; rateBp?: number }): string => {
    const line = prepared.lines.find((item) => item.id === step.kind);
    if (line) return labelOf(line.label, locale);
    return t(`prepared.step.${step.kind}` as MessageKey, {
      rate: step.rateBp === undefined ? '' : (step.rateBp / 100).toLocaleString(locale),
    });
  };
  const asksNotice = amount.alternatives.some(
    (item) => item === 'user_entered' || item === 'prior_year_share',
  );
  return (
    <>
      <section className={form.section} aria-labelledby="pay-title">
        <h2 id="pay-title" className={styles.sectionTitle}>
          {t('prepared.pay')}
        </h2>
        {amount.cents === null ? (
          <p className={styles.text}>{t(`prepared.missing.${amount.method}`)}</p>
        ) : (
          <p className={styles.figure}>{money(amount.cents)}</p>
        )}
        <p className={styles.caption}>{t(`prepared.method.${amount.method}`)}</p>
        {amount.steps.length > 0 && (
          <ul className={styles.plain}>
            {amount.steps.map((step) => (
              <li key={step.kind}>
                {stepLabel(step)} : <strong>{money(step.cents)}</strong>
              </li>
            ))}
          </ul>
        )}
        {amount.warning && <Notice tone="info">{labelOf(amount.warning, locale)}</Notice>}
      </section>
      {(asksNotice || amount.alternatives.length > 1) && (
        <form onSubmit={(event) => void submit(event)} noValidate>
          <SettingsSection
            title={t('prepared.notice')}
            description={t('prepared.notice.hint', { year: prepared.fiscalYear })}
            footer={
              <ActionBar primaryLabel={t('common.save')} busy={action.busy} feedback={action.feedback} />
            }
          >
            <div className={form.grid}>
              {amount.alternatives.length > 1 && (
                <SelectField
                  label={t('prepared.method')}
                  value={values.method}
                  onChange={(event) => setValues({ ...values, method: event.target.value as PrepareMethod })}
                >
                  {amount.alternatives.map((item) => (
                    <option key={item} value={item}>
                      {t(`prepared.method.${item}`)}
                    </option>
                  ))}
                </SelectField>
              )}
              {method === 'user_entered' && (
                <TextField
                  label={t('prepared.perOccurrence')}
                  inputMode="decimal"
                  value={values.perOccurrence}
                  error={invalid ? t('errors.amount') : undefined}
                  onChange={(event) => setValues({ ...values, perOccurrence: event.target.value })}
                />
              )}
              {method === 'prior_year_share' && (
                <TextField
                  label={t('prepared.priorTax')}
                  inputMode="decimal"
                  value={values.priorTax}
                  error={invalid ? t('errors.amount') : undefined}
                  onChange={(event) => setValues({ ...values, priorTax: event.target.value })}
                />
              )}
              {method === 'prior_year_share' && amount.asksIncome && (
                <TextField
                  label={t('prepared.priorIncome')}
                  hint={t('prepared.priorIncome.hint')}
                  inputMode="decimal"
                  value={values.priorIncome}
                  onChange={(event) => setValues({ ...values, priorIncome: event.target.value })}
                />
              )}
            </div>
          </SettingsSection>
        </form>
      )}
    </>
  );
}

/**
 * Dashboard card: the next deadline not done that has a prepared declaration
 *
 * @returns {JSX.Element | null} - the card, null when there is none
 */
export function NextDeclarationCard() {
  const { t, locale } = useI18n();
  const { data } = useResource<{ deadline: DeadlineDetail | null }>('/api/deadlines/next-prepared');
  const deadline = data?.deadline;
  if (!deadline?.prepared) return null;
  const cents = deadline.prepared.amount?.cents;
  return (
    <section className={form.section} aria-labelledby="next-declaration-title">
      <h2 id="next-declaration-title" className={styles.sectionTitle}>
        {t('prepared.next')}
      </h2>
      <p className={styles.text}>
        <Link to={`/calendar/${encodeURIComponent(deadline.occurrence.key)}`}>
          {labelOf(deadline.occurrence.label, locale)}
        </Link>{' '}
        · {formatDate(deadline.occurrence.due, locale)}
      </p>
      {typeof cents === 'number' && (
        <p className={styles.figure}>{formatMoney(cents, deadline.currency, locale)}</p>
      )}
    </section>
  );
}
