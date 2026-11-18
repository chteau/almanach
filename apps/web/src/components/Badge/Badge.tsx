import type { ReactNode } from 'react';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'err' | 'accent';

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
}

/**
 * Small status label; colour is never the only signal, the text always says the status
 *
 * @param props {BadgeProps} - tone and label
 * @returns {JSX.Element} - the badge
 */
export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
