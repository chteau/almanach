import { useMemo } from 'react';
import { useRouteError } from 'react-router';
import { buttonClassName } from '../../components/Button/Button.tsx';
import { ButtonLink } from '../../components/Button/ButtonLink.tsx';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import styles from '../../styles/text.module.css';

/**
 * Page shown for an unknown address (S-270)
 *
 * @returns {JSX.Element} - the page
 */
export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <main id="main" className={styles.systemPage}>
      <EmptyState title={t('system.notFound.title')} body={t('system.notFound.body')}>
        <ButtonLink to="/" variant="primary">
          {t('system.home')}
        </ButtonLink>
      </EmptyState>
    </main>
  );
}

/**
 * Page shown when the interface itself fails, with a reference to quote in a bug report (S-271)
 *
 * @returns {JSX.Element} - the page
 */
export function ErrorPage() {
  const { t } = useI18n();
  const error = useRouteError();
  const reference = useMemo(() => crypto.randomUUID().slice(0, 8), []);
  // The reference ties the report to this line in the browser console.
  console.error(`[${reference}]`, error);
  return (
    <main id="main" className={styles.systemPage}>
      <EmptyState title={t('system.error.title')} body={t('system.error.body')}>
        <p className={styles.caption}>
          {t('common.error.reference', { id: reference })} <code>{reference}</code>
        </p>
        <button type="button" className={buttonClassName('primary')} onClick={() => window.location.reload()}>
          {t('system.reload')}
        </button>
      </EmptyState>
    </main>
  );
}
