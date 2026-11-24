import { useEffect, useId, useRef } from 'react';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Button } from '../Button/Button.tsx';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation for destructive or irreversible actions, built on the native dialog element so
 * focus trapping and Escape work everywhere
 *
 * @param props {ConfirmDialogProps} - content, open state and handlers
 * @returns {JSX.Element} - the dialog
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  // Several dialogs can share a page: each title needs its own id.
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onCancel={onCancel}>
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      <p className={styles.body}>{body}</p>
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
