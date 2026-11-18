import type { PackMeta, Situation } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';
import styles from '../planning/Planning.module.css';

interface SituationData {
  today: string;
  activityStart: string;
  ceasedOn: string | null;
  current: Situation;
  changes: { id: string; effectiveOn: string; before: Situation; after: Situation }[];
}

interface SectionProps {
  data: SituationData;
  packs: PackMeta[];
  onChange: () => void;
  message: { tone: 'info' | 'error'; text: string } | undefined;
  setMessage: (message: { tone: 'info' | 'error'; text: string } | undefined) => void;
}

/**
 * Change of status or country with an effective date, and cessation of activity (P20, S-231 to S-233)
 *
 * @returns {JSX.Element} - the section
 */
export function SituationSettings() {
  const situation = useResource<SituationData>('/api/situation');
  const packs = useResource<{ packs: PackMeta[] }>('/api/packs');
  // Kept here so the message survives the section being rebuilt with fresh data.
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string }>();
  const failed = situation.error ?? packs.error;
  if (failed !== undefined) return <LoadError error={failed} onRetry={situation.reload} />;
  if (!situation.data || !packs.data) return <Skeleton rows={3} />;
  return (
    <SituationSection
      key={JSON.stringify(situation.data)}
      data={situation.data}
      packs={packs.data.packs}
      onChange={situation.reload}
      message={message}
      setMessage={setMessage}
    />
  );
}

/**
 * Section body once the data is loaded
 *
 * @param props {SectionProps} - situation, packs, refresh callback and the message to show
 * @returns {JSX.Element} - the section
 */
function SituationSection({ data, packs, onChange, message, setMessage }: SectionProps) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<'none' | 'change' | 'cessation'>('none');
  const [effectiveOn, setEffectiveOn] = useState(data.today);
  const [country, setCountry] = useState(data.current.country);
  const [status, setStatus] = useState(data.current.status ?? '');
  const [period, setPeriod] = useState(data.current.declarationPeriod ?? '');
  const [options, setOptions] = useState<string[]>(data.current.options);
  const [identifiers, setIdentifiers] = useState<Record<string, string>>(data.current.identifiers);
  const [confirm, setConfirm] = useState<'undo' | 'resume' | null>(null);
  const pack = packs.find((candidate) => candidate.country === country);

  /**
   * Describes a situation in a few words
   *
   * @param value {Situation} - situation
   * @returns {string} - e.g. "France · Micro-entreprise (BNC) · monthly"
   */
  const describe = (value: Situation): string => {
    const known = packs.find((candidate) => candidate.country === value.country);
    const statusLabel = known?.statuses.find((item) => item.id === value.status)?.label[locale];
    return [
      known?.name[locale] ?? value.country,
      statusLabel,
      value.declarationPeriod && t(`period.${value.declarationPeriod}`),
    ]
      .filter(Boolean)
      .join(' · ');
  };

  /**
   * Runs a call and reports its result
   *
   * @param action {() => Promise<unknown>} - call
   * @param success {string} - message when it worked
   * @returns {Promise<void>} - resolves when done
   */
  const run = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    try {
      await action();
      setMessage({ tone: 'info', text: success });
      setMode('none');
      onChange();
    } catch (problem) {
      setMessage({ tone: 'error', text: describeError(problem, t) });
    }
  };

  /**
   * Saves the new situation or the cessation
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when saved
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    if (mode === 'cessation') {
      await run(
        () => api('/api/situation/cessation', { method: 'PUT', body: { effectiveOn } }),
        t('situation.ceased.saved', { date: formatDate(effectiveOn, locale) }),
      );
      return;
    }
    await run(
      () =>
        api('/api/situation/changes', {
          method: 'POST',
          body: {
            effectiveOn,
            country,
            status: status || null,
            declarationPeriod: period || null,
            options,
            identifiers: Object.fromEntries(
              Object.entries(identifiers).filter(([key]) =>
                pack?.identifiers.some((item) => item.id === key),
              ),
            ),
            currency: pack?.currency ?? data.current.currency,
          },
        }),
      t('situation.saved', { date: formatDate(effectiveOn, locale) }),
    );
  }

  return (
    <section className={form.section} aria-labelledby="situation-title" id="situation">
      <h2 id="situation-title" className={styles.sectionTitle}>
        {t('situation.title')}
      </h2>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {data.ceasedOn && (
        <Notice tone="warn">
          {data.ceasedOn < data.today
            ? t('situation.ceased', { date: formatDate(data.ceasedOn, locale) })
            : t('situation.ceasing', { date: formatDate(data.ceasedOn, locale) })}
        </Notice>
      )}
      <p className={styles.text}>
        {t('situation.current')} <strong>{describe(data.current)}</strong>
      </p>
      {data.changes.length > 0 && (
        <ul className={styles.plain}>
          {data.changes.map((change, index) => (
            <li key={change.id}>
              {t('situation.history', {
                date: formatDate(change.effectiveOn, locale),
                before: describe(change.before),
                after: describe(change.after),
              })}{' '}
              {index === 0 && !data.ceasedOn && <Badge>{t('situation.latest')}</Badge>}
            </li>
          ))}
        </ul>
      )}
      {mode === 'none' && (
        <div className={form.actions}>
          {data.changes.length > 0 && !data.ceasedOn && (
            <Button variant="ghost" onClick={() => setConfirm('undo')}>
              {t('situation.undo')}
            </Button>
          )}
          {data.ceasedOn ? (
            <Button variant="ghost" onClick={() => setConfirm('resume')}>
              {t('situation.resume')}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setMode('cessation')}>
                {t('situation.cease')}
              </Button>
              <Button onClick={() => setMode('change')}>{t('situation.change')}</Button>
            </>
          )}
        </div>
      )}
      {mode !== 'none' && (
        <form className={form.form} onSubmit={(event) => void submit(event)} noValidate>
          <p className={styles.caption}>
            {mode === 'change' ? t('situation.change.hint') : t('situation.cease.hint')}
          </p>
          <TextField
            label={mode === 'change' ? t('situation.effectiveOn') : t('situation.lastDay')}
            type="date"
            value={effectiveOn}
            min={data.activityStart}
            max={mode === 'change' ? data.today : undefined}
            onChange={(event) => setEffectiveOn(event.target.value)}
          />
          {mode === 'change' && (
            <div className={form.grid}>
              <SelectField
                label={t('situation.country')}
                value={country}
                onChange={(event) => {
                  setCountry(event.target.value);
                  setStatus('');
                  setPeriod('');
                  setOptions([]);
                }}
              >
                {packs.map((candidate) => (
                  <option key={candidate.country} value={candidate.country}>
                    {candidate.name[locale]}
                  </option>
                ))}
              </SelectField>
              {pack && (
                <>
                  <SelectField
                    label={t('situation.status')}
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <option value="">{t('situation.choose')}</option>
                    {pack.statuses.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label[locale]}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    label={t('situation.period')}
                    value={period}
                    onChange={(event) => setPeriod(event.target.value)}
                  >
                    <option value="">{t('situation.choose')}</option>
                    {pack.declarationPeriods.map((item) => (
                      <option key={item} value={item}>
                        {t(`period.${item}`)}
                      </option>
                    ))}
                  </SelectField>
                </>
              )}
            </div>
          )}
          {mode === 'change' &&
            pack?.options.map((option) => (
              <label key={option.id} className={styles.check}>
                <input
                  type="checkbox"
                  checked={options.includes(option.id)}
                  onChange={(event) =>
                    setOptions(
                      event.target.checked
                        ? [...options, option.id]
                        : options.filter((item) => item !== option.id),
                    )
                  }
                />
                {option.label[locale]}
              </label>
            ))}
          {mode === 'change' &&
            pack?.identifiers.map((identifier) => (
              <TextField
                key={identifier.id}
                label={`${identifier.label[locale]}${identifier.required ? '' : ` ${t('common.optional')}`}`}
                hint={t('situation.example', { example: identifier.example })}
                value={identifiers[identifier.id] ?? ''}
                onChange={(event) => setIdentifiers({ ...identifiers, [identifier.id]: event.target.value })}
              />
            ))}
          <div className={form.actions}>
            <Button variant="ghost" onClick={() => setMode('none')}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">
              {mode === 'change' ? t('situation.save') : t('situation.cease.confirm')}
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'undo' ? t('situation.undo') : t('situation.resume')}
        body={confirm === 'undo' ? t('situation.undo.body') : t('situation.resume.body')}
        confirmLabel={confirm === 'undo' ? t('situation.undo') : t('situation.resume')}
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          void run(
            () =>
              api(action === 'undo' ? '/api/situation/changes/latest' : '/api/situation/cessation', {
                method: 'DELETE',
              }),
            action === 'undo' ? t('situation.undone') : t('situation.resumed'),
          );
        }}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
