import type { PackMeta, Situation } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import { DangerAction, DangerZone } from '../../components/DangerZone/DangerZone.tsx';
import { Field } from '../../components/Field/Field.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import text from '../../styles/text.module.css';
import { describeError } from '../install/errors.ts';
import { useAction } from './useAction.ts';

interface SituationData {
  today: string;
  activityStart: string;
  ceasedOn: string | null;
  current: Situation;
  changes: { id: string; effectiveOn: string; before: Situation; after: Situation }[];
}

/**
 * Status and country with their dated history, a change of status, and the end of activity in a
 * danger zone (P20, S-231 to S-233)
 *
 * @returns {JSX.Element} - the sections
 */
export function SituationSettings() {
  const situation = useResource<SituationData>('/api/situation');
  const packs = useResource<{ packs: PackMeta[] }>('/api/packs');
  const failed = situation.error ?? packs.error;
  if (failed !== undefined) return <LoadError error={failed} onRetry={situation.reload} />;
  if (!situation.data || !packs.data) return <Skeleton rows={3} />;
  return <SituationSection data={situation.data} packs={packs.data.packs} onChange={situation.reload} />;
}

/**
 * Sections once the data is loaded
 *
 * @param props {{ data: SituationData; packs: PackMeta[]; onChange: () => void }} - situation, packs, refresh
 * @returns {JSX.Element} - the sections
 */
function SituationSection({
  data,
  packs,
  onChange,
}: {
  data: SituationData;
  packs: PackMeta[];
  onChange: () => void;
}) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<'none' | 'change' | 'cessation'>('none');
  const [effectiveOn, setEffectiveOn] = useState(data.today);
  const [country, setCountry] = useState(data.current.country);
  const [status, setStatus] = useState(data.current.status ?? '');
  const [period, setPeriod] = useState(data.current.declarationPeriod ?? '');
  const [options, setOptions] = useState<string[]>(data.current.options);
  const [identifiers, setIdentifiers] = useState<Record<string, string>>(data.current.identifiers);
  const [confirm, setConfirm] = useState<'undo' | 'resume' | null>(null);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string }>();
  const action = useAction();
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
   * Opens or closes the form, starting from the current values
   *
   * @param next {'none' | 'change' | 'cessation'} - form to show
   * @returns {void} - nothing
   */
  const open = (next: 'none' | 'change' | 'cessation'): void => {
    setMode(next);
    setEffectiveOn(data.today);
    setCountry(data.current.country);
    setStatus(data.current.status ?? '');
    setPeriod(data.current.declarationPeriod ?? '');
    setOptions(data.current.options);
    setIdentifiers(data.current.identifiers);
    action.setFeedback(null);
  };

  /**
   * Saves the new situation or the end of activity; the result stays shown after the refresh
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when saved
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const cessation = mode === 'cessation';
    const done = await action.run(async () => {
      if (cessation) {
        await api('/api/situation/cessation', { method: 'PUT', body: { effectiveOn } });
        return;
      }
      await api('/api/situation/changes', {
        method: 'POST',
        body: {
          effectiveOn,
          country,
          status: status || null,
          declarationPeriod: period || null,
          options,
          identifiers: Object.fromEntries(
            Object.entries(identifiers).filter(([key]) => pack?.identifiers.some((item) => item.id === key)),
          ),
          currency: pack?.currency ?? data.current.currency,
        },
      });
    });
    if (!done) return;
    const date = formatDate(effectiveOn, locale);
    setResult({
      tone: 'success',
      text: cessation ? t('situation.ceased.saved', { date }) : t('situation.saved', { date }),
    });
    setMode('none');
    onChange();
  }

  /**
   * Undoes the latest change or cancels the end of activity, after confirmation
   *
   * @param kind {'undo' | 'resume'} - what to revert
   * @returns {Promise<void>} - resolves when done
   */
  async function revert(kind: 'undo' | 'resume'): Promise<void> {
    setConfirm(null);
    try {
      await api(kind === 'undo' ? '/api/situation/changes/latest' : '/api/situation/cessation', {
        method: 'DELETE',
      });
      setResult({ tone: 'success', text: kind === 'undo' ? t('situation.undone') : t('situation.resumed') });
      onChange();
    } catch (problem) {
      setResult({ tone: 'error', text: describeError(problem, t) });
    }
  }

  const editing = mode !== 'none';

  return (
    <>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <SettingsSection
          title={t('situation.title')}
          description={t('settings.situation.body')}
          footer={
            editing ? (
              <ActionBar
                primaryLabel={mode === 'change' ? t('situation.save') : t('situation.cease.confirm')}
                busy={action.busy}
                feedback={action.feedback}
              >
                <Button variant="ghost" onClick={() => open('none')}>
                  {t('common.cancel')}
                </Button>
              </ActionBar>
            ) : undefined
          }
        >
          {result && (
            <Notice tone={result.tone} live>
              {result.text}
            </Notice>
          )}
          {data.ceasedOn && (
            <Notice tone="warn">
              {data.ceasedOn < data.today
                ? t('situation.ceased', { date: formatDate(data.ceasedOn, locale) })
                : t('situation.ceasing', { date: formatDate(data.ceasedOn, locale) })}
            </Notice>
          )}
          <p className={text.text}>
            {t('situation.current')} <strong>{describe(data.current)}</strong>
          </p>
          {data.changes.length > 0 && (
            <>
              <h3 className={text.subTitle}>{t('settings.situation.history')}</h3>
              <ul className={text.plain}>
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
            </>
          )}
          {!editing && (
            <div className={form.actions}>
              {data.changes.length > 0 && !data.ceasedOn && (
                <Button variant="subtle" onClick={() => setConfirm('undo')} aria-haspopup="dialog">
                  {t('situation.undo')}
                </Button>
              )}
              {data.ceasedOn ? (
                <Button variant="ghost" onClick={() => setConfirm('resume')} aria-haspopup="dialog">
                  {t('situation.resume')}
                </Button>
              ) : (
                <Button onClick={() => open('change')}>{t('situation.change')}</Button>
              )}
            </div>
          )}
          {editing && (
            <>
              <p className={text.caption}>
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
            </>
          )}
          {mode === 'change' && (
            <>
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
              {pack?.options.map((option) => (
                <Field key={option.id} label={option.label[locale]} checkbox>
                  {(control) => (
                    <input
                      {...control}
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
                  )}
                </Field>
              ))}
              {pack?.identifiers.map((identifier) => (
                <TextField
                  key={identifier.id}
                  label={`${identifier.label[locale]}${identifier.required ? '' : ` ${t('common.optional')}`}`}
                  hint={t('situation.example', { example: identifier.example })}
                  value={identifiers[identifier.id] ?? ''}
                  onChange={(event) =>
                    setIdentifiers({ ...identifiers, [identifier.id]: event.target.value })
                  }
                />
              ))}
            </>
          )}
        </SettingsSection>
      </form>
      {!data.ceasedOn && mode !== 'cessation' && (
        <DangerZone>
          <DangerAction
            label={t('situation.cease')}
            consequence={t('settings.situation.cease.consequence')}
            actionLabel={t('settings.situation.cease.action')}
            confirmBody={t('situation.cease.hint')}
            confirmLabel={t('settings.situation.cease.next')}
            onConfirm={() => open('cessation')}
          />
        </DangerZone>
      )}
      <ConfirmDialog
        open={confirm !== null}
        danger={confirm === 'undo'}
        title={confirm === 'undo' ? t('situation.undo') : t('situation.resume')}
        body={confirm === 'undo' ? t('situation.undo.body') : t('situation.resume.body')}
        confirmLabel={confirm === 'undo' ? t('situation.undo') : t('situation.resume')}
        onConfirm={() => confirm && void revert(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
