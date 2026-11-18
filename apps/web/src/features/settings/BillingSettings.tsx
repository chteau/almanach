import {
  type BillingSettingsInput,
  formatNumber,
  LOGO_MAX_BYTES,
  type NumberFormat,
  type NumberFormatPeriod,
  PDF_FONTS,
  PDF_LAYOUTS,
} from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import buttonStyles from '../../components/Button/Button.module.css';
import { Button } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextAreaField } from '../../components/TextAreaField/TextAreaField.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';
import styles from '../planning/Planning.module.css';

interface BillingResponse {
  settings: {
    numbering: NumberFormatPeriod[];
    pdf: BillingSettingsInput['pdf'];
    defaultTermsDays: number;
    defaultNote: string | null;
    hasLogo: boolean;
  };
  year: number;
  locked: boolean;
  current: NumberFormat;
  next: NumberFormat;
}

type Message = { tone: 'info' | 'warn' | 'error'; text: string } | undefined;

interface FormProps {
  data: BillingResponse;
  onSaved: () => void;
  message: Message;
  setMessage: (message: Message) => void;
}

/**
 * Numbering, PDF look and defaults for new clients and documents (P20, S-234 to S-236)
 *
 * @returns {JSX.Element} - the settings section
 */
export function BillingSettings() {
  const { data, error, reload } = useResource<BillingResponse>('/api/billing');
  // Kept here so the message survives the form being rebuilt with fresh data after a save.
  const [message, setMessage] = useState<Message>();
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  return (
    <BillingForm
      key={JSON.stringify(data)}
      data={data}
      onSaved={reload}
      message={message}
      setMessage={setMessage}
    />
  );
}

/**
 * Billing settings form
 *
 * @param props {FormProps} - stored settings, refresh callback and the message to show
 * @returns {JSX.Element} - the form
 */
function BillingForm({ data, onSaved, message, setMessage }: FormProps) {
  const { t } = useI18n();
  const [numbering, setNumbering] = useState<NumberFormat>(data.next);
  const [pdf, setPdf] = useState(data.settings.pdf);
  const [terms, setTerms] = useState(String(data.settings.defaultTermsDays));
  const [note, setNote] = useState(data.settings.defaultNote ?? '');
  const [logoVersion, setLogoVersion] = useState(0);
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

  /**
   * Saves the settings; a numbering change after the first invoice applies next year
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when saved
   */
  async function save(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const days = Number(terms);
    if (!Number.isInteger(days) || days < 0 || days > 120) {
      setMessage({ tone: 'error', text: t('billing.terms.invalid') });
      return;
    }
    const problem = (['invoice', 'credit', 'quote'] as const).map(prefixError).find(Boolean);
    if (problem) {
      setMessage({ tone: 'error', text: problem });
      return;
    }
    try {
      const result = await api<{ appliesFrom: number | null }>('/api/billing', {
        method: 'PUT',
        body: { numbering, pdf, defaultTermsDays: days, defaultNote: note },
      });
      setMessage({
        tone: 'info',
        text: result.appliesFrom
          ? t('billing.saved.nextYear', { year: result.appliesFrom })
          : t('billing.saved'),
      });
      onSaved();
    } catch (problem) {
      setMessage({ tone: 'error', text: describeError(problem, t) });
    }
  }

  /**
   * Uploads a PNG or JPEG logo
   *
   * @param file {File} - chosen file
   * @returns {Promise<void>} - resolves when stored
   */
  async function uploadLogo(file: File): Promise<void> {
    const mime = file.type;
    if ((mime !== 'image/png' && mime !== 'image/jpeg') || file.size > LOGO_MAX_BYTES) {
      setMessage({ tone: 'error', text: t('billing.logo.invalid') });
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    try {
      await api('/api/billing/logo', { method: 'PUT', body: { mime, data: btoa(binary) } });
      setLogoVersion((value) => value + 1);
      setMessage({ tone: 'info', text: t('billing.logo.saved') });
      onSaved();
    } catch (problem) {
      setMessage({ tone: 'error', text: describeError(problem, t) });
    }
  }

  /**
   * Removes the logo
   *
   * @returns {Promise<void>} - resolves when removed
   */
  async function removeLogo(): Promise<void> {
    await api('/api/billing/logo', { method: 'DELETE' }).catch(() => undefined);
    onSaved();
  }

  const prefix = (family: keyof NumberFormat['prefixes'], label: string) => (
    <TextField
      label={label}
      value={numbering.prefixes[family]}
      maxLength={10}
      onChange={(event) =>
        setNumbering({ ...numbering, prefixes: { ...numbering.prefixes, [family]: event.target.value } })
      }
      error={prefixError(family)}
    />
  );

  return (
    <form
      id="billing"
      className={form.section}
      onSubmit={(event) => void save(event)}
      noValidate
      aria-labelledby="billing-title"
    >
      <h2 id="billing-title" className={styles.sectionTitle}>
        {t('billing.title')}
      </h2>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <h3 className={styles.subTitle}>{t('billing.numbering')}</h3>
      {data.locked && (
        <p className={styles.caption}>
          {pending
            ? t('billing.numbering.pending', {
                year: data.year + 1,
                current: formatNumber(data.current, 'invoice', data.year, 1),
              })
            : t('billing.numbering.locked', { year: data.year + 1 })}
        </p>
      )}
      <div className={form.grid}>
        {prefix('invoice', t('billing.prefix.invoice'))}
        {prefix('credit', t('billing.prefix.credit'))}
        {prefix('quote', t('billing.prefix.quote'))}
        <SelectField
          label={t('billing.separator')}
          value={numbering.separator}
          onChange={(event) =>
            setNumbering({ ...numbering, separator: event.target.value as NumberFormat['separator'] })
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
            setNumbering({ ...numbering, year: event.target.value as NumberFormat['year'] })
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
          onChange={(event) => setNumbering({ ...numbering, digits: Number(event.target.value) })}
        >
          {[3, 4, 5, 6].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </SelectField>
      </div>
      <p className={styles.caption} aria-live="polite">
        {t('billing.preview', {
          invoice: formatNumber(numbering, 'invoice', data.locked ? data.year + 1 : data.year, 1),
          credit: formatNumber(numbering, 'credit', data.locked ? data.year + 1 : data.year, 1),
          quote: formatNumber(numbering, 'quote', data.locked ? data.year + 1 : data.year, 1),
        })}
      </p>

      <h3 className={styles.subTitle}>{t('billing.pdf')}</h3>
      <div className={form.grid}>
        <label className={styles.colorField}>
          <span>{t('billing.accent')}</span>
          <input
            type="color"
            value={pdf.accent}
            onChange={(event) => setPdf({ ...pdf, accent: event.target.value })}
          />
        </label>
        <SelectField
          label={t('billing.layout')}
          value={pdf.layout}
          onChange={(event) => setPdf({ ...pdf, layout: event.target.value as (typeof PDF_LAYOUTS)[number] })}
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
          onChange={(event) => setPdf({ ...pdf, font: event.target.value as (typeof PDF_FONTS)[number] })}
        >
          {PDF_FONTS.map((value) => (
            <option key={value} value={value}>
              {t(`billing.font.${value}`)}
            </option>
          ))}
        </SelectField>
      </div>
      <div className={styles.logoRow}>
        {data.settings.hasLogo ? (
          <img
            src={`/api/billing/logo?v=${logoVersion}`}
            alt={t('billing.logo.current')}
            className={styles.logo}
          />
        ) : (
          <p className={styles.caption}>{t('billing.logo.none')}</p>
        )}
        <label className={`${buttonStyles.button} ${buttonStyles.ghost} ${styles.fileButton}`}>
          {data.settings.hasLogo ? t('billing.logo.replace') : t('billing.logo.add')}
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void uploadLogo(file);
            }}
          />
        </label>
        {data.settings.hasLogo && (
          <Button variant="ghost" onClick={() => void removeLogo()}>
            {t('billing.logo.remove')}
          </Button>
        )}
      </div>
      <p className={styles.caption}>{t('billing.logo.hint')}</p>

      <h3 className={styles.subTitle}>{t('billing.defaults')}</h3>
      <TextField
        label={t('billing.terms')}
        hint={t('billing.terms.hint')}
        inputMode="numeric"
        value={terms}
        onChange={(event) => setTerms(event.target.value)}
      />
      <TextAreaField
        label={`${t('billing.note')} ${t('common.optional')}`}
        value={note}
        maxLength={1000}
        onChange={(event) => setNote(event.target.value)}
      />
      <p className={styles.caption}>{t('billing.note.hint')}</p>
      <div className={form.actions}>
        <a
          href="/api/billing/preview.pdf"
          target="_blank"
          rel="noreferrer"
          className={`${buttonStyles.button} ${buttonStyles.ghost}`}
        >
          {t('billing.previewPdf')}
        </a>
        <Button type="submit">{t('common.save')}</Button>
      </div>
    </form>
  );
}
