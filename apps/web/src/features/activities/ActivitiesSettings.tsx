import { useState } from 'react';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { describeError } from '../install/errors.ts';
import styles from '../planning/Planning.module.css';
import { statusLabel, useActivities } from './useActivities.ts';

/**
 * Activities of the profile: the main one (the status) and the secondary ones of a mixed activity, to add or
 * remove; an activity created from a link says so
 *
 * @returns {JSX.Element | null} - the block, once loaded
 */
export function ActivitiesSettings() {
  const { t, locale } = useI18n();
  const { data, reload } = useActivities();
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState<string>();
  if (!data || data.activities.length === 0) return null;
  const used = new Set(data.activities.map((activity) => activity.status));
  const available = data.statuses.filter((item) => !used.has(item.id));

  /**
   * Runs a request, then reloads the activities or shows the failure
   *
   * @param request {Promise<unknown>} - API call
   * @returns {Promise<void>} - resolves once handled
   */
  async function run(request: Promise<unknown>): Promise<void> {
    try {
      await request;
      setFailure(undefined);
      setStatus('');
      reload();
    } catch (problem) {
      setFailure(describeError(problem, t));
    }
  }

  return (
    <div>
      <h3 id="activities-title" className={styles.subTitle}>
        {t('activities.title')}
      </h3>
      <p className={styles.caption}>{t('activities.body')}</p>
      {failure && <Notice tone="error">{failure}</Notice>}
      <ul className={list.list}>
        {data.activities.map((activity) => (
          <li key={activity.id ?? 'main'} className={`${list.item} ${styles.split}`}>
            <span>
              {statusLabel(data.statuses, activity.status, locale)}{' '}
              <Badge tone={activity.main ? 'ok' : 'neutral'}>
                {t(activity.main ? 'activities.main' : 'activities.secondary')}
              </Badge>
              {activity.linkId && (
                <span className={styles.caption}>
                  {' '}
                  {t('activities.fromLink', { label: activity.linkLabel ?? '' })}
                </span>
              )}
            </span>
            {activity.id && (
              <Button
                variant="ghost"
                onClick={() => void run(api(`/api/profile/activities/${activity.id}`, { method: 'DELETE' }))}
              >
                {t('activities.remove')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {available.length > 0 && (
        <form
          className={form.actions}
          onSubmit={(event) => {
            event.preventDefault();
            void run(api('/api/profile/activities', { method: 'POST', body: { status } }));
          }}
        >
          <SelectField
            label={t('activities.add')}
            value={status}
            required
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">—</option>
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label[locale]}
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="ghost">
            {t('activities.addButton')}
          </Button>
        </form>
      )}
    </div>
  );
}
