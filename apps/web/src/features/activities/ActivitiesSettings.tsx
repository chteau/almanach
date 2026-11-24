import { type SyntheticEvent, useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { Row } from '../../components/Row/Row.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';
import { useAction } from '../settings/useAction.ts';
import { statusLabel, useActivities } from './useActivities.ts';

/**
 * Activities of the active company (main and secondary statuses), and the name this activity shows
 * to linked instances
 *
 * @returns {JSX.Element | null} - the sections, when the country has statuses
 */
export function ActivitiesSettings() {
  const { t, locale } = useI18n();
  const { data, reload } = useActivities();
  const [status, setStatus] = useState('');
  const [removing, setRemoving] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const add = useAction();
  if (!data || data.activities.length === 0) return <LinkedName />;
  const used = new Set(data.activities.map((activity) => activity.status));
  const available = data.statuses.filter((item) => !used.has(item.id));

  /**
   * Adds a secondary activity
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const done = await add.run(async () => {
      await api('/api/profile/activities', { method: 'POST', body: { status } });
    });
    if (done) setStatus('');
    reload();
  }

  /**
   * Removes a secondary activity after confirmation
   *
   * @param id {string} - activity id
   * @returns {Promise<void>} - resolves when done
   */
  async function remove(id: string): Promise<void> {
    setRemoving(undefined);
    try {
      await api(`/api/profile/activities/${id}`, { method: 'DELETE' });
      setFailure(undefined);
    } catch (problem) {
      setFailure(describeError(problem, t));
    }
    reload();
  }

  return (
    <>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <SettingsSection
          title={t('activities.title')}
          description={t('activities.body')}
          footer={
            available.length > 0 && (
              <ActionBar
                primaryLabel={t('activities.addButton')}
                busy={add.busy}
                disabled={!status}
                feedback={add.feedback}
              />
            )
          }
        >
          {failure && (
            <Notice tone="error" live>
              {failure}
            </Notice>
          )}
          <ul className={list.list}>
            {data.activities.map((activity) => (
              <li key={activity.id ?? 'main'} className={list.item}>
                <Row
                  primary={
                    <>
                      {statusLabel(data.statuses, activity.status, locale)}{' '}
                      <Badge tone={activity.main ? 'ok' : 'neutral'}>
                        {t(activity.main ? 'activities.main' : 'activities.secondary')}
                      </Badge>
                    </>
                  }
                  meta={
                    activity.linkId
                      ? t('activities.fromLink', { label: activity.linkLabel ?? '' })
                      : undefined
                  }
                  actions={
                    activity.id && (
                      <Button
                        variant="danger"
                        aria-haspopup="dialog"
                        onClick={() => setRemoving(activity.id ?? undefined)}
                      >
                        {t('activities.remove')}
                      </Button>
                    )
                  }
                />
              </li>
            ))}
          </ul>
          {available.length > 0 && (
            <SelectField
              label={t('activities.add')}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">—</option>
              {available.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label[locale]}
                </option>
              ))}
            </SelectField>
          )}
        </SettingsSection>
      </form>
      <LinkedName />
      <ConfirmDialog
        open={removing !== undefined}
        danger
        title={t('activities.remove')}
        body={t('settings.activities.remove.body')}
        confirmLabel={t('activities.remove')}
        onCancel={() => setRemoving(undefined)}
        onConfirm={() => removing && void remove(removing)}
      />
    </>
  );
}

/**
 * Name of this activity as linked instances show it; only when links between instances are allowed
 *
 * @returns {JSX.Element | null} - the section
 */
function LinkedName() {
  const { t } = useI18n();
  const { data, reload } = useResource<{ allowed: boolean; enabled: boolean; label: string }>(
    '/api/settings/federation',
  );
  const [label, setLabel] = useState<string>();
  const action = useAction();
  if (!data?.allowed) return null;
  const value = label ?? data.label;

  /**
   * Saves the name, keeping the link switch as it is
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const done = await action.run(async () => {
      await api('/api/settings/federation', {
        method: 'PUT',
        body: { enabled: data?.enabled ?? false, label: value.trim() },
      });
    });
    if (done) {
      setLabel(undefined);
      reload();
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <SettingsSection
        title={t('federation.label')}
        description={t('federation.label.hint')}
        footer={
          <ActionBar
            primaryLabel={t('common.save')}
            busy={action.busy}
            dirty={value !== data.label}
            disabled={!value.trim()}
            feedback={action.feedback}
          />
        }
      >
        <TextField
          label={t('federation.label')}
          value={value}
          maxLength={60}
          required
          onChange={(event) => setLabel(event.target.value)}
        />
      </SettingsSection>
    </form>
  );
}
