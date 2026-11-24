import { useCallback, useState } from 'react';
import type { ActionFeedback } from '../../components/ActionBar/ActionBar.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { describeError } from '../install/errors.ts';

/**
 * Busy state and result of one action, in the shape ActionBar shows next to its button
 *
 * @param describe {(problem: unknown) => string | undefined} - optional specific text for an error
 * @returns {{ busy: boolean; feedback: ActionFeedback | null; setFeedback: (feedback: ActionFeedback | null) => void; run: (action: () => Promise<unknown>) => Promise<boolean> }} - state and runner
 */
export function useAction(describe?: (problem: unknown) => string | undefined) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const run = useCallback(
    /**
     * Runs an action and records its outcome; errors are always shown, never swallowed
     *
     * @param action {() => Promise<unknown>} - work to do; may return a success text
     * @returns {Promise<boolean>} - true when it worked
     */
    async (action: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      setFeedback(null);
      try {
        const text = await action();
        setFeedback({ tone: 'success', text: typeof text === 'string' && text ? text : undefined });
        return true;
      } catch (problem) {
        setFeedback({ tone: 'error', text: describe?.(problem) ?? describeError(problem, t) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [describe, t],
  );

  return { busy, feedback, setFeedback, run };
}
