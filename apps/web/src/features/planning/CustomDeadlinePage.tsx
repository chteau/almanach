import { type SyntheticEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextAreaField } from '../../components/TextAreaField/TextAreaField.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { today } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { useUnsavedGuard } from '../../lib/useUnsavedGuard.ts';
import { describeError } from '../install/errors.ts';

interface Custom {
  id: string;
  title: string;
  date: string;
  recurrence: 'none' | 'monthly' | 'quarterly' | 'yearly';
  until: string | null;
  notes: string | null;
}

/**
 * Creates or edits a personal deadline, once or recurring (S-063)
 *
 * @returns {JSX.Element} - the page
 */
export function CustomDeadlinePage() {
  const { id } = useParams();
  const { data, error, reload } = useResource<{ deadlines: Custom[] }>(id ? '/api/custom-deadlines' : null);
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (id && !data) return <Skeleton rows={4} />;
  const existing = data?.deadlines.find((item) => item.id === id) ?? null;
  return <CustomForm key={existing?.id ?? 'new'} existing={existing} />;
}

/**
 * Form body of the personal deadline page
 *
 * @param props {{ existing: Custom | null }} - deadline being edited, null when creating
 * @returns {JSX.Element} - the form
 */
function CustomForm({ existing }: { existing: Custom | null }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(existing?.date ?? today());
  const [recurrence, setRecurrence] = useState<Custom['recurrence']>(existing?.recurrence ?? 'none');
  const [until, setUntil] = useState(existing?.until ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const allowLeave = useUnsavedGuard(dirty, t('common.unsaved'));

  /**
   * Wraps a setter so any change marks the form dirty
   *
   * @param setter {(value: T) => void} - state setter
   * @returns {(value: T) => void} - wrapped setter
   */
  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setDirty(true);
    };

  /**
   * Validates and saves
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when saved
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!title.trim()) found.title = t('custom.title.required');
    if (recurrence !== 'none' && until && until < date) found.until = t('custom.until.before');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const body = { title, date, recurrence, until: recurrence === 'none' || !until ? null : until, notes };
    try {
      if (existing) await api(`/api/custom-deadlines/${existing.id}`, { method: 'PUT', body });
      else await api('/api/custom-deadlines', { method: 'POST', body });
      allowLeave();
      navigate('/calendar');
    } catch (problem) {
      setFailure(problem instanceof ApiError ? describeError(problem, t) : String(problem));
    }
  }

  /**
   * Deletes the deadline and its history after confirmation
   *
   * @returns {Promise<void>} - resolves when deleted
   */
  async function remove(): Promise<void> {
    setConfirmDelete(false);
    if (!existing) return;
    await api(`/api/custom-deadlines/${existing.id}`, { method: 'DELETE' }).catch(() => undefined);
    allowLeave();
    navigate('/calendar', { replace: true });
  }

  return (
    <>
      <PageHeader title={existing ? existing.title : t('custom.new')} />
      <form className={form.form} onSubmit={(event) => void submit(event)} noValidate>
        {failure && <Notice tone="error">{failure}</Notice>}
        <TextField
          label={t('custom.title')}
          hint={t('custom.title.hint')}
          value={title}
          maxLength={120}
          onChange={(event) => edit(setTitle)(event.target.value)}
          error={errors.title}
          required
        />
        <div className={form.grid}>
          <TextField
            label={t('custom.date')}
            type="date"
            value={date}
            onChange={(event) => edit(setDate)(event.target.value)}
            required
          />
          <SelectField
            label={t('custom.recurrence')}
            value={recurrence}
            onChange={(event) => edit(setRecurrence)(event.target.value as Custom['recurrence'])}
          >
            {(['none', 'monthly', 'quarterly', 'yearly'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`custom.recurrence.${value}`)}
              </option>
            ))}
          </SelectField>
          {recurrence !== 'none' && (
            <TextField
              label={`${t('custom.until')} ${t('common.optional')}`}
              type="date"
              value={until}
              onChange={(event) => edit(setUntil)(event.target.value)}
              error={errors.until}
            />
          )}
        </div>
        <TextAreaField
          label={`${t('custom.notes')} ${t('common.optional')}`}
          value={notes}
          maxLength={1000}
          onChange={(event) => edit(setNotes)(event.target.value)}
        />
        <div className={form.actions}>
          {existing && (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              {t('common.delete')}
            </Button>
          )}
          <Button type="submit">{t('common.save')}</Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirmDelete}
        title={t('custom.delete')}
        body={t('custom.delete.body')}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
