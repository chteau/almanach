import type { LinkedRecords } from '@almanach/shared';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { Activity } from './activity.ts';

/**
 * "Activity" filter of the lists: every activity, this instance, or one linked instance; hidden while no
 * linked instance shares its detail
 *
 * @param props {{ linked: LinkedRecords | undefined; value: Activity; onChange: (value: Activity) => void }} - sources, value and setter
 * @returns {JSX.Element | null} - the select, or nothing
 */
export function ActivityFilter({
  linked,
  value,
  onChange,
}: {
  linked: LinkedRecords | undefined;
  value: Activity;
  onChange: (value: Activity) => void;
}) {
  const { t } = useI18n();
  if (!linked?.sources.length) return null;
  return (
    <SelectField
      label={t('linked.activity')}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{t('common.all')}</option>
      <option value="here">{t('linked.activity.here')}</option>
      {linked.sources.map((source) => (
        <option key={source.id} value={source.id}>
          {source.test ? `${source.label} (${t('linked.dev')})` : source.label}
        </option>
      ))}
    </SelectField>
  );
}
