import { useI18n } from '../../i18n/I18nProvider.tsx';
import { formatDate } from '../../lib/format.ts';
import styles from './Planning.module.css';
import type { Outlook } from './types.ts';

/**
 * Lines about the other activities of the business tracked in linked instances: their revenue, whether it counts
 * in the estimates (attached to an activity) or is handled there, and the date of totals kept while the peer
 * cannot be reached
 *
 * @param props {{ outlook: Outlook; money: (cents: number) => string }} - outlook and money formatter
 * @returns {JSX.Element[]} - one caption per linked activity
 */
export function LinkedActivities({ outlook, money }: { outlook: Outlook; money: (cents: number) => string }) {
  const { t, locale } = useI18n();
  return outlook.linked.map((link) => (
    <p key={link.label} className={styles.caption}>
      {t(link.activity ? 'outlook.linkedAttached' : 'outlook.linkedEstimates', {
        label: link.label,
        amount: money(link.cents),
      })}
      {link.error &&
        link.receivedAt &&
        ` ${t('outlook.linkedStale', { date: formatDate(link.receivedAt.slice(0, 10), locale) })}`}
    </p>
  ));
}
