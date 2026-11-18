import type { MessageKey, MessageParams } from '../../i18n/messages.ts';
import { ApiError } from '../../lib/api.ts';

type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * Turns any failure into a message the user can act on
 *
 * @param error {unknown} - thrown value
 * @param t {Translate} - translation function
 * @returns {string} - localized message, with the server's error reference when there is one
 */
export function describeError(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return t('common.error.network');
    if (error.status === 429) return t('common.error.rate_limited');
    if (error.status === 503) return t('common.error.maintenance');
    if (error.body.error === 'ceased') return t('common.error.ceased');
    if (error.body.error === 'use_situation') return t('common.error.useSituation');
    if (error.body.id)
      return `${t('common.error.generic')} ${t('common.error.reference', { id: error.body.id })}`;
  }
  return t('common.error.generic');
}
