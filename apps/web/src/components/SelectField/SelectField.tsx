import { type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import styles from '../TextField/TextField.module.css';

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
}

/**
 * Renders a labelled native select whose hint and error are announced by screen readers
 *
 * @param props {SelectFieldProps} - label, optional hint and error, plus native select attributes
 * @returns {JSX.Element} - the field
 */
export function SelectField({ label, hint, error, id, children, ...rest }: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const describedBy = [error && `${selectId}-error`, hint && `${selectId}-hint`].filter(Boolean).join(' ');
  return (
    <div className={styles.field}>
      <label htmlFor={selectId} className={styles.label}>
        {label}
      </label>
      <select
        id={selectId}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...rest}
      >
        {children}
      </select>
      {error && (
        <span id={`${selectId}-error`} className={styles.error}>
          {error}
        </span>
      )}
      {hint && (
        <span id={`${selectId}-hint`} className={styles.hint}>
          {hint}
        </span>
      )}
    </div>
  );
}
