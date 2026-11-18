import { loginSchema } from '@almanach/shared';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { describeError } from '../install/errors.ts';

/**
 * Sign-in submission shared by the login page and the session-expired dialog
 *
 * @param onSuccess {() => void} - called once the session cookie is set
 * @returns {{ submit: (email: string, password: string) => Promise<void>; error: string | undefined; busy: boolean }} - submit handler and state
 */
export function useLogin(onSuccess: () => void) {
  const { t } = useI18n();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);

  /**
   * Validates locally, then asks the server; errors never reveal whether the account exists (S-011)
   *
   * @param email {string} - e-mail as typed
   * @param password {string} - password as typed
   * @param code {string} - authenticator or recovery code, once the server asks for it
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(email: string, password: string, code = ''): Promise<void> {
    const parsed = loginSchema.safeParse({ email, password, code: needsCode ? code : undefined });
    if (!parsed.success) {
      setError(needsCode ? t('login.error.code') : t('login.error.invalid'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/auth/login', { method: 'POST', body: parsed.data });
      onSuccess();
    } catch (failure) {
      if (failure instanceof ApiError && failure.body.error === 'totp_required') {
        setNeedsCode(true);
        setError(undefined);
      } else if (failure instanceof ApiError && failure.body.error === 'invalid_code')
        setError(t('login.error.code'));
      else if (failure instanceof ApiError && failure.status === 401) setError(t('login.error.invalid'));
      else if (failure instanceof ApiError && failure.body.error === 'locked') {
        const seconds = Number((failure.body as { retryAfterSeconds?: number }).retryAfterSeconds ?? 900);
        setError(t('login.error.locked', { minutes: Math.ceil(seconds / 60) }));
      } else setError(describeError(failure, t));
    } finally {
      setBusy(false);
    }
  }

  return { submit, error, busy, needsCode };
}
