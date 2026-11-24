import { type ReactNode, useId, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Button } from '../Button/Button.tsx';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog.tsx';
import { Row } from '../Row/Row.tsx';
import styles from './DangerZone.module.css';

interface DangerZoneProps {
  /** Heading; "Danger zone" by default. */
  title?: string;
  /** DangerAction rows. */
  children: ReactNode;
}

/**
 * Groups destructive actions in a red-bordered block at the end of a page
 *
 * @param props {DangerZoneProps} - heading and DangerAction rows
 * @returns {JSX.Element} - the danger zone
 */
export function DangerZone({ title, children }: DangerZoneProps) {
  const { t } = useI18n();
  const headingId = useId();
  return (
    <section className={styles.zone} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.title}>
        {title ?? t('ui.dangerZone')}
      </h2>
      <ul className={styles.list}>{children}</ul>
    </section>
  );
}

interface DangerActionProps {
  label: string;
  /** What happens, in plain words; also the body of the confirmation unless confirmBody is given. */
  consequence: string;
  actionLabel: string;
  /** Runs only after the confirmation dialog is accepted. */
  onConfirm: () => void;
  confirmTitle?: string;
  confirmBody?: string;
  confirmLabel?: string;
  busy?: boolean;
  disabled?: boolean;
}

/**
 * One destructive action: label, consequence and a danger button that always asks for confirmation
 *
 * @param props {DangerActionProps} - texts, confirmation overrides, state and handler
 * @returns {JSX.Element} - the row and its dialog
 */
export function DangerAction({
  label,
  consequence,
  actionLabel,
  onConfirm,
  confirmTitle,
  confirmBody,
  confirmLabel,
  busy,
  disabled,
}: DangerActionProps) {
  const [open, setOpen] = useState(false);
  return (
    <li className={styles.item}>
      <Row
        primary={<strong>{label}</strong>}
        meta={consequence}
        actions={
          <Button
            variant="danger"
            busy={busy}
            disabled={disabled}
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            {actionLabel}
          </Button>
        }
      />
      <ConfirmDialog
        open={open}
        danger
        title={confirmTitle ?? label}
        body={confirmBody ?? consequence}
        confirmLabel={confirmLabel ?? actionLabel}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
      />
    </li>
  );
}
