import type { VaultItemView } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { Link } from 'react-router';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import { Field } from '../../components/Field/Field.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { Row } from '../../components/Row/Row.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { useAction } from '../settings/useAction.ts';
import { formatSize, kindLabel, uploadVaultFile, type VaultList, vaultError } from './vault.ts';

const STATUS_TONE = { expired: 'err', expiring: 'warn', valid: 'ok', undated: 'neutral' } as const;

/**
 * Document vault: documents grouped by expiry, filter by kind, add a document with its file
 *
 * @returns {JSX.Element} - the page
 */
export function VaultPage() {
  const { t, locale } = useI18n();
  const { data, error, loading, reload } = useResource<VaultList>('/api/vault');
  const [kind, setKind] = useState('');
  const items = (data?.items ?? []).filter((item) => !kind || item.kind === kind);
  const groups = [
    ['vault.group.soon', items.filter((item) => item.status === 'expired' || item.status === 'expiring')],
    ['vault.group.valid', items.filter((item) => item.status === 'valid')],
    ['vault.group.undated', items.filter((item) => item.status === 'undated')],
  ] as const;

  return (
    <>
      <PageHeader
        title={t('vault.title')}
        subtitle={
          data &&
          t('vault.usage', {
            used: formatSize(data.usage.bytes, locale),
            quota: formatSize(data.usage.quotaBytes, locale),
          })
        }
      />
      {error !== undefined && <LoadError error={error} onRetry={reload} />}
      {loading && !data && <Skeleton rows={4} />}
      {data && (
        <div className={form.form}>
          <VaultAddForm data={data} onSaved={reload} />
          {data.items.length === 0 ? (
            <EmptyState title={t('vault.empty.title')} body={t('vault.empty.body')} />
          ) : (
            <>
              <SelectField
                label={t('vault.filter')}
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="">{t('vault.filter.all')}</option>
                {data.kinds.map((item) => (
                  <option key={item.id} value={item.id}>
                    {kindLabel(data.kinds, item.id, locale, t)}
                  </option>
                ))}
              </SelectField>
              {groups.map(
                ([title, group]) =>
                  group.length > 0 && (
                    <SettingsSection key={title} title={t(title)}>
                      <ul className={list.list}>
                        {group.map((item) => (
                          <li key={item.id}>
                            <VaultRow item={item} data={data} />
                          </li>
                        ))}
                      </ul>
                    </SettingsSection>
                  ),
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

/**
 * One document in the list
 *
 * @param props {{ item: VaultItemView; data: VaultList }} - document and kinds
 * @returns {JSX.Element} - the row
 */
function VaultRow({ item, data }: { item: VaultItemView; data: VaultList }) {
  const { t, locale } = useI18n();
  return (
    <Row
      primary={<Link to={`/vault/${item.id}`}>{item.title}</Link>}
      meta={[
        kindLabel(data.kinds, item.kind, locale, t),
        item.expiresOn && t('vault.expiresOn', { date: formatDate(item.expiresOn, locale) }),
        !item.file && t('vault.noFile'),
      ]
        .filter(Boolean)
        .join(' · ')}
      actions={<Badge tone={STATUS_TONE[item.status]}>{t(`vault.status.${item.status}`)}</Badge>}
    />
  );
}

/**
 * Form adding a document and, optionally, its file
 *
 * @param props {{ data: VaultList; onSaved: () => void }} - kinds and refresh callback
 * @returns {JSX.Element} - the form
 */
function VaultAddForm({ data, onSaved }: { data: VaultList; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const blank = { kind: data.kinds[0]?.id ?? 'other', title: '', issuedOn: '', expiresOn: '' };
  const [values, setValues] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const action = useAction((problem) => vaultError(problem, t));
  const kind = data.kinds.find((item) => item.id === values.kind);

  /**
   * Creates the document, then sends its file
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const ok = await action.run(async () => {
      const { item } = await api<{ item: VaultItemView }>('/api/vault', {
        method: 'POST',
        body: {
          kind: values.kind,
          title: values.title.trim() || kindLabel(data.kinds, values.kind, locale, t),
          issuedOn: values.issuedOn || null,
          expiresOn: values.expiresOn || null,
        },
      });
      if (file) setDuplicate((await uploadVaultFile(item.id, file)).duplicate);
      onSaved();
    });
    if (ok) {
      setValues(blank);
      setFile(null);
      form.reset();
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <SettingsSection
        title={t('vault.add')}
        description={t('vault.add.hint')}
        footer={<ActionBar primaryLabel={t('vault.save')} busy={action.busy} feedback={action.feedback} />}
      >
        {duplicate && <Notice tone="warn">{t('vault.duplicate')}</Notice>}
        <div className={form.grid}>
          <SelectField
            label={t('vault.kind')}
            value={values.kind}
            onChange={(event) => setValues({ ...values, kind: event.target.value })}
          >
            {data.kinds.map((item) => (
              <option key={item.id} value={item.id}>
                {kindLabel(data.kinds, item.id, locale, t)}
              </option>
            ))}
          </SelectField>
          <TextField
            label={`${t('vault.itemTitle')} ${t('common.optional')}`}
            maxLength={200}
            value={values.title}
            onChange={(event) => setValues({ ...values, title: event.target.value })}
          />
          <TextField
            label={`${t('vault.issuedOn')} ${t('common.optional')}`}
            type="date"
            value={values.issuedOn}
            onChange={(event) => setValues({ ...values, issuedOn: event.target.value })}
          />
          <TextField
            label={kind?.expires ? t('vault.expires') : `${t('vault.expires')} ${t('common.optional')}`}
            type="date"
            value={values.expiresOn}
            onChange={(event) => setValues({ ...values, expiresOn: event.target.value })}
          />
          <Field label={t('vault.file')} hint={t('vault.file.hint')}>
            {(control) => (
              <input
                {...control}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            )}
          </Field>
        </div>
      </SettingsSection>
    </form>
  );
}
