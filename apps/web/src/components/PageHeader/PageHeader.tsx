import { type ReactNode, useEffect, useRef } from 'react';
import styles from './PageHeader.module.css';

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Aligns the header on --content-narrow, for single-column pages such as settings. */
  width?: 'narrow';
  children?: ReactNode;
}

/**
 * Page title with optional actions; focuses the heading on mount so route changes are announced
 *
 * @param props {PageHeaderProps} - title, subtitle, width and action buttons
 * @returns {JSX.Element} - the header
 */
export function PageHeader({ title, subtitle, width, children }: PageHeaderProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = `${title} · Almanach`;
    heading.current?.focus();
  }, [title]);

  return (
    <header className={width === 'narrow' ? `${styles.header} ${styles.narrow}` : styles.header}>
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
