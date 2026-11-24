import type { ReactNode } from 'react';
import styles from './Row.module.css';

interface RowProps {
  primary: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}

/**
 * Lays out one list row: content on the left, actions on the right, actions below on narrow screens
 *
 * @param props {RowProps} - main content, secondary line and actions
 * @returns {JSX.Element} - the row
 */
export function Row({ primary, meta, actions }: RowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.content}>
        <div className={styles.primary}>{primary}</div>
        {meta && <div className={styles.meta}>{meta}</div>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
