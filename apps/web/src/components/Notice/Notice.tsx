import type { ReactNode } from 'react';
import styles from './Notice.module.css';

interface NoticeProps {
  tone: 'info' | 'warn' | 'error' | 'success';
  /**
   * Announce the message to screen readers (errors immediately, other tones politely). Result
   * messages pass it; static notes leave it off and get no role.
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
export function Notice({ tone, live = false, children }: NoticeProps) {
  const role = live ? (tone === 'error' ? 'alert' : 'status') : undefined;
  return (
    <div role={role} className={`${styles.notice} ${styles[tone]}`}>
      {children}
    </div>
  );
}
