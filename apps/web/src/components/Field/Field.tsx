import { type ReactNode, useId } from 'react';
import styles from './Field.module.css';

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  width?: 'full' | 'half' | 'auto';
  /** Checkbox or radio layout: control first, label beside it, hint and error right under the label. */
  checkbox?: boolean;
  id?: string;
  /** Renders the control with the id and ARIA attributes that tie it to the label, hint and error. */
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Wraps any form control with its label, hint and error, wired through aria-describedby
 *
 * @param props {FieldProps} - label, hint, error, layout and the control render function
 * @returns {JSX.Element} - the field
 */
export function Field({ label, hint, error, width = 'full', checkbox = false, id, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const control = children({
    id: controlId,
    'aria-describedby': [errorId, hintId].filter(Boolean).join(' ') || undefined,
    'aria-invalid': error ? true : undefined,
  });

  return (
    <div className={`${styles.field} ${styles[width]} ${checkbox ? styles.checkbox : ''}`}>
      {checkbox && control}
      <label htmlFor={controlId} className={styles.label}>
        {label}
      </label>
      {!checkbox && control}
      {error && (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      )}
      {hint && (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
    </div>
  );
}
