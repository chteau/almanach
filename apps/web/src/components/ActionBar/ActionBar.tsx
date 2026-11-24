import { type ReactNode, useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Button } from '../Button/Button.tsx';
import styles from './ActionBar.module.css';

/** Result of the last action; pass a new object for each attempt so a repeated success shows again. */
export type ActionFeedback = { tone: 'success'; text?: string } | { tone: 'error'; text: string };

interface ActionBarProps {
  primaryLabel: string;
  /** Click handler of the primary button; without it the button submits its form. */
  onPrimary?: () => void;
  /** Id of the form submitted by the primary button, when the bar sits outside it. */
  form?: string;
  busy?: boolean;
  disabled?: boolean;
  /** Shows "Unsaved changes" while no feedback is displayed. */
  dirty?: boolean;
  feedback?: ActionFeedback | null;
  /** Milliseconds a success stays visible; errors stay until replaced. */
  successDuration?: number;
  /** Secondary actions, placed before the primary button. */
  children?: ReactNode;
}

/**
 * Footer of a form or settings section: right-aligned actions, primary last, with the result of the
 * last action announced next to the primary button
 *
 * @param props {ActionBarProps} - primary action, state flags, feedback and secondary actions
 * @returns {JSX.Element} - the action bar
 */
export function ActionBar({
  primaryLabel,
  onPrimary,
  form,
  busy = false,
  disabled,
  dirty = false,
  feedback,
  successDuration = 4000,
  children,
}: ActionBarProps) {
  const { t } = useI18n();
  const [expired, setExpired] = useState<ActionFeedback | null>(null);
  const shown = busy || !feedback || feedback === expired ? null : feedback;

  useEffect(() => {
    if (feedback?.tone !== 'success') return;
    const timer = setTimeout(() => setExpired(feedback), successDuration);
    return () => clearTimeout(timer);
  }, [feedback, successDuration]);

  return (
    <div className={styles.bar}>
      {children}
      {!shown && dirty && !busy && <span className={styles.dirty}>{t('ui.dirty')}</span>}
      <span role="status" className={shown?.tone === 'error' ? styles.error : styles.success}>
        {shown && (shown.text ?? t('ui.saved'))}
      </span>
      <Button
        type={onPrimary ? 'button' : 'submit'}
        form={form}
        onClick={onPrimary}
        busy={busy}
        disabled={disabled}
      >
        {primaryLabel}
      </Button>
    </div>
  );
}
