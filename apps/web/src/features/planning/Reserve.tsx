import { parseAmount, type ReserveView } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { Link } from 'react-router';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Field } from '../../components/Field/Field.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { centsToInput, formatDate, formatMoney } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { useAction } from '../settings/useAction.ts';
import styles from './Planning.module.css';
import { labelOf } from './types.ts';

/**
 * Loads the reserve of the active company; null when the country pack has none
 *
 * @returns {{ reserve: ReserveView | null | undefined; reload: () => void }} - undefined while loading
 */
function useReserve() {
  const { data, error, reload } = useResource<{ reserve: ReserveView }>('/api/reserve');
  return { reserve: error !== undefined ? null : data?.reserve, reload };
}

/**
 * Amount to keep aside, its parts and its warning
 *
 * @param props {{ reserve: ReserveView; adjust?: boolean }} - the reserve; adjust links to the settings
 * @returns {JSX.Element} - the block
 */
function ReserveFigures({ reserve, adjust }: { reserve: ReserveView; adjust?: boolean }) {
  const { t, locale } = useI18n();
  const money = (cents: number) => formatMoney(cents, reserve.currency, locale);
  const percent = (bp: number) => `${(bp / 100).toLocaleString(locale)} %`;
  return (
    <>
      <p className={styles.figure}>{money(reserve.reserveCents)}</p>
      <p className={styles.caption}>
        {t('reserve.asOf', { date: formatDate(reserve.asOf, locale) })}{' '}
        {reserve.maturity !== 'verified' && <Badge tone="warn">{t('pack.maturity.experimental')}</Badge>}
      </p>
      <details>
        <summary>{t('reserve.details')}</summary>
        <ul className={styles.plain}>
          {reserve.components.map((item) => (
            <li key={item.id}>
              {labelOf(item.label, locale)} : <strong>{money(item.estimatedCents)}</strong>
              {item.paidCents > 0 && ` − ${t('reserve.paid', { amount: money(item.paidCents) })}`}
              <span className={styles.caption}>
                {' '}
                {item.steps
                  .map((step) =>
                    step.adjustment
                      ? `${t(`reserve.step.${step.adjustment}`)} ${step.cents < 0 ? '−' : '+'}${money(Math.abs(step.cents))}`
                      : `${money(step.baseCents)} × ${percent(step.rateBp)}`,
                  )
                  .join(' + ')}{' '}
                ·{' '}
                <a href={item.source}>{t('reserve.source', { date: formatDate(item.verifiedOn, locale) })}</a>
              </span>
            </li>
          ))}
          <li>
            {t('reserve.margin', { rate: percent(reserve.marginBp) })} :{' '}
            <strong>{money(reserve.marginCents)}</strong>
          </li>
          {reserve.extra.cents > 0 && (
            <li>
              {t('reserve.extra')} : <strong>{money(reserve.extra.cents)}</strong>
              {reserve.extra.note && <span className={styles.caption}> {reserve.extra.note}</span>}
            </li>
          )}
          {reserve.paidCents > 0 && (
            <li>
              {t('reserve.paidTotal')} : <strong>− {money(reserve.paidCents)}</strong>
            </li>
          )}
        </ul>
      </details>
      {reserve.unconverted > 0 && (
        <Notice tone="info">{t('outlook.unconverted', { count: reserve.unconverted })}</Notice>
      )}
      <p className={styles.caption}>{labelOf(reserve.warning, locale)}</p>
      {adjust && <Link to="/thresholds#reserve">{t('reserve.adjust')}</Link>}
    </>
  );
}

/**
 * Dashboard card: what to keep aside now, null when the country pack has no reserve
 *
 * @returns {JSX.Element | null} - the card
 */
export function ReserveCard() {
  const { t } = useI18n();
  const { reserve } = useReserve();
  if (!reserve) return null;
  return (
    <section className={form.section} aria-labelledby="reserve-card-title">
      <h2 id="reserve-card-title" className={styles.sectionTitle}>
        {t('reserve.title')}
      </h2>
      <ReserveFigures reserve={reserve} adjust />
    </section>
  );
}

/**
 * Thresholds page block: the reserve and its settings (margin, personal extra, tax household)
 *
 * @returns {JSX.Element | null} - the section
 */
export function ReserveSection() {
  const { t } = useI18n();
  const { reserve, reload } = useReserve();
  if (!reserve) return null;
  return (
    <div id="reserve" className={form.form}>
      <section className={form.section} aria-labelledby="reserve-title">
        <h2 id="reserve-title" className={styles.sectionTitle}>
          {t('reserve.title')}
        </h2>
        <ReserveFigures reserve={reserve} />
      </section>
      <ReserveSettingsForm reserve={reserve} onSaved={reload} />
    </div>
  );
}

/**
 * Settings of the reserve
 *
 * @param props {{ reserve: ReserveView; onSaved: () => void }} - current values and refresh callback
 * @returns {JSX.Element} - the form
 */
function ReserveSettingsForm({ reserve, onSaved }: { reserve: ReserveView; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const initial = {
    margin: String(reserve.marginBp / 100),
    extraRate: String(reserve.extra.rateBp / 100),
    extraMonthly: centsToInput(reserve.extra.monthlyCents, locale),
    note: reserve.extra.note ?? '',
    parts: String(reserve.household.partsQuarters / 4),
    joint: reserve.household.joint,
  };
  const [values, setValues] = useState(initial);
  const [invalid, setInvalid] = useState<string>();
  const action = useAction();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const percentBp = (value: string) => {
    const number = Number(value.replace(',', '.'));
    return Number.isFinite(number) && number >= 0 && number <= 50 ? Math.round(number * 100) : null;
  };

  /**
   * Validates and saves the settings
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const marginBp = percentBp(values.margin);
    const extraRateBp = percentBp(values.extraRate);
    const extraMonthlyCents = values.extraMonthly.trim() ? parseAmount(values.extraMonthly) : 0;
    const parts = Number(values.parts.replace(',', '.'));
    const taxPartsQuarters = Math.round(parts * 4);
    if (marginBp === null || extraRateBp === null) return setInvalid('rate');
    if (extraMonthlyCents === null || extraMonthlyCents < 0) return setInvalid('monthly');
    if (!Number.isFinite(parts) || taxPartsQuarters < (values.joint ? 8 : 4) || taxPartsQuarters > 40)
      return setInvalid('parts');
    setInvalid(undefined);
    await action.run(async () => {
      await api('/api/reserve/settings', {
        method: 'PUT',
        body: {
          marginBp: marginBp === reserve.packMarginBp ? null : marginBp,
          extraRateBp,
          extraMonthlyCents,
          extraNote: values.note.trim() || null,
          taxPartsQuarters,
          jointTaxation: values.joint,
        },
      });
      onSaved();
    });
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <SettingsSection
        title={t('reserve.settings')}
        description={t('reserve.settings.hint', { rate: `${reserve.packMarginBp / 100} %` })}
        footer={
          <ActionBar
            primaryLabel={t('common.save')}
            busy={action.busy}
            dirty={dirty}
            feedback={action.feedback}
          />
        }
      >
        <div className={form.grid}>
          <TextField
            label={t('reserve.margin.label')}
            inputMode="decimal"
            value={values.margin}
            error={invalid === 'rate' ? t('reserve.invalid.rate') : undefined}
            onChange={(event) => setValues({ ...values, margin: event.target.value })}
          />
          <TextField
            label={t('reserve.extraRate.label')}
            hint={t('reserve.extraRate.hint')}
            inputMode="decimal"
            value={values.extraRate}
            onChange={(event) => setValues({ ...values, extraRate: event.target.value })}
          />
          <TextField
            label={t('reserve.extraMonthly.label', { currency: reserve.currency })}
            inputMode="decimal"
            value={values.extraMonthly}
            error={invalid === 'monthly' ? t('errors.amount') : undefined}
            onChange={(event) => setValues({ ...values, extraMonthly: event.target.value })}
          />
          <TextField
            label={`${t('reserve.note.label')} ${t('common.optional')}`}
            maxLength={200}
            value={values.note}
            onChange={(event) => setValues({ ...values, note: event.target.value })}
          />
          {reserve.household.applies && (
            <>
              <TextField
                label={t('reserve.parts.label')}
                hint={t('reserve.parts.hint')}
                inputMode="decimal"
                value={values.parts}
                error={invalid === 'parts' ? t('reserve.invalid.parts') : undefined}
                onChange={(event) => setValues({ ...values, parts: event.target.value })}
              />
              <Field label={t('reserve.joint.label')} checkbox>
                {(control) => (
                  <input
                    {...control}
                    type="checkbox"
                    checked={values.joint}
                    onChange={(event) => setValues({ ...values, joint: event.target.checked })}
                  />
                )}
              </Field>
            </>
          )}
        </div>
      </SettingsSection>
    </form>
  );
}
