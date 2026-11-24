import { type SyntheticEvent, useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Field } from '../../components/Field/Field.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { useResource } from '../../lib/useResource.ts';
import { useAction } from './useAction.ts';

const SWITCHES = [
  ['version-check', 'versionCheck'],
  ['stripe-sync', 'stripeSync'],
  ['federation', 'federation'],
  ['external-sources', 'externalSources'],
  ['mcp', 'mcp'],
] as const;

type SwitchKey = (typeof SWITCHES)[number][1];

interface SystemStatus extends Record<SwitchKey, boolean> {
  version: string;
  preset: { stripeSync: boolean; federation: boolean; externalSources: boolean; mcp: boolean };
  update: { version: string; url: string } | null;
}

/**
 * Instance-wide permissions an administrator grants, all off by default (S-273)
 *
 * @returns {JSX.Element} - the section
 */
export function SystemSettings() {
  const { data, error, reload } = useResource<SystemStatus>('/api/system');
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  return <SystemForm data={data} onSaved={reload} />;
}

/**
 * Permissions form once loaded
 *
 * @param props {{ data: SystemStatus; onSaved: () => void }} - stored switches, refresh callback
 * @returns {JSX.Element} - the form
 */
function SystemForm({ data, onSaved }: { data: SystemStatus; onSaved: () => void }) {
  const { t } = useI18n();
  const initial = () =>
    Object.fromEntries(SWITCHES.map(([, key]) => [key, data[key]])) as Record<SwitchKey, boolean>;
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState(saved);
  const action = useAction();
  const changed = SWITCHES.filter(([, key]) => values[key] !== saved[key]);

  /**
   * Sends the switches that changed
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    await action.run(async () => {
      for (const [path, key] of changed) {
        await api(`/api/system/${path}`, { method: 'PUT', body: { enabled: values[key] } });
        setSaved((current) => ({ ...current, [key]: values[key] }));
      }
      onSaved();
    });
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <SettingsSection
        title={t('system.title')}
        description={t('system.version', { version: data.version })}
        footer={
          <ActionBar
            primaryLabel={t('common.save')}
            busy={action.busy}
            dirty={changed.length > 0}
            feedback={action.feedback}
          />
        }
      >
        {SWITCHES.map(([, key]) => {
          const preset = key !== 'versionCheck' && data.preset[key];
          return (
            <Field
              key={key}
              label={t(`system.${key}`)}
              hint={preset ? t('system.preset') : t(`system.${key}.hint`)}
              checkbox
            >
              {(control) => (
                <input
                  {...control}
                  type="checkbox"
                  checked={values[key]}
                  disabled={preset}
                  onChange={(event) => setValues({ ...values, [key]: event.target.checked })}
                />
              )}
            </Field>
          );
        })}
      </SettingsSection>
    </form>
  );
}
