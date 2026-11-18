import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import styles from './TableScroll.module.css';

/**
 * Wraps a wide table so it scrolls sideways on narrow screens; the region is focusable so keyboard
 * users can scroll it too (WCAG 2.1.1)
 *
 * @param props {{ children: ReactNode }} - the table
 * @returns {JSX.Element} - scrollable region
 */
export function TableScroll({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable with the keyboard
    <section className={styles.scroll} tabIndex={0} aria-label={t('common.scrollTable')}>
      {children}
    </section>
  );
}
