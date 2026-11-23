import { useState } from 'react';
import form from '../../components/FormPage/FormPage.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';
import styles from '../planning/Planning.module.css';

/**
 * Administrator section: running version and the opt-in check for new releases (S-273)
 *
 * @returns {JSX.Element | null} - the section
 */
export function SystemSettings() {
  const { t } = useI18n();
  const { data, reload } = useResource<{
    version: string;
    versionCheck: boolean;
    stripeSync: boolean;
    federation: boolean;
    preset: { stripeSync: boolean; federation: boolean };
    update: { version: string; url: string } | null;
  }>('/api/system');
  const [failure, setFailure] = useState<string>();
  if (!data) return null;
  return (
    <section className={form.section} aria-labelledby="system-title">
      <h2 id="system-title" className={styles.sectionTitle}>
        {t('system.title')}
      </h2>
      {failure && <Notice tone="error">{failure}</Notice>}
      <p className={styles.text}>{t('system.version', { version: data.version })}</p>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={data.versionCheck}
          onChange={(event) => {
            void api('/api/system/version-check', { method: 'PUT', body: { enabled: event.target.checked } })
              .then(() => {
                setFailure(undefined);
                reload();
              })
              .catch((problem) => setFailure(describeError(problem, t)));
          }}
        />
        {t('system.versionCheck')}
      </label>
      <p className={styles.caption}>{t('system.versionCheck.hint')}</p>
      {(
        [
          ['stripe-sync', 'stripeSync'],
          ['federation', 'federation'],
        ] as const
      ).map(([path, key]) => (
        <div key={key}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={data[key]}
              disabled={data.preset[key]}
              onChange={(event) => {
                void api(`/api/system/${path}`, { method: 'PUT', body: { enabled: event.target.checked } })
                  .then(() => {
                    setFailure(undefined);
                    reload();
                  })
                  .catch((problem) => setFailure(describeError(problem, t)));
              }}
            />
            {t(`system.${key}`)}
          </label>
          <p className={styles.caption}>{data.preset[key] ? t('system.preset') : t(`system.${key}.hint`)}</p>
        </div>
      ))}
    </section>
  );
}
