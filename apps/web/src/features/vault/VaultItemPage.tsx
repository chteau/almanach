import type { VaultItemView } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { DangerAction, DangerZone } from '../../components/DangerZone/DangerZone.tsx';
import { Field } from '../../components/Field/Field.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { Row } from '../../components/Row/Row.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextAreaField } from '../../components/TextAreaField/TextAreaField.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { useAction } from '../settings/useAction.ts';
import { formatSize, kindLabel, uploadVaultFile, type VaultList, vaultError } from './vault.ts';

/**
 * One document of the vault: details, file and its versions, deletion
 *
 * @returns {JSX.Element} - the page
 */
export function VaultItemPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useResource<{ item: VaultItemView }>(`/api/vault/${id}`);
  const kinds = useResource<VaultList>('/api/vault').data?.kinds ?? [];
  const item = data?.item;
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (loading && !item) return <Skeleton rows={4} />;
  if (!item) return null;

  return (
    <>
      <PageHeader
        width="narrow"
        title={item.title}
        subtitle={
          <>
            {kindLabel(kinds, item.kind, locale, t)}{' '}
            <Badge tone={item.status === 'expired' ? 'err' : item.status === 'expiring' ? 'warn' : 'neutral'}>
              {t(`vault.status.${item.status}`)}
            </Badge>
          </>
        }
      />
      <div className={form.form}>
        <VaultDetailsForm key={item.id} item={item} onSaved={reload} />
        <VaultFiles item={item} onSaved={reload} />
        <DangerZone>
          <DangerAction
            label={t('vault.delete')}
            consequence={t('vault.delete.body')}
            actionLabel={t('common.delete')}
            onConfirm={() =>
              void api(`/api/vault/${item.id}`, { method: 'DELETE' }).then(() => navigate('/vault'))
            }
          />
        </DangerZone>
      </div>
    </>
  );
}

/**
 * Editable details of a document
 *
 * @param props {{ item: VaultItemView; onSaved: () => void }} - document and refresh callback
 * @returns {JSX.Element} - the form
 */
function VaultDetailsForm({ item, onSaved }: { item: VaultItemView; onSaved: () => void }) {
  const { t } = useI18n();
  const initial = {
    title: item.title,
    issuedOn: item.issuedOn ?? '',
    expiresOn: item.expiresOn ?? '',
    notes: item.notes,
  };
  const [values, setValues] = useState(initial);
  const action = useAction();

  /**
   * Saves the details
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    await action.run(async () => {
      const { id: _id, file: _file, versions: _versions, status: _status, ...rest } = item;
      await api(`/api/vault/${item.id}`, {
        method: 'PUT',
        body: {
          ...rest,
          title: values.title,
          issuedOn: values.issuedOn || null,
          expiresOn: values.expiresOn || null,
          notes: values.notes,
        },
      });
      onSaved();
    });
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <SettingsSection
        title={t('vault.details')}
        footer={
          <ActionBar
            primaryLabel={t('common.save')}
            busy={action.busy}
            dirty={JSON.stringify(values) !== JSON.stringify(initial)}
            feedback={action.feedback}
          />
        }
      >
        <div className={form.grid}>
          <TextField
            label={t('vault.itemTitle')}
            maxLength={200}
            required
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
            label={`${t('vault.expires')} ${t('common.optional')}`}
            type="date"
            value={values.expiresOn}
            onChange={(event) => setValues({ ...values, expiresOn: event.target.value })}
          />
        </div>
        <TextAreaField
          label={`${t('vault.notes')} ${t('common.optional')}`}
          maxLength={2000}
          value={values.notes}
          onChange={(event) => setValues({ ...values, notes: event.target.value })}
        />
      </SettingsSection>
    </form>
  );
}

/**
 * Current file, older versions kept a year, and the upload of a new version
 *
 * @param props {{ item: VaultItemView; onSaved: () => void }} - document and refresh callback
 * @returns {JSX.Element} - the section
 */
function VaultFiles({ item, onSaved }: { item: VaultItemView; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const action = useAction((problem) => vaultError(problem, t));

  /**
   * Sends the chosen file as a new version
   *
   * @returns {Promise<void>} - resolves when done
   */
  async function send(): Promise<void> {
    if (!file) return;
    await action.run(async () => {
      setDuplicate((await uploadVaultFile(item.id, file)).duplicate);
      setFile(null);
      onSaved();
    });
  }

  return (
    <SettingsSection
      title={t('vault.files')}
      description={t('vault.files.hint')}
      footer={
        <ActionBar
          primaryLabel={item.file ? t('vault.replace') : t('vault.upload')}
          onPrimary={() => void send()}
          disabled={!file}
          busy={action.busy}
          feedback={action.feedback}
        />
      }
    >
      {duplicate && <Notice tone="warn">{t('vault.duplicate')}</Notice>}
      {(item.versions ?? []).length > 0 && (
        <ul className={list.list}>
          {(item.versions ?? []).map((version) => (
            <li key={version.id}>
              <Row
                primary={
                  <a href={`/api/vault/${item.id}/file?version=${version.id}`} download>
                    {version.fileName}
                  </a>
                }
                meta={[
                  formatSize(version.sizeBytes, locale),
                  formatDate(version.createdAt.slice(0, 10), locale),
                  version.supersededAt
                    ? t('vault.replacedOn', { date: formatDate(version.supersededAt.slice(0, 10), locale) })
                    : t('vault.current'),
                ].join(' · ')}
              />
            </li>
          ))}
        </ul>
      )}
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
    </SettingsSection>
  );
}
