import { type ReactNode, useId } from 'react';
import styles from './SettingsSection.module.css';

interface SettingsSectionProps {
  title: string;
  description?: ReactNode;
  /** Status shown at the right of the title, typically a Badge. */
  badge?: ReactNode;
  /** Footer of the section, typically an ActionBar. */
  footer?: ReactNode;
  children?: ReactNode;
}

/**
 * Card of a settings page: heading, description, optional badge, body and action footer
 *
 * @param props {SettingsSectionProps} - heading, description, badge, footer and body
 * @returns {JSX.Element} - the section
 */
export function SettingsSection({ title, description, badge, footer, children }: SettingsSectionProps) {
  const headingId = useId();
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 id={headingId} className={styles.title}>
            {title}
          </h2>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        {badge && <div className={styles.badge}>{badge}</div>}
      </header>
      {children && <div className={styles.body}>{children}</div>}
      {footer}
    </section>
  );
}
