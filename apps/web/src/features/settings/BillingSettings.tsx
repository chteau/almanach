import {
  type BillingSettingsInput,
  facturxRules,
  formatNumber,
  LOGO_MAX_BYTES,
  type NumberFormat,
  type NumberFormatPeriod,
  PDF_FONTS,
  PDF_LAYOUTS,
} from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Button, buttonClassName } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import { Field } from '../../components/Field/Field.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextAreaField } from '../../components/TextAreaField/TextAreaField.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { useResource } from '../../lib/useResource.ts';
import text from '../../styles/text.module.css';
import { describeError } from '../install/errors.ts';
import { usePack } from '../profile/useProfile.ts';
import styles from './BillingSettings.module.css';
import { useAction } from './useAction.ts';

interface BillingResponse {
  settings: {
    numbering: NumberFormatPeriod[];
    pdf: BillingSettingsInput['pdf'];
    defaultTermsDays: number;
    defaultNote: string | null;
    facturxDefault: boolean;
    hasLogo: boolean;
  };
  year: number;
  locked: boolean;
  current: NumberFormat;
  next: NumberFormat;
}

export type BillingPart = 'numbering' | 'pdf' | 'defaults';

interface Values {
  numbering: NumberFormat;
  pdf: BillingSettingsInput['pdf'];
  terms: string;
  note: string;
  facturx: boolean;
}

/**
 * One of the invoicing panels: numbering, PDF look, or defaults for new documents (P20, S-234 to S-236)
 *
 * @param props {{ part: BillingPart }} - which part to edit
 * @returns {JSX.Element} - the settings section
 */
export function BillingSettings({ part }: { part: BillingPart }) {
  const { data, error, reload } = useResource<BillingResponse>('/api/billing');
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  return <BillingForm key={part} part={part} data={data} onSaved={reload} />;
}

/**
 * Billing settings form for one part; the other parts are sent back unchanged
 *
 * @param props {{ part: BillingPart; data: BillingResponse; onSaved: () => void }} - part, stored settings, refresh
 * @returns {JSX.Element} - the form
 */
function BillingForm({
  part,
  data,
  onSaved,
}: {
  part: BillingPart;
  data: BillingResponse;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [saved, setSaved] = useState<Values>(() => ({
    numbering: data.next,
    pdf: data.settings.pdf,
    terms: String(data.settings.defaultTermsDays),
    note: data.settings.defaultNote ?? '',
    facturx: data.settings.facturxDefault,
  }));
  const offersFacturx = facturxRules(usePack() ?? undefined) !== null;
  const [values, setValues] = useState(saved);
  const action = useAction();
  const { numbering, pdf } = values;
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const pending = JSON.stringify(data.current) !== JSON.stringify(data.next);

  /**
   * Problem with one prefix: wrong characters, or the same as another family's
   *
   * @param family {keyof NumberFormat['prefixes']} - document family
   * @returns {string | undefined} - error text, if any
   */
  const prefixError = (family: keyof NumberFormat['prefixes']): string | undefined => {
    const value = numbering.prefixes[family];
    if (!/^[A-Za-z0-9]{1,10}$/.test(value)) return t('billing.prefix.invalid');
    const shared = Object.entries(numbering.prefixes).some(
      ([other, prefix]) => other !== family && prefix.toUpperCase() === value.toUpperCase(),
    );
    return shared ? t('billing.prefix.duplicate') : undefined;
  };
  const days = Number(values.terms);
  const termsError =
    !Number.isInteger(days) || days < 0 || days > 120 || values.terms.trim() === ''
      ? t('billing.terms.invalid')
      : undefined;

  /**
   * Saves the settings; a numbering change after the first invoice applies next year
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when saved
   */
  async function save(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const problem = termsError ?? (['invoice', 'credit', 'quote'] as const).map(prefixError).find(Boolean);
    if (problem) {
      action.setFeedback({ tone: 'error', text: problem });
      return;
    }
    await action.run(async () => {
      const result = await api<{ appliesFrom: number | null }>('/api/billing', {
        method: 'PUT',
        body: {
          numbering,
          pdf,
          defaultTermsDays: days,
          defaultNote: values.note,
          facturxDefault: values.facturx,
        },
      });
      setSaved(values);
      onSaved();
      return result.appliesFrom
        ? t('billing.saved.nextYear', { year: result.appliesFrom })
        : t('billing.saved');
    });
  }

  /**
   * Field props for one numbering prefix
   *
   * @param family {keyof NumberFormat['prefixes']} - document family
   * @param label {string} - field label
   * @returns {JSX.Element} - the field
   */
  const prefix = (family: keyof NumberFormat['prefixes'], label: string) => (
    <TextField
      label={label}
      value={numbering.prefixes[family]}
      maxLength={10}
      onChange={(event) =>
        setValues({
          ...values,
          numbering: { ...numbering, prefixes: { ...numbering.prefixes, [family]: event.target.value } },
        })
      }
      error={prefixError(family)}
    />
  );
  const previewYear = data.locked ? data.year + 1 : data.year;

  const titles: Record<BillingPart, string> = {
    numbering: t('billing.numbering'),
    pdf: t('billing.pdf'),
    defaults: t('billing.defaults'),
  };
  const descriptions: Record<BillingPart, string> = {
    numbering: t('settings.billing.numbering.body'),
    pdf: t('settings.billing.pdf.body'),
    defaults: t('billing.note.hint'),
  };

  return (
    <>
      <form onSubmit={(event) => void save(event)} noValidate>
        <SettingsSection
          title={titles[part]}
          description={descriptions[part]}
          footer={
            <ActionBar
              primaryLabel={t('common.save')}
              busy={action.busy}
              dirty={dirty}
              feedback={action.feedback}
            >
              {part === 'pdf' && (
                <a
                  href="/api/billing/preview.pdf"
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClassName('ghost')}
                >
                  {t('billing.previewPdf')}
                </a>
              )}
            </ActionBar>
          }
        >
          {part === 'numbering' && (
            <>
              {data.locked && (
                <Notice tone="info">
                  {pending
                    ? t('billing.numbering.pending', {
                        year: data.year + 1,
                        current: formatNumber(data.current, 'invoice', data.year, 1),
                      })
                    : t('billing.numbering.locked', { year: data.year + 1 })}
                </Notice>
              )}
              <div className={form.grid}>
                {prefix('invoice', t('billing.prefix.invoice'))}
                {prefix('credit', t('billing.prefix.credit'))}
                {prefix('quote', t('billing.prefix.quote'))}
                <SelectField
                  label={t('billing.separator')}
                  value={numbering.separator}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      numbering: { ...numbering, separator: event.target.value as NumberFormat['separator'] },
                    })
                  }
                >
                  {(['-', '/', '_', ''] as const).map((value) => (
                    <option key={value} value={value}>
                      {value === '' ? t('billing.separator.none') : value}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label={t('billing.year')}
                  value={numbering.year}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      numbering: { ...numbering, year: event.target.value as NumberFormat['year'] },
                    })
                  }
                >
                  {(['yyyy', 'yy', 'none'] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`billing.year.${value}`)}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label={t('billing.digits')}
                  value={String(numbering.digits)}
                  onChange={(event) =>
                    setValues({ ...values, numbering: { ...numbering, digits: Number(event.target.value) } })
                  }
                >
                  {[3, 4, 5, 6].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </SelectField>
              </div>
              <p className={text.caption} aria-live="polite">
                {t('billing.preview', {
                  invoice: formatNumber(numbering, 'invoice', previewYear, 1),
                  credit: formatNumber(numbering, 'credit', previewYear, 1),
                  quote: formatNumber(numbering, 'quote', previewYear, 1),
                })}
              </p>
            </>
          )}
          {part === 'pdf' && (
            <div className={form.grid}>
              <Field label={t('billing.accent')} width="auto">
                {(control) => (
                  <input
                    {...control}
                    type="color"
                    className={styles.color}
                    value={pdf.accent}
                    onChange={(event) =>
                      setValues({ ...values, pdf: { ...pdf, accent: event.target.value } })
                    }
                  />
                )}
              </Field>
              <SelectField
                label={t('billing.layout')}
                value={pdf.layout}
                onChange={(event) =>
                  setValues({
                    ...values,
                    pdf: { ...pdf, layout: event.target.value as (typeof PDF_LAYOUTS)[number] },
                  })
                }
              >
                {PDF_LAYOUTS.map((value) => (
                  <option key={value} value={value}>
                    {t(`billing.layout.${value}`)}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={t('billing.font')}
                value={pdf.font}
                onChange={(event) =>
                  setValues({
                    ...values,
                    pdf: { ...pdf, font: event.target.value as (typeof PDF_FONTS)[number] },
                  })
                }
              >
                {PDF_FONTS.map((value) => (
                  <option key={value} value={value}>
                    {t(`billing.font.${value}`)}
                  </option>
                ))}
              </SelectField>
            </div>
          )}
          {part === 'defaults' && (
            <>
              <TextField
                label={t('billing.terms')}
                hint={t('billing.terms.hint')}
                inputMode="numeric"
                value={values.terms}
                onChange={(event) => setValues({ ...values, terms: event.target.value })}
                error={values.terms !== saved.terms ? termsError : undefined}
              />
              <TextAreaField
                label={`${t('billing.note')} ${t('common.optional')}`}
                value={values.note}
                maxLength={1000}
                onChange={(event) => setValues({ ...values, note: event.target.value })}
              />
              {offersFacturx && (
                <Field label={t('billing.facturx')} hint={t('billing.facturx.hint')} checkbox>
                  {(control) => (
                    <input
                      {...control}
                      type="checkbox"
                      checked={values.facturx}
                      onChange={(event) => setValues({ ...values, facturx: event.target.checked })}
                    />
                  )}
                </Field>
              )}
            </>
          )}
        </SettingsSection>
      </form>
      {part === 'pdf' && <LogoSection hasLogo={data.settings.hasLogo} onChange={onSaved} />}
    </>
  );
}

/**
 * Logo printed on documents: upload, replace, or remove after confirmation
 *
 * @param props {{ hasLogo: boolean; onChange: () => void }} - whether a logo is stored, refresh callback
 * @returns {JSX.Element} - the section
 */
function LogoSection({ hasLogo, onChange }: { hasLogo: boolean; onChange: () => void }) {
  const { t } = useI18n();
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string }>();

  /**
   * Runs a logo call and shows its outcome
   *
   * @param call {() => Promise<unknown>} - upload or removal
   * @param success {string} - text when it worked
   * @returns {Promise<void>} - resolves when done
   */
  async function run(call: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true);
    setResult(undefined);
    try {
      await call();
      setVersion((value) => value + 1);
      setResult({ tone: 'success', text: success });
      onChange();
    } catch (problem) {
      setResult({ tone: 'error', text: describeError(problem, t) });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Uploads a PNG or JPEG logo
   *
   * @param file {File} - chosen file
   * @returns {Promise<void>} - resolves when stored
   */
  async function upload(file: File): Promise<void> {
    const mime = file.type;
    if ((mime !== 'image/png' && mime !== 'image/jpeg') || file.size > LOGO_MAX_BYTES) {
      setResult({ tone: 'error', text: t('billing.logo.invalid') });
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    await run(
      () => api('/api/billing/logo', { method: 'PUT', body: { mime, data: btoa(binary) } }),
      t('billing.logo.saved'),
    );
  }

  return (
    <SettingsSection title={t('settings.billing.logo')} description={t('billing.logo.hint')}>
      {result && (
        <Notice tone={result.tone} live>
          {result.text}
        </Notice>
      )}
      <div className={styles.logoRow}>
        {hasLogo ? (
          <img
            src={`/api/billing/logo?v=${version}`}
            alt={t('billing.logo.current')}
            className={styles.logo}
          />
        ) : (
          <p className={text.caption}>{t('billing.logo.none')}</p>
        )}
        <label className={`${buttonClassName('ghost')} ${text.fileButton}`} aria-disabled={busy || undefined}>
          {hasLogo ? t('billing.logo.replace') : t('billing.logo.add')}
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="visually-hidden"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
        </label>
        {hasLogo && (
          <Button variant="danger" busy={busy} aria-haspopup="dialog" onClick={() => setConfirming(true)}>
            {t('billing.logo.remove')}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        danger
        title={t('billing.logo.remove')}
        body={t('settings.billing.logo.removeBody')}
        confirmLabel={t('billing.logo.remove')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void run(() => api('/api/billing/logo', { method: 'DELETE' }), t('settings.billing.logo.removed'));
        }}
      />
    </SettingsSection>
  );
}
