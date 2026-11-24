import type { ReactNode } from 'react';
import styles from './Notice.module.css';

interface NoticeProps {
  tone: 'info' | 'warn' | 'error' | 'success';
  /**
   * Announce the message to screen readers (errors immediately, other tones politely). Static notes
   * pass false and get no role. Defaults to true while result messages still rely on the announcement
   * without passing it; the default becomes false once every result message passes `live`.
   */
  live?: boolean;
  children: ReactNode;
}

/**
 * Renders an inline message, announced when live
 *
 * @param props {NoticeProps} - tone, live flag and content
 * @returns {JSX.Element} - the message box
 */
export function Notice({ tone, live = true, children }: NoticeProps) {
  const role = live ? (tone === 'error' ? 'alert' : 'status') : undefined;
  return (
    <div role={role} className={`${styles.notice} ${styles[tone]}`}>
      {children}
    </div>
  );
}
