import { useState } from 'react';
import { Badge } from '../../components/Badge/Badge.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import styles from '../../styles/text.module.css';

const STORAGE_KEY = 'almanach.hideTest';

/**
 * "Hide test data" choice of the lists, on by default and remembered in this browser
 *
 * @returns {[boolean, (value: boolean) => void]} - whether test data is hidden, and its setter
 */
export function useHideTest(): [boolean, (value: boolean) => void] {
  const [hide, setHide] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  return [
    hide,
    (value) => {
      setHide(value);
      try {
        localStorage.setItem(STORAGE_KEY, String(value));
      } catch {
        // Private browsing: the choice lasts for the page only.
      }
    },
  ];
}

/**
 * DEV pill of test data (Stripe test mode, test source); such records never count in any total
 *
 * @returns {JSX.Element} - the badge
 */
export function DevBadge() {
  const { t } = useI18n();
  return <Badge tone="warn">{t('linked.dev')}</Badge>;
}

/**
 * "Hide test data" checkbox, shown only when the list holds test data
 *
 * @param props {{ shown: boolean; value: boolean; onChange: (value: boolean) => void }} - visibility, value and setter
 * @returns {JSX.Element | null} - the checkbox, or nothing
 */
export function HideTestToggle({
  shown,
  value,
  onChange,
}: {
  shown: boolean;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { t } = useI18n();
  if (!shown) return null;
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      {t('linked.hideTest')}
    </label>
  );
}
