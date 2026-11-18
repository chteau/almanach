import { parseAmount } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { centsToInput, formatDate, formatMoney } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';
import styles from './Planning.module.css';
import { type DeadlineDetail, labelOf } from './types.ts';

/**
 * One tax or social obligation: what to declare, estimated amount, official link and source, and the
 * "done" record (P06, S-080 to S-084)
 *
 * @returns {JSX.Element} - the page
 */
export function DeadlinePage() {
  const { key = '' } = useParams();
  const { t, locale } = useI18n();
  const { data, error, loading, reload } = useResource<{ deadline: DeadlineDetail; today: string }>(
    `/api/deadlines/${encodeURIComponent(key)}`,
  );
  const [doneOn, setDoneOn] = useState<string>();
  const [note, setNote] = useState<string>();
  const [actual, setActual] = useState<string>();
  const [failure, setFailure] = useState<string>();

  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton rows={6} />;
  if (!data) return null;
  const { deadline } = data;
  const { occurrence, mark } = deadline;
  const money = (cents: number) => formatMoney(cents, deadline.currency, locale);
  const estimated = deadline.estimates.reduce((sum, item) => sum + item.cents, 0);

  /**
   * Saves the "done" record, or clears it
   *
   * @param event {SyntheticEvent | null} - form submission, null to undo
   * @returns {Promise<void>} - resolves when saved
   */
  async function save(event: SyntheticEvent | null): Promise<void> {
    event?.preventDefault();
    const typed = (actual ?? '').trim();
    const actualCents = typed ? parseAmount(typed) : null;
    if (typed && actualCents === null) {
      setFailure(t('errors.amount'));
      return;
    }
    try {
      await api(`/api/deadlines/${encodeURIComponent(key)}/mark`, {
        method: 'PUT',
        body: event
          ? {
              doneOn: doneOn ?? data?.today ?? null,
              note: note ?? mark?.note ?? '',
              actualCents: actual === undefined ? (mark?.actualCents ?? null) : actualCents,
            }
          : { doneOn: null, note: mark?.note ?? '', actualCents: mark?.actualCents ?? null },
      });
      setFailure(undefined);
      reload();
    } catch (problem) {
      setFailure(describeError(problem, t));
    }
  }

  /**
   * Hides or shows the deadline in the calendar (S-066)
   *
   * @returns {Promise<void>} - resolves when saved
   */
  async function toggleHidden(): Promise<void> {
    try {
      await api(`/api/deadlines/${encodeURIComponent(key)}/hidden`, {
        method: 'PUT',
        body: { hidden: !mark?.hidden },
      });
      reload();
    } catch (problem) {
      setFailure(describeError(problem, t));
    }
  }

  return (
    <>
      <PageHeader
        title={labelOf(occurrence.label, locale)}
        subtitle={
          <>
            {formatDate(occurrence.due, locale)}
            {occurrence.movedFrom &&
              ` · ${t('calendar.movedFrom', { date: formatDate(occurrence.movedFrom, locale) })}`}{' '}
            {mark?.doneOn ? (
              <Badge tone="ok">{t('calendar.doneOn', { date: formatDate(mark.doneOn, locale) })}</Badge>
            ) : occurrence.due < data.today ? (
              <Badge tone="err">{t('calendar.overdue')}</Badge>
            ) : null}
          </>
        }
      >
        <a href={occurrence.link} target="_blank" rel="noreferrer" className={styles.external}>
          {t('deadline.officialSite')}
        </a>
      </PageHeader>
      <div className={form.form}>
        {failure && <Notice tone="error">{failure}</Notice>}
        <section className={form.section} aria-labelledby="what-title">
          <h2 id="what-title" className={styles.sectionTitle}>
            {t('deadline.what')}
          </h2>
          <p className={styles.text}>{labelOf(occurrence.description, locale)}</p>
          {occurrence.periodStart && occurrence.periodEnd && (
            <p className={styles.caption}>
              {t('deadline.period', {
                from: formatDate(occurrence.periodStart, locale),
                to: formatDate(occurrence.periodEnd, locale),
              })}
            </p>
          )}
          {deadline.revenueCents !== null && occurrence.declaresRevenue && (
            <dl className={form.facts}>
              <div>
                <dt>{t('deadline.revenue')}</dt>
                <dd className={styles.figure}>{money(deadline.revenueCents)}</dd>
              </div>
            </dl>
          )}
          {deadline.unconverted > 0 && (
            <Notice tone="warn">{t('outlook.unconverted', { count: deadline.unconverted })}</Notice>
          )}
        </section>

        {deadline.estimates.length > 0 && (
          <section className={form.section} aria-labelledby="estimate-title">
            <h2 id="estimate-title" className={styles.sectionTitle}>
              {t('deadline.estimate')}
            </h2>
            <p className={styles.figure}>{money(estimated)}</p>
            <ul className={styles.plain}>
              {deadline.estimates.map((estimate) => (
                <li key={estimate.id}>
                  <strong>{labelOf(estimate.label, locale)}</strong> : {money(estimate.cents)}
                  {estimate.steps.map((step) => (
                    <span key={`${step.rateBp}-${step.baseCents}`} className={styles.step}>
                      {money(step.baseCents)} × {(step.rateBp / 100).toLocaleString(locale)} % ={' '}
                      {money(step.cents)}
                      {step.reducedShareBp
                        ? ` (${t('deadline.reduced', { share: step.reducedShareBp / 100 })})`
                        : ''}
                    </span>
                  ))}
                  <span className={styles.source}>
                    <a href={estimate.source} target="_blank" rel="noreferrer">
                      {t('deadline.source')}
                    </a>{' '}
                    · {t('deadline.verifiedOn', { date: formatDate(estimate.verifiedOn, locale) })}
                  </span>
                </li>
              ))}
            </ul>
            {mark?.actualCents != null && (
              <p className={styles.text}>
                {t('deadline.actualVsEstimate', {
                  actual: money(mark.actualCents),
                  difference: `${mark.actualCents - estimated >= 0 ? '+' : '−'}${money(Math.abs(mark.actualCents - estimated))}`,
                })}
              </p>
            )}
            <p className={styles.caption}>{t('outlook.disclaimer')}</p>
          </section>
        )}

        <form
          className={form.section}
          onSubmit={(event) => void save(event)}
          aria-labelledby="done-title"
          noValidate
        >
          <h2 id="done-title" className={styles.sectionTitle}>
            {mark?.doneOn ? t('deadline.doneTitle') : t('deadline.markTitle')}
          </h2>
          <div className={form.grid}>
            <TextField
              label={t('deadline.doneOn')}
              type="date"
              value={doneOn ?? mark?.doneOn ?? data.today}
              onChange={(event) => setDoneOn(event.target.value)}
            />
            <TextField
              label={`${t('deadline.actual')} ${t('common.optional')}`}
              hint={t('deadline.actual.hint')}
              inputMode="decimal"
              value={actual ?? centsToInput(mark?.actualCents ?? null, locale)}
              onChange={(event) => setActual(event.target.value)}
            />
          </div>
          <TextField
            label={`${t('deadline.note')} ${t('common.optional')}`}
            hint={t('deadline.note.hint')}
            maxLength={500}
            value={note ?? mark?.note ?? ''}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className={form.actions}>
            <Button variant="ghost" onClick={() => void toggleHidden()}>
              {mark?.hidden ? t('deadline.unhide') : t('deadline.hide')}
            </Button>
            {mark?.doneOn && (
              <Button variant="ghost" onClick={() => void save(null)}>
                {t('calendar.undo')}
              </Button>
            )}
            <Button type="submit">{mark?.doneOn ? t('common.save') : t('calendar.markDone')}</Button>
          </div>
        </form>

        <p className={styles.caption}>
          <a href={occurrence.source} target="_blank" rel="noreferrer">
            {t('deadline.ruleSource')}
          </a>{' '}
          · {t('deadline.verifiedOn', { date: formatDate(occurrence.verifiedOn, locale) })} ·{' '}
          <Link to="/calendar">{t('deadline.back')}</Link>
        </p>
      </div>
    </>
  );
}
