import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  title: string;
  body: string;
  /** Compact variant for an empty card or section, with an h3 heading instead of the page-level h2. */
  inline?: boolean;
  children?: ReactNode;
}

/**
 * Explains why a page or card is empty and offers its main action (section 8, empty state)
 *
 * @param props {EmptyStateProps} - heading, explanation, variant and actions
 * @returns {JSX.Element} - the empty state
 */
export function EmptyState({ title, body, inline = false, children }: EmptyStateProps) {
  const Heading = inline ? 'h3' : 'h2';
  return (
    <section className={inline ? `${styles.empty} ${styles.inline}` : styles.empty}>
      <Heading className={styles.title}>{title}</Heading>
      <p className={styles.body}>{body}</p>
      {children && <div className={styles.actions}>{children}</div>}
    </section>
  );
}
