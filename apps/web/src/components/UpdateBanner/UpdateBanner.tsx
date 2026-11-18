import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { useResource } from '../../lib/useResource.ts';
import styles from './UpdateBanner.module.css';

const DISMISSED_KEY = 'almanach.dismissedRelease';

/**
 * Reads the release the person already dismissed; storage may be unavailable
 *
 * @returns {string | null} - dismissed version
 */
function dismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/**
 * Banner announcing a newer Almanach release, with its release notes (S-273). The server only knows
 * about releases when an administrator turned the check on.
 *
 * @returns {JSX.Element | null} - the banner, or nothing
 */
export function UpdateBanner() {
  const { t } = useI18n();
  const { data } = useResource<{ version: string; update: { version: string; url: string } | null }>(
    '/api/system',
  );
  const [hidden, setHidden] = useState(dismissed);
  const update = data?.update;
  if (!update || hidden === update.version) return null;
  return (
    <aside className={styles.banner} aria-label={t('system.update.label')}>
      <p>
        {t('system.update.body', { version: update.version, current: data.version })}{' '}
        <a href={update.url} target="_blank" rel="noreferrer">
          {t('system.update.notes')}
        </a>
      </p>
      <button
        type="button"
        className={styles.close}
        onClick={() => {
          try {
            localStorage.setItem(DISMISSED_KEY, update.version);
          } catch {
            // Storage blocked: the banner simply comes back on the next visit.
          }
          setHidden(update.version);
        }}
      >
        {t('system.update.dismiss')}
      </button>
    </aside>
  );
}
