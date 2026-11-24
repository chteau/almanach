import {
  type Client,
  computeTotals,
  type DocumentDraft,
  type DocumentType,
  type DocumentView,
  documentDraftSchema,
  facturxRules,
  type Line,
  LOCALES,
  type Mission,
  parseAmount,
  QUANTITY_SCALE,
  UNITS,
  type Unit,
} from '@almanach/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import { Field } from '../../components/Field/Field.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { TextAreaField } from '../../components/TextAreaField/TextAreaField.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { ApiError, api } from '../../lib/api.ts';
import { centsToInput, formatDate, formatMoney, today } from '../../lib/format.ts';
import { useUnsavedGuard } from '../../lib/useUnsavedGuard.ts';
import { ActivitySelect } from '../activities/ActivitySelect.tsx';
import { describeError } from '../install/errors.ts';
import { CURRENCIES } from '../onboarding/form.ts';
import { usePack } from '../profile/useProfile.ts';
import styles from './DocumentEditor.module.css';
import { listPath, parsePercent, parseQuantity } from './labels.ts';

interface EditorLine {
  /** Stable React key; never sent to the server. */
  key: number;
  description: string;
  quantity: string;
  unit: Unit;
  price: string;
  discount: string;
}

interface Draft {
  type: DocumentType;
  clientId: string;
  missionId: string;
  issueDate: string;
  validUntil: string;
  language: DocumentDraft['language'];
  currency: string;
  lines: EditorLine[];
  discount: string;
  note: string;
  depositIds: string[];
  activityId: string | null;
  /** PDF + Factur-X requested. */
  einvoice: boolean;
}

let nextLineKey = 0;

const UNIT_FOR_BILLING: Record<string, Unit> = {
  fixed: 'flat',
  daily: 'day',
  hourly: 'hour',
  monthly: 'month',
};

/**
 * Converts stored lines to editable strings
 *
 * @param line {Line} - stored line
 * @param locale {string} - UI language for the decimal separator
 * @returns {EditorLine} - editable line
 */
function toEditorLine(line: Line, locale: string): EditorLine {
  return {
    key: nextLineKey++,
    description: line.description,
    quantity:
      locale === 'en'
        ? String(line.quantity / QUANTITY_SCALE)
        : String(line.quantity / QUANTITY_SCALE).replace('.', ','),
    unit: line.unit,
    price: centsToInput(line.unitPriceCents, locale),
    discount: line.discountBp ? String(line.discountBp / 100) : '',
  };
}

/**
 * Builds the API payload; invalid numbers make the draft unsaveable and are reported per line
 *
 * @param draft {Draft} - editor state
 * @returns {{ payload: DocumentDraft | null; lineErrors: Record<number, MessageKey> }} - payload or errors
 */
function toPayload(draft: Draft): { payload: DocumentDraft | null; lineErrors: Record<number, MessageKey> } {
  const lineErrors: Record<number, MessageKey> = {};
  const lines: Line[] = [];
  draft.lines.forEach((line, index) => {
    const quantity = parseQuantity(line.quantity);
    const price = parseAmount(line.price);
    const discount = parsePercent(line.discount);
    if (!line.description.trim()) lineErrors[index] = 'documents.line.description.required';
    else if (quantity === null) lineErrors[index] = 'documents.line.quantity.invalid';
    else if (price === null) lineErrors[index] = 'errors.amount';
    else if (discount === null) lineErrors[index] = 'documents.line.discount.invalid';
    else
      lines.push({
        description: line.description.trim(),
        quantity,
        unit: line.unit,
        unitPriceCents: price,
        discountBp: discount,
      });
  });
  const discountBp = parsePercent(draft.discount);
  if (Object.keys(lineErrors).length > 0 || discountBp === null) return { payload: null, lineErrors };
  const payload: DocumentDraft = {
    type: draft.type,
    clientId: draft.clientId,
    missionId: draft.missionId || null,
    issueDate: draft.issueDate,
    validUntil: draft.type === 'quote' ? draft.validUntil || null : null,
    language: draft.language,
    currency: draft.currency,
    lines,
    discountBp,
    note: draft.note,
    depositIds: draft.depositIds,
    activityId: draft.activityId,
    einvoice: draft.einvoice,
  };
  return documentDraftSchema.safeParse(payload).success
    ? { payload, lineErrors }
    : { payload: null, lineErrors };
}

interface EditorProps {
  initial: DocumentView | null;
  missing: string[];
  /** What a Factur-X still needs, null when the country does not offer it. */
  einvoiceMissing: string[] | null;
  /** PDF + Factur-X preselected on new invoices to business clients. */
  facturxDefault: boolean;
  type: DocumentType;
  clients: Client[];
  missions: Mission[];
  deposits: DocumentView[];
  presetClient: string | null;
  presetMission: string | null;
  /** Note prefilled on new documents (S-236). */
  defaultNote: string;
  onIssued: () => void;
}

/**
 * Draft editor for quotes, invoices, deposit invoices and credit notes (P14). Saves automatically,
 * shows server-computed VAT and mentions, and issues with explicit confirmation (S-160 to S-174).
 *
 * @param props {EditorProps} - document, reference data and callbacks
 * @returns {JSX.Element} - the editor
 */
export function DocumentEditor(props: EditorProps) {
  const { initial, type, clients, missions, deposits, onIssued } = props;
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const selectable = clients.filter((client) => !client.archived || client.id === initial?.clientId);
  const preset =
    selectable.find((client) => client.id === (initial?.clientId ?? props.presetClient)) ?? selectable[0];
  const presetMission = missions.find(
    (mission) => mission.id === props.presetMission && mission.clientId === preset?.id,
  );

  const [draft, setDraft] = useState<Draft>(() =>
    initial
      ? {
          type: initial.type,
          clientId: initial.clientId,
          missionId: initial.missionId ?? '',
          issueDate: initial.issueDate,
          validUntil: initial.validUntil ?? '',
          language: initial.language,
          currency: initial.currency,
          lines: initial.lines.map((line) => toEditorLine(line, locale)),
          discount: initial.discountBp ? String(initial.discountBp / 100) : '',
          note: initial.note ?? '',
          depositIds: initial.depositIds,
          activityId: initial.activityId,
          einvoice: initial.einvoiceFormat === 'facturx',
        }
      : {
          type,
          clientId: preset?.id ?? '',
          missionId: presetMission?.id ?? '',
          issueDate: today(),
          validUntil:
            type === 'quote' ? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) : '',
          language: preset?.language ?? 'fr',
          currency: presetMission?.currency ?? preset?.currency ?? 'EUR',
          lines: presetMission
            ? [
                {
                  key: nextLineKey++,
                  description: presetMission.name,
                  quantity: '1',
                  unit: UNIT_FOR_BILLING[presetMission.billing] ?? 'unit',
                  price: centsToInput(presetMission.rateCents, locale),
                  discount: '',
                },
              ]
            : [{ key: nextLineKey++, description: '', quantity: '1', unit: 'day', price: '', discount: '' }],
          discount: '',
          note: props.defaultNote,
          depositIds: [],
          activityId: null,
          einvoice: props.facturxDefault && preset?.kind === 'company',
        },
  );
  const [id, setId] = useState(initial?.id ?? null);
  const [server, setServer] = useState<DocumentView | null>(initial);
  const [missing, setMissing] = useState(props.missing);
  const [einvoiceMissing, setEinvoiceMissing] = useState(props.einvoiceMissing ?? []);
  const einvoiceRules = facturxRules(usePack() ?? undefined);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [issueErrors, setIssueErrors] = useState<string[]>([]);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saving = useRef(false);
  const allowLeave = useUnsavedGuard(dirty, t('common.unsaved'));
  const { payload, lineErrors } = toPayload(draft);

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

  const save = useCallback(async (): Promise<string | null> => {
    if (!payload || saving.current) return id;
    saving.current = true;
    try {
      let current = id;
      if (current) await api(`/api/documents/${current}`, { method: 'PUT', body: payload });
      else {
        current = (await api<{ id: string }>('/api/documents', { method: 'POST', body: payload })).id;
        setId(current);
        window.history.replaceState(window.history.state, '', `/documents/${current}`);
      }
      const fresh = await api<{
        document: DocumentView;
        missing: string[];
        einvoice: { missing: string[] } | null;
      }>(`/api/documents/${current}?today=${today()}`);
      setServer(fresh.document);
      setMissing(fresh.missing);
      setEinvoiceMissing(fresh.einvoice?.missing ?? []);
      setDirty(false);
      setSavedAt(new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date()));
      setFailure(undefined);
      return current;
    } catch (error) {
      setFailure(describeError(error, t));
      return null;
    } finally {
      saving.current = false;
    }
  }, [payload, id, locale, t]);

  useEffect(() => {
    if (!dirty || !payload) return;
    const timer = setTimeout(() => void save(), 1500);
    return () => clearTimeout(timer);
  }, [dirty, payload, save]);

  /**
   * Issues the document after the confirmation dialog (S-171)
   *
   * @returns {Promise<void>} - resolves when done
   */
  async function issue(): Promise<void> {
    setConfirmIssue(false);
    const current = await save();
    if (!current) return;
    try {
      await api(`/api/documents/${current}/issue`, { method: 'POST' });
      allowLeave();
      onIssued();
    } catch (error) {
      if (error instanceof ApiError && error.body.error === 'missing_fields') {
        setIssueErrors(
          ((error.body as unknown as { missing: string[] }).missing ?? []).map((item) =>
            t(`documents.missing.${item}` as MessageKey),
          ),
        );
      } else if (error instanceof ApiError && error.body.error === 'date_before_last') {
        const lastDate = (error.body as unknown as { lastDate: string }).lastDate;
        setIssueErrors([t('documents.issue.dateBeforeLast', { date: formatDate(lastDate, locale) })]);
      } else if (error instanceof ApiError && error.body.error === 'credit_exceeds_invoice') {
        const available = (error.body as unknown as { availableCents: number }).availableCents;
        setIssueErrors([
          t('documents.issue.creditExceeds', { amount: formatMoney(available, draft.currency, locale) }),
        ]);
      } else setIssueErrors([describeError(error, t)]);
    }
  }

  /**
   * Deletes the draft after confirmation
   *
   * @returns {Promise<void>} - resolves when done
   */
  async function remove(): Promise<void> {
    setConfirmDelete(false);
    if (id) await api(`/api/documents/${id}`, { method: 'DELETE' }).catch(() => undefined);
    allowLeave();
    navigate(listPath(draft.type), { replace: true });
  }

  if (selectable.length === 0) {
    return (
      <>
        <PageHeader
          title={t(
            `documents.new.${type === 'deposit' ? 'invoice' : type === 'credit_note' ? 'invoice' : type}`,
          )}
        />
        <Notice tone="info">{t('missions.noClient')}</Notice>
      </>
    );
  }

  const client = selectable.find((candidate) => candidate.id === draft.clientId);
  const clientMissions = missions.filter((mission) => mission.clientId === draft.clientId);
  const clientDeposits = deposits.filter(
    (deposit) => deposit.clientId === draft.clientId && deposit.state === 'issued',
  );
  const validLines = payload?.lines ?? [];
  const depositsCents = clientDeposits
    .filter((deposit) => draft.depositIds.includes(deposit.id))
    .reduce((sum, deposit) => sum + deposit.totals.totalCents, 0);
  const preview = computeTotals(
    validLines,
    payload?.discountBp ?? 0,
    server?.totals.vatRateBp ?? 0,
    depositsCents,
  );
  const money = (cents: number) => formatMoney(cents, draft.currency, locale);
  const titleKey = `documents.title.draft.${draft.type}` as MessageKey;

  return (
    <>
      <PageHeader
        title={t(titleKey)}
        subtitle={
          <span aria-live="polite">
            {dirty
              ? t('documents.autosave.pending')
              : savedAt
                ? t('documents.autosave.saved', { time: savedAt })
                : t('documents.autosave.idle')}
          </span>
        }
      >
        {id && (
          <a href={`/api/documents/${id}/pdf`} target="_blank" rel="noreferrer" className={styles.link}>
            {t('documents.preview')}
          </a>
        )}
      </PageHeader>
      <div className={form.form}>
        {failure && (
          <Notice tone="error" live>
            {failure}
          </Notice>
        )}
        {issueErrors.length > 0 && (
          <Notice tone="error">
            <p className={form.summary}>{t('documents.issue.blocked')}</p>
            <ul>
              {issueErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </Notice>
        )}
        <fieldset className={form.section}>
          <legend>{t('documents.section.parties')}</legend>
          <div className={form.grid}>
            <SelectField
              label={t('missions.client')}
              value={draft.clientId}
              disabled={draft.type === 'credit_note'}
              onChange={(event) => {
                const next = selectable.find((candidate) => candidate.id === event.target.value);
                change({
                  clientId: event.target.value,
                  missionId: '',
                  depositIds: [],
                  language: next?.language ?? draft.language,
                  currency: next?.currency ?? draft.currency,
                });
              }}
            >
              {selectable.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={`${t('documents.mission')} ${t('common.optional')}`}
              value={draft.missionId}
              onChange={(event) => change({ missionId: event.target.value })}
            >
              <option value="">—</option>
              {clientMissions.map((mission) => (
                <option key={mission.id} value={mission.id}>
                  {mission.name}
                </option>
              ))}
            </SelectField>
            <ActivitySelect value={draft.activityId} onChange={(activityId) => change({ activityId })} />
          </div>
          {client && !client.address && <Notice tone="warn">{t('documents.clientNoAddress')}</Notice>}
          <div className={form.grid}>
            <TextField
              label={t('documents.issueDate')}
              type="date"
              value={draft.issueDate}
              onChange={(event) => change({ issueDate: event.target.value })}
              required
            />
            {draft.type === 'quote' && (
              <TextField
                label={t('documents.validUntil')}
                type="date"
                value={draft.validUntil}
                onChange={(event) => change({ validUntil: event.target.value })}
              />
            )}
            <SelectField
              label={t('clients.language')}
              value={draft.language}
              onChange={(event) => change({ language: event.target.value as Draft['language'] })}
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
              onChange={(event) => change({ currency: event.target.value })}
            >
              {CURRENCIES.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </SelectField>
          </div>
        </fieldset>

        <fieldset className={form.section}>
          <legend>{t('documents.section.lines')}</legend>
          {draft.lines.map((line, index) => {
            const set = (patch: Partial<EditorLine>) =>
              change({
                lines: draft.lines.map((item, position) =>
                  position === index ? { ...item, ...patch } : item,
                ),
              });
            const error = lineErrors[index];
            return (
              <fieldset key={line.key} className={styles.line}>
                <legend className={styles.legend}>{t('documents.line.label', { number: index + 1 })}</legend>
                <TextAreaField
                  label={t('documents.line.description')}
                  value={line.description}
                  rows={2}
                  maxLength={500}
                  onChange={(event) => set({ description: event.target.value })}
                />
                <div className={styles.numbers}>
                  <TextField
                    label={t('documents.line.quantity')}
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(event) => set({ quantity: event.target.value })}
                  />
                  <SelectField
                    label={t('documents.line.unit')}
                    value={line.unit}
                    onChange={(event) => set({ unit: event.target.value as Unit })}
                  >
                    {UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {t(`documents.unit.${unit}`)}
                      </option>
                    ))}
                  </SelectField>
                  <TextField
                    label={t('documents.line.price')}
                    inputMode="decimal"
                    value={line.price}
                    onChange={(event) => set({ price: event.target.value })}
                  />
                  <TextField
                    label={t('documents.line.discount')}
                    inputMode="decimal"
                    value={line.discount}
                    onChange={(event) => set({ discount: event.target.value })}
                  />
                </div>
                {error && (
                  <p className={styles.error} role="alert">
                    {t(error)}
                  </p>
                )}
                {draft.lines.length > 1 && (
                  <Button
                    variant="ghost"
                    onClick={() => change({ lines: draft.lines.filter((_, position) => position !== index) })}
                  >
                    {t('documents.line.remove')}
                  </Button>
                )}
              </fieldset>
            );
          })}
          {draft.lines.length < 200 && (
            <Button
              variant="ghost"
              onClick={() =>
                change({
                  lines: [
                    ...draft.lines,
                    {
                      key: nextLineKey++,
                      description: '',
                      quantity: '1',
                      unit: draft.lines.at(-1)?.unit ?? 'day',
                      price: '',
                      discount: '',
                    },
                  ],
                })
              }
            >
              {t('documents.line.add')}
            </Button>
          )}
          <TextField
            label={t('documents.globalDiscount')}
            inputMode="decimal"
            value={draft.discount}
            onChange={(event) => change({ discount: event.target.value })}
            error={parsePercent(draft.discount) === null ? t('documents.line.discount.invalid') : undefined}
          />
          {draft.type === 'invoice' && clientDeposits.length > 0 && (
            <fieldset className={form.section}>
              <legend>{t('documents.deposits')}</legend>
              {clientDeposits.map((deposit) => (
                <label key={deposit.id} className={form.check}>
                  <input
                    type="checkbox"
                    checked={draft.depositIds.includes(deposit.id)}
                    onChange={(event) =>
                      change({
                        depositIds: event.target.checked
                          ? [...draft.depositIds, deposit.id]
                          : draft.depositIds.filter((value) => value !== deposit.id),
                      })
                    }
                  />
                  {deposit.number} · {formatMoney(deposit.totals.totalCents, deposit.currency, locale)}
                </label>
              ))}
            </fieldset>
          )}
        </fieldset>

        <section className={form.section} aria-labelledby="totals-title">
          <h2 id="totals-title" className={styles.sectionTitle}>
            {t('documents.section.totals')}
          </h2>
          <dl className={styles.totals}>
            {preview.discountCents > 0 && (
              <>
                <div>
                  <dt>{t('documents.subtotal')}</dt>
                  <dd>{money(preview.linesCents)}</dd>
                </div>
                <div>
                  <dt>{t('documents.discount')}</dt>
                  <dd>− {money(preview.discountCents)}</dd>
                </div>
              </>
            )}
            <div>
              <dt>{t('documents.net')}</dt>
              <dd>{money(preview.netCents)}</dd>
            </div>
            {preview.vatRateBp > 0 && (
              <div>
                <dt>{t('documents.vat', { rate: preview.vatRateBp / 100 })}</dt>
                <dd>{money(preview.vatCents)}</dd>
              </div>
            )}
            {preview.depositsCents > 0 && (
              <div>
                <dt>{t('documents.depositsDeducted')}</dt>
                <dd>− {money(preview.depositsCents)}</dd>
              </div>
            )}
            <div className={styles.total}>
              <dt>{t('documents.total')}</dt>
              <dd>{money(preview.totalCents)}</dd>
            </div>
          </dl>
          {server && <p className={form.summary}>{t(`documents.vatMode.${server.vatMode}`)}</p>}
          {server?.mentions.map((mention) => (
            <p key={mention} className={styles.mention}>
              {mention}
            </p>
          ))}
        </section>

        <TextAreaField
          label={t('documents.note')}
          value={draft.note}
          maxLength={2000}
          onChange={(event) => change({ note: event.target.value })}
        />

        {einvoiceRules && draft.type !== 'quote' && (
          <Field label={t('documents.einvoice.label')} hint={t('documents.einvoice.hint')} checkbox>
            {(control) => (
              <input
                {...control}
                type="checkbox"
                checked={draft.einvoice}
                onChange={(event) => change({ einvoice: event.target.checked })}
              />
            )}
          </Field>
        )}
        {einvoiceRules && draft.type !== 'quote' && draft.einvoice && (
          <>
            {einvoiceMissing.length > 0 && (
              <Notice tone="warn">
                <p className={form.summary}>{t('documents.einvoice.title')}</p>
                <ul>
                  {einvoiceMissing.map((item) => (
                    <li key={item}>{t(`documents.missing.einvoice.${item}` as MessageKey)}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {einvoiceRules.note && <Notice tone="info">{einvoiceRules.note[locale]}</Notice>}
          </>
        )}

        {missing.length > 0 && (
          <Notice tone="warn">
            <p className={form.summary}>{t('documents.missing.title')}</p>
            <ul>
              {missing.map((item) => (
                <li key={item}>{t(`documents.missing.${item}` as MessageKey)}</li>
              ))}
            </ul>
          </Notice>
        )}

        <div className={form.actions}>
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            {t('documents.deleteDraft')}
          </Button>
          <Button variant="ghost" disabled={!payload} onClick={() => void save()}>
            {t('documents.saveDraft')}
          </Button>
          <Button disabled={!payload || validLines.length === 0} onClick={() => setConfirmIssue(true)}>
            {t(`documents.issue.${draft.type}` as MessageKey)}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmIssue}
        title={t(`documents.issue.${draft.type}` as MessageKey)}
        body={t(draft.type === 'quote' ? 'documents.issue.confirm.quote' : 'documents.issue.confirm')}
        confirmLabel={t(`documents.issue.${draft.type}` as MessageKey)}
        onConfirm={() => void issue()}
        onCancel={() => setConfirmIssue(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={t('documents.deleteDraft')}
        body={t('documents.deleteDraft.body')}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
