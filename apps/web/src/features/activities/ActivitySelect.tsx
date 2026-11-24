import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { statusLabel, useActivities } from './useActivities.ts';

interface ActivitySelectProps {
  /** Null for the main activity, or for "inherit" when inheritLabel is given. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Label of the empty choice when the record follows another one (a payment follows its invoice). */
  inheritLabel?: string;
  disabled?: boolean;
}

/**
 * Chooses the activity a record belongs to; hidden while the company has only its main activity
 *
 * @param props {ActivitySelectProps} - value, change handler, optional inherit label and disabled flag
 * @returns {JSX.Element | null} - the field, or nothing without secondary activities
 */
export function ActivitySelect({ value, onChange, inheritLabel, disabled }: ActivitySelectProps) {
  const { t, locale } = useI18n();
  const { data } = useActivities();
  if (!data || data.activities.length < 2) return null;
  return (
    <SelectField
      label={t('activities.field')}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value || null)}
    >
      {data.activities
        .filter((activity) => !(inheritLabel && activity.main))
        .map((activity) => (
          <option key={activity.id ?? 'main'} value={activity.id ?? ''}>
            {activity.main
              ? t('activities.mainOption', { activity: statusLabel(data.statuses, activity.status, locale) })
              : statusLabel(data.statuses, activity.status, locale)}
          </option>
        ))}
      {inheritLabel && <option value="">{inheritLabel}</option>}
    </SelectField>
  );
}
