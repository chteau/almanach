import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  title: string;
  body: string;
  children?: ReactNode;
}

/**
 * Explains why a page is empty and offers its main action (section 8, empty state)
 *
 * @param props {EmptyStateProps} - heading, explanation and actions
 * @returns {JSX.Element} - the empty state
 */
export function EmptyState({ title, body, children }: EmptyStateProps) {
  return (
    <section className={styles.empty}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.body}>{body}</p>
      {children && <div className={styles.actions}>{children}</div>}
    </section>
  );
}
