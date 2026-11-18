import { useState } from 'react';
import buttonStyles from '../../components/Button/Button.module.css';
import form from '../../components/FormPage/FormPage.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { ApiError, api } from '../../lib/api.ts';
import styles from '../planning/Planning.module.css';

/**
 * Full export of the person's data and import into a fresh account (S-245, S-246)
 *
 * @returns {JSX.Element} - the section
 */
export function DataSettings() {
  const { t } = useI18n();
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string }>();

  /**
   * Imports an export file
   *
   * @param file {File} - JSON export
   * @returns {Promise<void>} - resolves when done
   */
  async function importFile(file: File): Promise<void> {
    try {
      const body = JSON.parse(await file.text()) as unknown;
      const result = await api<{ counts: Record<string, number> }>('/api/account/import', {
        method: 'POST',
        body,
      });
      setMessage({
        tone: 'info',
        text: t('data.imported', {
          clients: result.counts.clients ?? 0,
          documents: result.counts.documents ?? 0,
        }),
      });
    } catch (problem) {
      const code = problem instanceof ApiError ? String(problem.body.error ?? '') : 'invalid_export';
      setMessage({ tone: 'error', text: t(`data.error.${code === 'not_empty' ? 'not_empty' : 'invalid'}`) });
    }
  }

  return (
    <section id="data" className={form.section} aria-labelledby="data-title">
      <h2 id="data-title" className={styles.sectionTitle}>
        {t('data.title')}
      </h2>
      <p className={styles.text}>{t('data.body')}</p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className={form.actions}>
        <label className={`${buttonStyles.button} ${buttonStyles.ghost} ${styles.fileButton}`}>
          {t('data.import')}
          <input
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importFile(file);
            }}
          />
        </label>
        <a href="/api/account/export" download className={`${buttonStyles.button} ${buttonStyles.primary}`}>
          {t('data.export')}
        </a>
      </div>
      <p className={styles.caption}>{t('data.import.hint')}</p>
    </section>
  );
}
