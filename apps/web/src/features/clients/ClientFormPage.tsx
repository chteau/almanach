import {
  type Client,
  type ClientInput,
  COUNTRY_CODES,
  clientInputSchema,
  isEuCountry,
  LOCALES,
} from '@almanach/shared';
import { type SyntheticEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
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
import { countryName } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { useUnsavedGuard } from '../../lib/useUnsavedGuard.ts';
import { describeError } from '../install/errors.ts';
import { CURRENCIES } from '../onboarding/form.ts';
import { useProfile } from '../profile/useProfile.ts';

type Draft = Omit<
  ClientInput,
  'email' | 'phone' | 'address' | 'vatNumber' | 'siret' | 'notes' | 'allowDuplicate'
> & {
  email: string;
  phone: string;
  address: string;
  vatNumber: string;
  siret: string;
  notes: string;
};

/**
 * Converts a stored client to editable strings
 *
 * @param client {Client} - stored client
 * @returns {Draft} - editable draft
 */
function toDraft(client: Client): Draft {
  return {
    kind: client.kind,
    name: client.name,
    email: client.email ?? '',
    phone: client.phone ?? '',
    address: client.address ?? '',
    country: client.country,
    vatNumber: client.vatNumber ?? '',
    siret: client.siret ?? '',
    currency: client.currency,
    language: client.language,
    paymentTermsDays: client.paymentTermsDays,
    contacts: client.contacts,
    notes: client.notes ?? '',
  };
}

/**
 * Create or edit a client (P08: S-100 to S-107, duplicate warning S-093)
 *
 * @returns {JSX.Element} - the page
 */
export function ClientFormPage() {
  const { id } = useParams();
  const existing = useResource<{ client: Client }>(id ? `/api/clients/${id}` : null);
  // Defaults are a convenience: if they cannot be loaded, the form still opens with 30 days.
  const billing = useResource<{ settings: { defaultTermsDays: number } }>(id ? null : '/api/billing');
  if (!id && !billing.data && billing.error === undefined) return <Skeleton />;
  if (id && !existing.data) {
    return existing.error !== undefined ? (
      <LoadError error={existing.error} onRetry={existing.reload} />
    ) : (
      <Skeleton />
    );
  }
  return (
    <ClientForm
      key={id ?? 'new'}
      initial={existing.data?.client}
      defaultTerms={billing.data?.settings.defaultTermsDays ?? 30}
    />
  );
}

/**
 * The client form itself, mounted once the data to edit is known
 *
 * @param props {{ initial?: Client; defaultTerms: number }} - client being edited (undefined to create) and default payment terms
 * @returns {JSX.Element} - the form
 */
function ClientForm({ initial, defaultTerms }: { initial?: Client | undefined; defaultTerms: number }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const profile = useProfile();
  const [draft, setDraft] = useState<Draft>(() =>
    initial
      ? toDraft(initial)
      : {
          kind: 'company',
          name: '',
          email: '',
          phone: '',
          address: '',
          country: 'FR',
          vatNumber: '',
          siret: '',
          currency: 'EUR',
          language: locale,
          paymentTermsDays: defaultTerms,
          contacts: [],
          notes: '',
        },
  );
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [failure, setFailure] = useState<string>();
  const [duplicates, setDuplicates] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const allowLeave = useUnsavedGuard(dirty, t('common.unsaved'));

  useEffect(() => {
    if (initial || !profile) return;
    setDraft((current) => ({ ...current, country: profile.country, currency: profile.currency }));
  }, [initial, profile]);

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
   * Validates locally, then saves; the server validates again and checks for duplicates
   *
   * @param event {SyntheticEvent} - submission
   * @param allowDuplicate {boolean} - true once the person confirmed a possible duplicate
   * @returns {Promise<void>} - resolves when done
   */
  async function save(event: SyntheticEvent | null, allowDuplicate = false): Promise<void> {
    event?.preventDefault();
    const payload: ClientInput = {
      ...draft,
      email: draft.email.trim() || null,
      ...(allowDuplicate ? { allowDuplicate } : {}),
    };
    const parsed = clientInputSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(fieldErrors(zodIssues(parsed.error)));
      setFailure(t('common.form.invalid'));
      return;
    }
    setErrors({});
    setFailure(undefined);
    setBusy(true);
    try {
      const result = initial
        ? await api<{ client: Client }>(`/api/clients/${initial.id}`, { method: 'PUT', body: payload })
        : await api<{ client: Client }>('/api/clients', { method: 'POST', body: payload });
      allowLeave();
      navigate(`/clients/${result.client.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.body.error === 'possible_duplicate') {
        setDuplicates((error.body as unknown as { matches: { id: string; name: string }[] }).matches);
      } else if (error instanceof ApiError && error.status === 422) {
        setErrors(fieldErrors(serverIssues(error.body)));
        setFailure(t('common.form.invalid'));
      } else setFailure(describeError(error, t));
    } finally {
      setBusy(false);
    }
  }

  const err = (path: string) => (errors[path] ? t(errors[path]) : undefined);
  const showVatWarning =
    draft.kind === 'company' &&
    isEuCountry(draft.country) &&
    profile &&
    draft.country !== profile.country &&
    !draft.vatNumber.trim();

  return (
    <>
      <PageHeader
        width="narrow"
        title={initial ? t('clients.edit', { name: initial.name }) : t('clients.new')}
      />
      <form className={form.form} onSubmit={(event) => void save(event)} noValidate>
        {failure && (
          <Notice tone="error" live>
            {failure}
          </Notice>
        )}
        {initial?.stripeId && <Notice tone="info">{t('clients.stripe.edit')}</Notice>}
        {duplicates.length > 0 && (
          <Notice tone="warn">
            <p className={form.summary}>
              {t('clients.duplicate', { names: duplicates.map((duplicate) => duplicate.name).join(', ') })}
            </p>
            <Button variant="ghost" onClick={() => void save(null, true)}>
              {t('clients.duplicate.confirm')}
            </Button>
          </Notice>
        )}
        <fieldset className={form.section}>
          <legend>{t('clients.section.identity')}</legend>
          <div className={form.radios} role="radiogroup" aria-label={t('clients.kind')}>
            {(['company', 'individual'] as const).map((kind) => (
              <label key={kind}>
                <input
                  type="radio"
                  name="kind"
                  checked={draft.kind === kind}
                  onChange={() => change({ kind })}
                />
                {t(`clients.kind.${kind}`)}
              </label>
            ))}
          </div>
          <TextField
            label={t('clients.name')}
            value={draft.name}
            onChange={(e) => change({ name: e.target.value })}
            error={err('name')}
            maxLength={160}
            required
          />
          <div className={form.grid}>
            <TextField
              label={t('clients.email')}
              type="email"
              value={draft.email}
              onChange={(e) => change({ email: e.target.value })}
              error={err('email')}
            />
            <TextField
              label={t('clients.phone')}
              type="tel"
              value={draft.phone}
              onChange={(e) => change({ phone: e.target.value })}
              error={err('phone')}
            />
          </div>
          <TextAreaField
            label={t('clients.address')}
            value={draft.address}
            onChange={(e) => change({ address: e.target.value })}
            error={err('address')}
            maxLength={500}
          />
          <div className={form.grid}>
            <SelectField
              label={t('clients.country')}
              value={draft.country}
              onChange={(e) => change({ country: e.target.value })}
            >
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>
                  {countryName(code, locale)}
                </option>
              ))}
            </SelectField>
            {draft.kind === 'company' && (
              <TextField
                label={t('clients.vat')}
                hint={isEuCountry(draft.country) ? t('clients.vat.hint') : undefined}
                value={draft.vatNumber}
                onChange={(e) => change({ vatNumber: e.target.value })}
                error={err('vatNumber')}
                spellCheck={false}
              />
            )}
            {draft.kind === 'company' && (
              <TextField
                label={t('clients.siret')}
                value={draft.siret}
                onChange={(e) => change({ siret: e.target.value.replace(/\s/g, '') })}
                error={err('siret')}
                inputMode="numeric"
                spellCheck={false}
              />
            )}
          </div>
          {showVatWarning && <Notice tone="warn">{t('clients.vat.missing')}</Notice>}
        </fieldset>
        <fieldset className={form.section}>
          <legend>{t('clients.section.billing')}</legend>
          <div className={form.grid}>
            <SelectField
              label={t('clients.language')}
              value={draft.language}
              onChange={(e) => change({ language: e.target.value as Draft['language'] })}
            >
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {t(`lang.${code}`)}
                </option>
              ))}
            </SelectField>
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
              label={t('clients.terms')}
              type="number"
              inputMode="numeric"
              min={0}
              max={120}
              value={draft.paymentTermsDays}
              onChange={(e) => change({ paymentTermsDays: Number(e.target.value) })}
              error={err('paymentTermsDays')}
            />
          </div>
        </fieldset>
        <fieldset className={form.section}>
          <legend>{t('clients.contacts')}</legend>
          {err('contacts') && (
            <Notice tone="error" live>
              {err('contacts')}
            </Notice>
          )}
          {draft.contacts.map((contact, index) => {
            const set = (patch: Partial<typeof contact>) =>
              change({
                contacts: draft.contacts.map((item, position) =>
                  position === index ? { ...item, ...patch } : item,
                ),
              });
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: contacts have no id and are edited in place
              <div key={index} className={form.contact}>
                <div className={form.grid}>
                  <TextField
                    label={t('clients.contact.name')}
                    value={contact.name}
                    onChange={(e) => set({ name: e.target.value })}
                    error={err(`contacts.${index}.name`)}
                  />
                  <TextField
                    label={t('clients.contact.role')}
                    value={contact.role ?? ''}
                    onChange={(e) => set({ role: e.target.value })}
                  />
                  <TextField
                    label={t('clients.email')}
                    type="email"
                    value={contact.email ?? ''}
                    onChange={(e) => set({ email: e.target.value || null })}
                    error={err(`contacts.${index}.email`)}
                  />
                  <TextField
                    label={t('clients.phone')}
                    type="tel"
                    value={contact.phone ?? ''}
                    onChange={(e) => set({ phone: e.target.value })}
                  />
                </div>
                <label className={form.check}>
                  <input
                    type="checkbox"
                    checked={contact.billing}
                    onChange={(e) => set({ billing: e.target.checked })}
                  />
                  {t('clients.contact.billing')}
                </label>
                <Button
                  variant="ghost"
                  onClick={() =>
                    change({ contacts: draft.contacts.filter((_, position) => position !== index) })
                  }
                >
                  {t('clients.contact.remove')}
                </Button>
              </div>
            );
          })}
          {draft.contacts.length < 10 && (
            <Button
              variant="ghost"
              onClick={() =>
                change({
                  contacts: [
                    ...draft.contacts,
                    { name: '', email: null, phone: '', role: '', billing: false },
                  ],
                })
              }
            >
              {t('clients.contact.add')}
            </Button>
          )}
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
