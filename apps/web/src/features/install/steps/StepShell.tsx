import { type ReactNode, type SyntheticEvent, useEffect, useRef } from 'react';
import { Button } from '../../../components/Button/Button.tsx';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import styles from '../InstallWizard.module.css';

interface StepShellProps {
  title: string;
  body: string;
  children: ReactNode;
  onSubmit: () => void;
  onBack?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
}

/**
 * Lays out one wizard step as a form, and moves focus to its heading so keyboard and screen-reader
 * users land on the new step
 *
 * @param props {StepShellProps} - heading, intro, content and navigation handlers
 * @returns {JSX.Element} - the step
 */
export function StepShell({
  title,
  body,
  children,
  onSubmit,
  onBack,
  submitLabel,
  submitDisabled,
}: StepShellProps) {
  const { t } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  /**
   * Prevents the native submission and hands control to the step
   *
   * @param event {SyntheticEvent} - submit event
   * @returns {void} - nothing
   */
  function handleSubmit(event: SyntheticEvent): void {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className={styles.step} onSubmit={handleSubmit} noValidate>
      <div className={styles.intro}>
        <h1 ref={heading} tabIndex={-1} className={styles.title}>
          {title}
        </h1>
        <p className={styles.body}>{body}</p>
      </div>
      {children}
      <div className={styles.actions}>
        {onBack ? (
          <Button variant="ghost" onClick={onBack}>
            {t('common.back')}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={submitDisabled}>
          {submitLabel ?? t('common.continue')}
        </Button>
      </div>
    </form>
  );
}
