import { type ReactNode, useEffect, useRef } from 'react';
import styles from './PageHeader.module.css';

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}

/**
 * Page title with optional actions; focuses the heading on mount so route changes are announced
 *
 * @param props {PageHeaderProps} - title, subtitle and action buttons
 * @returns {JSX.Element} - the header
 */
export function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = `${title} · Almanach`;
    heading.current?.focus();
  }, [title]);

  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <h1 ref={heading} tabIndex={-1} className={styles.title}>
          {title}
        </h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {children && <div className={styles.actions}>{children}</div>}
    </header>
  );
}
