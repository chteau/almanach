import type { ReactNode } from 'react';
import styles from './Notice.module.css';

interface NoticeProps {
  tone: 'info' | 'warn' | 'error';
  children: ReactNode;
}

/**
 * Renders an inline message; errors are announced immediately, other tones politely
 *
 * @param props {NoticeProps} - tone and content
 * @returns {JSX.Element} - the message box
 */
export function Notice({ tone, children }: NoticeProps) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`${styles.notice} ${styles[tone]}`}>
      {children}
    </div>
  );
}
