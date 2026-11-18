import { adminSchema } from '@almanach/shared';
import { useState } from 'react';
import { TextField } from '../../../components/TextField/TextField.tsx';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../../i18n/messages.ts';
import styles from '../InstallWizard.module.css';
import { passwordStrength } from '../password-strength.ts';
import type { StepProps } from '../types.ts';
import { StepShell } from './StepShell.tsx';

const PASSWORD_CODES = ['too_short', 'too_long', 'contains_email', 'too_simple'] as const;

/**
 * Step 4: create the administrator account; the same schema is enforced again by the server
 *
 * @param props {StepProps} - form state and navigation
 * @returns {JSX.Element} - the step
 */
export function AdminStep({ form, update, next, back }: StepProps) {
  const { t } = useI18n();
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [showPassword, setShowPassword] = useState(false);
  const strength = passwordStrength(form.admin.password, form.admin.email);

  /**
   * Validates the account locally for immediate feedback, then continues
   *
   * @returns {void} - nothing
   */
  function submit(): void {
    const result = adminSchema.safeParse(form.admin);
    if (result.success) {
      setErrors({});
      next();
      return;
    }
    const found: { email?: string; password?: string } = {};
    for (const issue of result.error.issues) {
      if (issue.path[0] === 'email') found.email ??= t('install.admin.email.invalid');
      if (issue.path[0] === 'password') {
        const code =
          PASSWORD_CODES.find((c) => c === issue.message) ??
          (issue.code === 'too_big' ? 'too_long' : 'too_short');
        found.password ??= t(`install.admin.password.${code}` as MessageKey);
      }
    }
    setErrors(found);
  }

  return (
    <StepShell
      title={t('install.admin.title')}
      body={t('install.admin.body')}
      onSubmit={submit}
      onBack={back}
    >
      <TextField
        label={t('install.admin.email')}
        type="email"
        autoComplete="email"
        value={form.admin.email}
        onChange={(event) => update({ admin: { ...form.admin, email: event.target.value } })}
        error={errors.email}
        required
      />
      <TextField
        label={t('install.admin.password')}
        type={showPassword ? 'text' : 'password'}
        autoComplete="new-password"
        value={form.admin.password}
        onChange={(event) => update({ admin: { ...form.admin, password: event.target.value } })}
        error={errors.password}
        hint={t('install.admin.password.hint')}
        maxLength={128}
        required
      />
      <div className={styles.passwordTools}>
        <label className={styles.inlineCheck}>
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(event) => setShowPassword(event.target.checked)}
          />
          {t('install.admin.password.show')}
        </label>
        {form.admin.password && (
          <span className={`${styles.strength} ${styles[strength]}`} aria-live="polite">
            {t('install.admin.strength', { level: t(`install.admin.strength.${strength}`) })}
          </span>
        )}
      </div>
      <p className={styles.note}>{t('install.admin.mfa')}</p>
    </StepShell>
  );
}
