import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { useResource } from '../../lib/useResource.ts';
import type { VaultList } from './vault.ts';

/**
 * Picks a document of the vault, for example the receipt of an expense
 *
 * @param props {{ value: string | null; onChange: (id: string | null) => void }} - chosen document and callback
 * @returns {JSX.Element | null} - the field, null while the vault is empty
 */
export function VaultItemSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const { data } = useResource<VaultList>('/api/vault');
  if (!data || data.items.length === 0) return null;
  return (
    <SelectField
      label={t('expenses.receipt')}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{t('expenses.receipt.none')}</option>
      {data.items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.title}
        </option>
      ))}
    </SelectField>
  );
}
