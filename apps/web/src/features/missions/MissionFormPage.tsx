import {
  BILLING_TYPES,
  type Client,
  MISSION_STATUSES,
  type Mission,
  type MissionInput,
  missionInputSchema,
  parseAmount,
} from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Button } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextAreaField } from '../../components/TextAreaField/TextAreaField.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { ApiError, api } from '../../lib/api.ts';
import { fieldErrors, serverIssues, zodIssues } from '../../lib/form-errors.ts';
import { centsToInput, today } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { useUnsavedGuard } from '../../lib/useUnsavedGuard.ts';
import { describeError } from '../install/errors.ts';
import { CURRENCIES } from '../onboarding/form.ts';

interface Draft {
  clientId: string;
  name: string;
  status: MissionInput['status'];
  billing: MissionInput['billing'];
  rate: string;
  currency: string;
  startDate: string;
  endDate: string;
  budget: string;
  endClient: string;
  notes: string;
}

/**
 * Create or edit a mission (P10: S-120, S-125, S-126)
 *
 * @returns {JSX.Element} - the page
 */
export function MissionFormPage() {
  const { id } = useParams();
  const existing = useResource<{ mission: Mission }>(id ? `/api/missions/${id}` : null);
  const clients = useResource<{ clients: Client[] }>('/api/clients');
  const failed = existing.error ?? clients.error;
  if (failed !== undefined)
    return (
      <LoadError
        error={failed}
        onRetry={() => {
          existing.reload();
          clients.reload();
        }}
      />
    );
  if ((id && !existing.data) || !clients.data) return <Skeleton />;
  return <MissionForm key={id ?? 'new'} initial={existing.data?.mission} clients={clients.data.clients} />;
}

/**
 * The mission form, mounted once its data is loaded
 *
 * @param props {{ initial?: Mission; clients: Client[] }} - mission being edited and the selectable clients
 * @returns {JSX.Element} - the form
 */
function MissionForm({ initial, clients }: { initial?: Mission | undefined; clients: Client[] }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selectable = clients.filter((client) => !client.archived || client.id === initial?.clientId);
  const preset = selectable.find((client) => client.id === params.get('client')) ?? selectable[0];
  const [draft, setDraft] = useState<Draft>(() =>
    initial
      ? {
          clientId: initial.clientId,
          name: initial.name,
          status: initial.status,
          billing: initial.billing,
          rate: centsToInput(initial.rateCents, locale),
          currency: initial.currency,
          startDate: initial.startDate,
          endDate: initial.endDate ?? '',
          budget: centsToInput(initial.budgetCents, locale),
          endClient: initial.endClient ?? '',
          notes: initial.notes ?? '',
        }
      : {
          clientId: preset?.id ?? '',
          name: '',
          status: 'active',
          billing: 'daily',
          rate: '',
          currency: preset?.currency ?? 'EUR',
          startDate: today(),
          endDate: '',
          budget: '',
          endClient: '',
          notes: '',
        },
  );
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const allowLeave = useUnsavedGuard(dirty, t('common.unsaved'));

  if (selectable.length === 0) {
    return (
      <>
        <PageHeader width="narrow" title={t('missions.new')} />
        <Notice tone="info">{t('missions.noClient')}</Notice>
      </>
    );
  }

  /**
   * Applies a change to the draft
   *
   * @param patch {Partial<Draft>} - changed fields
   * @returns {void} - nothing
   */
  function change(patch: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  /**
   * Validates and saves; amounts are converted to integer cents before leaving the browser
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function save(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const rateCents = parseAmount(draft.rate);
    const budgetCents = draft.budget.trim() ? parseAmount(draft.budget) : null;
    const found: Record<string, MessageKey> = {};
    if (rateCents === null) found.rateCents = 'errors.amount';
    if (draft.budget.trim() && budgetCents === null) found.budgetCents = 'errors.amount';
    const payload = {
      clientId: draft.clientId,
      name: draft.name,
      status: draft.status,
      billing: draft.billing,
      rateCents: rateCents ?? 0,
      currency: draft.currency,
      startDate: draft.startDate,
      endDate: draft.endDate || null,
      budgetCents,
      endClient: draft.endClient,
      notes: draft.notes,
    };
    const parsed = missionInputSchema.safeParse(payload);
    if (!parsed.success) Object.assign(found, { ...fieldErrors(zodIssues(parsed.error)), ...found });
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFailure(t('common.form.invalid'));
      return;
    }
    setFailure(undefined);
    setBusy(true);
    try {
      const result = initial
        ? await api<{ mission: Mission }>(`/api/missions/${initial.id}`, { method: 'PUT', body: payload })
        : await api<{ mission: Mission }>('/api/missions', { method: 'POST', body: payload });
      allowLeave();
      navigate(`/missions/${result.mission.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setErrors(fieldErrors(serverIssues(error.body)));
        setFailure(t('common.form.invalid'));
      } else setFailure(describeError(error, t));
    } finally {
      setBusy(false);
    }
  }

  const err = (path: string) => (errors[path] ? t(errors[path]) : undefined);

  return (
    <>
      <PageHeader
        width="narrow"
        title={initial ? t('missions.edit', { name: initial.name }) : t('missions.new')}
      />
      <form className={form.form} onSubmit={(event) => void save(event)} noValidate>
        {failure && (
          <Notice tone="error" live>
            {failure}
          </Notice>
        )}
        <fieldset className={form.section}>
          <legend>{t('missions.section.general')}</legend>
          <TextField
            label={t('missions.name')}
            value={draft.name}
            onChange={(e) => change({ name: e.target.value })}
            error={err('name')}
            maxLength={160}
            required
          />
          <div className={form.grid}>
            <SelectField
              label={t('missions.client')}
              value={draft.clientId}
              onChange={(e) => {
                const chosen = selectable.find((client) => client.id === e.target.value);
                change({
                  clientId: e.target.value,
                  currency: initial ? draft.currency : (chosen?.currency ?? draft.currency),
                });
              }}
              error={err('clientId')}
            >
              {selectable.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t('missions.status')}
              value={draft.status}
              onChange={(e) => change({ status: e.target.value as Draft['status'] })}
            >
              {MISSION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`missions.status.${status}`)}
                </option>
              ))}
            </SelectField>
          </div>
          <TextField
            label={`${t('missions.endClient')} ${t('common.optional')}`}
            hint={t('missions.endClient.hint')}
            value={draft.endClient}
            onChange={(e) => change({ endClient: e.target.value })}
            maxLength={160}
          />
          <div className={form.grid}>
            <TextField
              label={t('missions.start')}
              type="date"
              value={draft.startDate}
              onChange={(e) => change({ startDate: e.target.value })}
              error={err('startDate')}
              required
            />
            <TextField
              label={`${t('missions.end')} ${t('common.optional')}`}
              type="date"
              value={draft.endDate}
              onChange={(e) => change({ endDate: e.target.value })}
              error={err('endDate')}
            />
          </div>
        </fieldset>
        <fieldset className={form.section}>
          <legend>{t('missions.section.pricing')}</legend>
          <div className={form.radios} role="radiogroup" aria-label={t('missions.billing')}>
            {BILLING_TYPES.map((billing) => (
              <label key={billing}>
                <input
                  type="radio"
                  name="billing"
                  checked={draft.billing === billing}
                  onChange={() => change({ billing })}
                />
                {t(`missions.billing.${billing}`)}
              </label>
            ))}
          </div>
          <div className={form.grid}>
            <TextField
              label={t(`missions.rate.${draft.billing}`)}
              inputMode="decimal"
              value={draft.rate}
              onChange={(e) => change({ rate: e.target.value })}
              error={err('rateCents')}
              required
            />
            <SelectField
              label={t('clients.currency')}
              value={draft.currency}
              onChange={(e) => change({ currency: e.target.value })}
            >
              {CURRENCIES.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </SelectField>
            <TextField
              label={`${t('missions.budget')} ${t('common.optional')}`}
              inputMode="decimal"
              value={draft.budget}
              onChange={(e) => change({ budget: e.target.value })}
              error={err('budgetCents')}
            />
          </div>
        </fieldset>
        <TextAreaField
          label={t('clients.notes')}
          value={draft.notes}
          onChange={(e) => change({ notes: e.target.value })}
          maxLength={5000}
        />
        <div className={form.actions}>
          <Button variant="ghost" onClick={() => navigate(-1)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </>
  );
}
