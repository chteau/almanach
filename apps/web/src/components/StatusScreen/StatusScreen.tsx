import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Button } from '../Button/Button.tsx';
import { Logo } from '../Logo/Logo.tsx';
import styles from './StatusScreen.module.css';

interface StatusScreenProps {
  state: 'loading' | 'error';
}

/**
 * Full-page loading or connection-error screen shown before routing decisions
 *
 * @param props {StatusScreenProps} - which state to show
 * @returns {JSX.Element} - the screen
 */
export function StatusScreen({ state }: StatusScreenProps) {
  const { t } = useI18n();
  return (
    <main className={styles.screen}>
      <Logo />
      {state === 'loading' ? (
        <p aria-live="polite">{t('common.loading')}</p>
      ) : (
        <div role="alert" className={styles.error}>
          <p>{t('common.error.network')}</p>
          <Button onClick={() => window.location.reload()}>{t('common.retry')}</Button>
        </div>
      )}
    </main>
  );
}
