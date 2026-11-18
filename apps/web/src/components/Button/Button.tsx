import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
}

/**
 * Renders a native button in one of the design's two variants
 *
 * @param props {ButtonProps} - native button attributes plus the visual variant
 * @returns {JSX.Element} - the button
 */
export function Button({ variant = 'primary', type = 'button', className, ...rest }: ButtonProps) {
  return (
    <button type={type} className={`${styles.button} ${styles[variant]} ${className ?? ''}`} {...rest} />
  );
}
