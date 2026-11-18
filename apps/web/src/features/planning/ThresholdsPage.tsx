import { parseAmount } from '@almanach/shared';
import { useEffect, useState } from 'react';
import form from '../../components/FormPage/FormPage.module.css';
import { Gauge } from '../../components/Gauge/Gauge.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TableScroll } from '../../components/TableScroll/TableScroll.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { formatDate, formatMoney } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import styles from './Planning.module.css';
import { labelOf, type Outlook } from './types.ts';

/**
 * Thresholds of the pack, yearly estimates month by month and a "what if" simulation (P18, S-210 to S-216)
 *
 * @returns {JSX.Element} - the page
 */
export function ThresholdsPage() {
  const { t, locale } = useI18n();
  const [simulation, setSimulation] = useState('');
  const [simulated, setSimulated] = useState(0);
  const cents = simulation.trim() ? parseAmount(simulation) : 0;

  useEffect(() => {
    if (cents === null) return;
    const timer = setTimeout(() => setSimulated(cents), 400);
    return () => clearTimeout(timer);
  }, [cents]);

  const { data, error, loading, reload } = useResource<{ outlook: Outlook | null }>(
    `/api/outlook?simulate=${simulated}`,
  );
  const outlook = data?.outlook;
  const money = (value: number) => formatMoney(value, outlook?.currency ?? 'EUR', locale);

  return (
    <>
      <PageHeader
        title={t('nav.thresholds')}
        subtitle={
          outlook
            ? t('outlook.fiscalYear', {
                from: formatDate(outlook.fiscalYear.start, locale),
                to: formatDate(outlook.fiscalYear.end, locale),
              })
            : undefined
        }
      />
      {error !== undefined && <LoadError error={error} onRetry={reload} />}
      {loading && !data && <Skeleton rows={6} />}
      {data && !outlook && <Notice tone="info">{t('outlook.noRules')}</Notice>}
      {outlook && (
        <div className={form.form}>
          {outlook.fallback && (
            <Notice tone="warn">
              {t('outlook.fallback', { year: outlook.year, rules: outlook.rulesYear })}
            </Notice>
          )}
          {outlook.unconverted > 0 && (
            <Notice tone="info">{t('outlook.unconverted', { count: outlook.unconverted })}</Notice>
          )}
          <section className={form.section} aria-labelledby="simulate-title">
            <h2 id="simulate-title" className={styles.sectionTitle}>
              {t('outlook.simulate')}
            </h2>
            <TextField
              label={t('outlook.simulate.label', { currency: outlook.currency })}
              hint={t('outlook.simulate.hint')}
              inputMode="decimal"
              value={simulation}
              onChange={(event) => setSimulation(event.target.value)}
              error={cents === null ? t('errors.amount') : undefined}
            />
            {simulated > 0 && (
              <p className={styles.caption} aria-live="polite">
                {t('outlook.simulating', { amount: money(simulated) })}
              </p>
            )}
          </section>

          <section className={form.section} aria-labelledby="gauges-title">
            <h2 id="gauges-title" className={styles.sectionTitle}>
              {t('outlook.thresholds')}
            </h2>
            {outlook.thresholds.length === 0 && <p className={styles.caption}>{t('outlook.noThresholds')}</p>}
            {outlook.thresholds.map((threshold) => (
              <div key={threshold.id} className={styles.threshold}>
                <Gauge
                  label={labelOf(threshold.label, locale)}
                  valueBp={threshold.reachedBp}
                  detail={t('outlook.gauge', {
                    reached: money(threshold.reachedCents),
                    limit: money(threshold.limitCents),
                  })}
                />
                <p className={styles.caption}>
                  {t(`outlook.window.${threshold.window}`, {
                    from: formatDate(threshold.windowStart, locale),
                    to: formatDate(threshold.windowEnd, locale),
                  })}
                  {threshold.toleranceCents !== null &&
                    ` · ${t('outlook.tolerance', { amount: money(threshold.toleranceCents) })}`}
                  {!threshold.exceeded &&
                    ` · ${t('outlook.remaining', { amount: money(threshold.remainingCents) })}`}
                  {threshold.projectedDate &&
                    ` · ${t('outlook.projected', { date: formatDate(threshold.projectedDate, locale) })}`}
                </p>
                {(threshold.exceeded || threshold.projectedDate) && (
                  <Notice
                    tone={
                      threshold.toleranceExceeded || (threshold.exceeded && threshold.toleranceCents === null)
                        ? 'error'
                        : 'warn'
                    }
                  >
                    {labelOf(threshold.consequence, locale)}
                  </Notice>
                )}
                <p className={styles.source}>
                  <a href={threshold.source} target="_blank" rel="noreferrer">
                    {t('deadline.source')}
                  </a>{' '}
                  · {t('deadline.verifiedOn', { date: formatDate(threshold.verifiedOn, locale) })}
                </p>
              </div>
            ))}
          </section>

          <section className={form.section} aria-labelledby="estimates-title">
            <h2 id="estimates-title" className={styles.sectionTitle}>
              {t('outlook.estimates')}
            </h2>
            <dl className={form.facts}>
              <div>
                <dt>{t('outlook.collected')}</dt>
                <dd>{money(outlook.collectedCents)}</dd>
              </div>
              <div>
                <dt>{t('outlook.projectedRevenue')}</dt>
                <dd>{money(outlook.projectedRevenueCents)}</dd>
              </div>
            </dl>
            <TableScroll>
              <table className={styles.table}>
                <caption className="visually-hidden">{t('outlook.estimates')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('outlook.estimate')}</th>
                    <th scope="col">{t('outlook.toDate')}</th>
                    <th scope="col">{t('outlook.wholeYear')}</th>
                  </tr>
                </thead>
                <tbody>
                  {outlook.estimates.map((estimate) => (
                    <tr key={estimate.id}>
                      <th scope="row">
                        {labelOf(estimate.label, locale)}
                        <span className={styles.step}>
                          {estimate.steps
                            .map(
                              (step) =>
                                `${money(step.baseCents)} × ${(step.rateBp / 100).toLocaleString(locale)} %`,
                            )
                            .join(' + ') || '—'}
                        </span>
                      </th>
                      <td>{money(estimate.cents)}</td>
                      <td>{money(outlook.projection.find((item) => item.id === estimate.id)?.cents ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <p className={styles.caption}>{t('outlook.disclaimer')}</p>
          </section>

          <section className={form.section} aria-labelledby="months-title">
            <h2 id="months-title" className={styles.sectionTitle}>
              {t('outlook.months')}
            </h2>
            <TableScroll>
              <table className={styles.table}>
                <caption className="visually-hidden">{t('outlook.months')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('outlook.month')}</th>
                    <th scope="col">{t('outlook.collected')}</th>
                    <th scope="col">{t('outlook.monthEstimate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {outlook.months.map((month) => (
                    <tr key={month.month}>
                      <th scope="row">
                        {new Intl.DateTimeFormat(locale, {
                          month: 'long',
                          year: 'numeric',
                          timeZone: 'UTC',
                        }).format(new Date(`${month.month}-01T00:00:00Z`))}
                      </th>
                      <td>{money(month.revenueCents)}</td>
                      <td>{money(month.estimateCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </section>
        </div>
      )}
    </>
  );
}
