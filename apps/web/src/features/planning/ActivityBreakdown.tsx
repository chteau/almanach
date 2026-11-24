import type { ActivityBreakdown as Breakdown } from '@almanach/shared';
import { TableScroll } from '../../components/TableScroll/TableScroll.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { statusLabel, useActivities } from '../activities/useActivities.ts';
import styles from './Planning.module.css';

/**
 * Revenue, amounts to set aside and taxable income per activity of a mixed business, each at its own rates;
 * nothing while there is a single activity
 *
 * @param props {{ activities: Breakdown[]; money: (cents: number) => string }} - breakdown and money formatter
 * @returns {JSX.Element | null} - the table
 */
export function ActivityBreakdown({
  activities,
  money,
}: {
  activities: Breakdown[];
  money: (cents: number) => string;
}) {
  const { t, locale } = useI18n();
  const { data } = useActivities();
  if (activities.length < 2) return null;
  const rate = (bp: number) => `${(bp / 100).toLocaleString(locale)} %`;
  return (
    <TableScroll>
      <table className={styles.table}>
        <caption>{t('activities.breakdown')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('activities.field')}</th>
            <th scope="col">{t('activities.revenue')}</th>
            <th scope="col">{t('activities.setAside')}</th>
            <th scope="col">{t('activities.taxable')}</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((activity) => (
            <tr key={activity.status}>
              <th scope="row">
                {statusLabel(data?.statuses ?? [], activity.status, locale)}
                <span className={styles.step}>
                  {activity.estimates
                    .filter((estimate) => estimate.cents > 0)
                    .flatMap((estimate) => estimate.steps.map((step) => rate(step.rateBp)))
                    .join(' + ') || '—'}
                </span>
              </th>
              <td>
                {money(activity.revenueCents)}
                {activity.linkedCents !== 0 && (
                  <span className={styles.step}>
                    {t('activities.linkedPart', { amount: money(activity.linkedCents) })}
                  </span>
                )}
              </td>
              <td>{money(activity.estimateCents)}</td>
              <td>
                {activity.allowance ? (
                  <>
                    {money(activity.allowance.taxableCents)}
                    <span className={styles.step}>
                      {t('activities.allowance', { rate: rate(activity.allowance.rateBp) })} ·{' '}
                      <a href={activity.allowance.source} target="_blank" rel="noreferrer">
                        {t('deadline.source')}
                      </a>
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
