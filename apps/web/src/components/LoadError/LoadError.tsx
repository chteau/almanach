import { describeError } from '../../features/install/errors.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Button } from '../Button/Button.tsx';
import { Notice } from '../Notice/Notice.tsx';

/**
 * Loading failure with a retry button (section 8, error state)
 *
 * @param props {{ error: unknown; onRetry: () => void }} - the failure and how to retry
 * @returns {JSX.Element} - the message
 */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Notice tone="error">
      <p>{describeError(error, t)}</p>
      <Button variant="ghost" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </Notice>
  );
}
