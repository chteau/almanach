import { useI18n } from '../../i18n/I18nProvider.tsx';
import styles from './Skeleton.module.css';

/**
 * Placeholder rows shown while a list loads, never a blank screen (section 8)
 *
 * @param props {{ rows?: number }} - number of placeholder rows
 * @returns {JSX.Element} - the skeleton
 */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div className={styles.list} aria-busy="true">
      <span className="visually-hidden" role="status">
        {t('common.loading')}
      </span>
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders never reorder
        <div key={index} className={styles.row} />
      ))}
    </div>
  );
}
