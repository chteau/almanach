import type { ButtonHTMLAttributes } from 'react';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'subtle';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Pending action: disables the button and replaces its label with "Saving…". */
  busy?: boolean;
}

/**
 * Builds the class list of a button-looking element, for links and other non-button elements
 *
 * @param variant {ButtonVariant} - visual variant
 * @param className {string | undefined} - extra classes
 * @returns {string} - the class list
 */
export function buttonClassName(variant: ButtonVariant = 'primary', className?: string): string {
  return [styles.button, styles[variant], className].filter(Boolean).join(' ');
}

/**
 * Renders a native button in one of the design's variants
 *
 * @param props {ButtonProps} - native button attributes plus the visual variant and busy state
 * @returns {JSX.Element} - the button
 */
export function Button({
  variant = 'primary',
  type = 'button',
  busy = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const { t } = useI18n();
  return (
    <button
      type={type}
      className={buttonClassName(variant, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? t('ui.busy') : children}
    </button>
  );
}
