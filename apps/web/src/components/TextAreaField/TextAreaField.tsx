import { type TextareaHTMLAttributes, useId } from 'react';
import styles from '../TextField/TextField.module.css';

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string | undefined;
}

/**
 * Renders a labelled multi-line text field
 *
 * @param props {TextAreaFieldProps} - label, optional error, plus native textarea attributes
 * @returns {JSX.Element} - the field
 */
export function TextAreaField({ label, error, id, ...rest }: TextAreaFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className={styles.field}>
      <label htmlFor={fieldId} className={styles.label}>
        {label}
      </label>
      <textarea
        id={fieldId}
        className={`${styles.input} ${styles.textarea}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        rows={4}
        {...rest}
      />
      {error && (
        <span id={`${fieldId}-error`} className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}
