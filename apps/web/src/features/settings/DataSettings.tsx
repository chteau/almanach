import { useState } from 'react';
import { buttonClassName } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { ApiError, api } from '../../lib/api.ts';
import text from '../../styles/text.module.css';

/**
 * Export of the whole account as JSON, and import into an empty account (S-280)
 *
 * @returns {JSX.Element} - the section
 */
export function DataSettings() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string }>();

  /**
   * Sends an export file to the server
   *
   * @param file {File} - JSON export chosen by the person
   * @returns {Promise<void>} - resolves when done
   */
  async function importFile(file: File): Promise<void> {
    setBusy(true);
    setMessage(undefined);
    try {
      const body = JSON.parse(await file.text()) as unknown;
      const result = await api<{ counts: Record<string, number> }>('/api/account/import', {
        method: 'POST',
        body,
      });
      setMessage({
        tone: 'success',
        text: t('data.imported', {
          companies: result.counts.companies ?? 1,
          clients: result.counts.clients ?? 0,
          documents: result.counts.documents ?? 0,
        }),
      });
    } catch (problem) {
      const code = problem instanceof ApiError ? String(problem.body.error ?? '') : 'invalid_export';
      setMessage({ tone: 'error', text: t(`data.error.${code === 'not_empty' ? 'not_empty' : 'invalid'}`) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SettingsSection title={t('data.export')} description={t('data.body')}>
        <div className={form.actions}>
          <a href="/api/account/export" download className={buttonClassName('primary')}>
            {t('data.export')}
          </a>
        </div>
      </SettingsSection>
      <SettingsSection title={t('data.import')} description={t('data.import.hint')}>
        {message && (
          <Notice tone={message.tone} live>
            {message.text}
          </Notice>
        )}
        <div className={form.actions}>
          <label
            className={`${buttonClassName('ghost')} ${text.fileButton}`}
            aria-disabled={busy || undefined}
          >
            {busy ? t('ui.busy') : t('data.import')}
            <input
              type="file"
              accept="application/json,.json"
              className="visually-hidden"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importFile(file);
              }}
            />
          </label>
        </div>
      </SettingsSection>
    </>
  );
}
