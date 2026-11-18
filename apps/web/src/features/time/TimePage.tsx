import {
  addDays,
  MINUTES_PER_DAY,
  type Mission,
  parseDuration,
  TIMER_WARNING_MINUTES,
} from '@almanach/shared';
import { type SyntheticEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TableScroll } from '../../components/TableScroll/TableScroll.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { formatDate, formatMoney } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';
import styles from '../planning/Planning.module.css';
import time from './Time.module.css';

interface Entry {
  id: string;
  missionId: string;
  missionName: string;
  billing: Mission['billing'];
  clientName: string;
  date: string;
  minutes: number;
  billable: boolean;
  note: string | null;
  documentId: string | null;
  locked: boolean;
}

interface TimeData {
  today: string;
  entries: Entry[];
  timer: { id: string; missionId: string; note: string | null; startedAt: string } | null;
}

/**
 * Formats minutes as hours ("1 h 30") or, for day-rate missions, as days ("1.5 d")
 *
 * @param minutes {number} - duration
 * @param days {boolean} - true to show days
 * @param locale {string} - interface language
 * @returns {string} - text
 */
export function formatDuration(minutes: number, days: boolean, locale: string): string {
  if (days) {
    const unit = { fr: 'j', de: 'T' }[locale.slice(0, 2)] ?? 'd';
    return `${(Math.round((minutes / MINUTES_PER_DAY) * 100) / 100).toLocaleString(locale)} ${unit}`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/**
 * Monday on or before a date
 *
 * @param date {string} - YYYY-MM-DD
 * @returns {string} - YYYY-MM-DD
 */
function monday(date: string): string {
  return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
}

/**
 * Time tracking (P11): timer, weekly grid of missions by day, entries and invoicing of unbilled time
 *
 * @returns {JSX.Element} - the page
 */
export function TimePage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [week, setWeek] = useState(() => monday(new Date().toISOString().slice(0, 10)));
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const { data, error, reload } = useResource<TimeData>(`/api/time?from=${week}&to=${days[6]}`);
  const unbilled = useResource<TimeData>('/api/time?unbilled=1');
  const missions = useResource<{ missions: Mission[] }>('/api/missions');
  const active = (missions.data?.missions ?? []).filter(
    (mission) => mission.status === 'active' || mission.status === 'prospect',
  );
  const [failure, setFailure] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const [timerMission, setTimerMission] = useState('');
  const [correction, setCorrection] = useState<{ elapsed: number; value: string }>();

  useEffect(() => {
    if (!data?.timer) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [data?.timer]);

  /**
   * Reloads every list after a change
   *
   * @returns {void} - nothing
   */
  const refresh = (): void => {
    reload();
    unbilled.reload();
  };

  /**
   * Runs a call and shows its error on the page
   *
   * @param action {() => Promise<void>} - call
   * @returns {Promise<void>} - resolves when done
   */
  const run = async (action: () => Promise<void>): Promise<void> => {
    try {
      setFailure(undefined);
      await action();
      refresh();
    } catch (problem) {
      if (problem instanceof ApiError && problem.body.error === 'too_long') {
        const elapsed = Number((problem.body as { elapsedMinutes?: number }).elapsedMinutes ?? 0);
        setCorrection({ elapsed, value: '' });
        return;
      }
      setFailure(
        problem instanceof ApiError && problem.body.error === 'locked'
          ? t('time.locked')
          : describeError(problem, t),
      );
    }
  };

  const grid = useMemo(() => {
    const rows = new Map<
      string,
      { name: string; client: string; days: boolean; cells: Map<string, number> }
    >();
    for (const entry of data?.entries ?? []) {
      const row = rows.get(entry.missionId) ?? {
        name: entry.missionName,
        client: entry.clientName,
        days: entry.billing === 'daily',
        cells: new Map<string, number>(),
      };
      row.cells.set(entry.date, (row.cells.get(entry.date) ?? 0) + entry.minutes);
      rows.set(entry.missionId, row);
    }
    return [...rows.entries()];
  }, [data]);

  const timerMissionName = data?.timer
    ? missions.data?.missions.find((mission) => mission.id === data.timer?.missionId)?.name
    : undefined;
  const elapsed = data?.timer ? Math.max(0, Math.floor((now - Date.parse(data.timer.startedAt)) / 1000)) : 0;
  const clock = `${Math.floor(elapsed / 3600)}:${String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  const byMission = new Map<string, Entry[]>();
  for (const entry of unbilled.data?.entries ?? [])
    byMission.set(entry.missionId, [...(byMission.get(entry.missionId) ?? []), entry]);

  return (
    <>
      <PageHeader title={t('nav.time')} />
      <div className={form.form}>
        {failure && <Notice tone="error">{failure}</Notice>}
        <section className={form.section} aria-labelledby="timer-title">
          <h2 id="timer-title" className={styles.sectionTitle}>
            {t('time.timer')}
          </h2>
          {data?.timer ? (
            <>
              <p
                className={time.clock}
                role="timer"
                aria-label={t('time.timer.running', { mission: timerMissionName ?? '' })}
              >
                {clock}
              </p>
              <p className={styles.caption}>{t('time.timer.running', { mission: timerMissionName ?? '' })}</p>
              {elapsed / 60 > TIMER_WARNING_MINUTES && (
                <Notice tone="warn">{t('time.timer.forgotten')}</Notice>
              )}
              {correction ? (
                <form
                  onSubmit={(event: SyntheticEvent) => {
                    event.preventDefault();
                    const minutes = parseDuration(correction.value);
                    if (minutes === null) {
                      setFailure(t('time.duration.invalid'));
                      return;
                    }
                    void run(async () => {
                      await api('/api/time/timer/stop', { method: 'POST', body: { minutes } });
                      setCorrection(undefined);
                    });
                  }}
                  noValidate
                >
                  <Notice tone="warn">
                    {t('time.timer.tooLong', { duration: formatDuration(correction.elapsed, false, locale) })}
                  </Notice>
                  <TextField
                    label={t('time.timer.real')}
                    hint={t('time.duration.hint')}
                    value={correction.value}
                    onChange={(event) => setCorrection({ ...correction, value: event.target.value })}
                  />
                  <div className={form.actions}>
                    <Button type="submit">{t('time.timer.stop')}</Button>
                  </div>
                </form>
              ) : (
                <div className={form.actions}>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void run(
                        async () => void (await api(`/api/time/${data.timer?.id}`, { method: 'DELETE' })),
                      )
                    }
                  >
                    {t('time.timer.discard')}
                  </Button>
                  <Button
                    onClick={() =>
                      void run(
                        async () => void (await api('/api/time/timer/stop', { method: 'POST', body: {} })),
                      )
                    }
                  >
                    {t('time.timer.stop')}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className={time.timerBar}>
              <SelectField
                label={t('time.mission')}
                value={timerMission}
                onChange={(event) => setTimerMission(event.target.value)}
              >
                <option value="">{t('time.mission.choose')}</option>
                {active.map((mission) => (
                  <option key={mission.id} value={mission.id}>
                    {mission.name} · {mission.clientName}
                  </option>
                ))}
              </SelectField>
              <Button
                disabled={!timerMission}
                onClick={() =>
                  void run(
                    async () =>
                      void (await api('/api/time/timer/start', {
                        method: 'POST',
                        body: { missionId: timerMission, billable: true, note: null },
                      })),
                  )
                }
              >
                {t('time.timer.start')}
              </Button>
            </div>
          )}
        </section>

        <section className={form.section} aria-labelledby="week-title">
          <div className={styles.sectionHead}>
            <h2 id="week-title" className={styles.sectionTitle}>
              {t('time.week', { from: formatDate(week, locale), to: formatDate(days[6] ?? week, locale) })}
            </h2>
            <span className={time.weekNav}>
              <Button
                variant="ghost"
                onClick={() => setWeek(addDays(week, -7))}
                aria-label={t('time.week.previous')}
              >
                ‹
              </Button>
              <Button
                variant="ghost"
                onClick={() => setWeek(addDays(week, 7))}
                aria-label={t('time.week.next')}
              >
                ›
              </Button>
            </span>
          </div>
          {error !== undefined && <LoadError error={error} onRetry={reload} />}
          {!data && error === undefined && <Skeleton rows={3} />}
          {data && grid.length === 0 && <p className={styles.caption}>{t('time.week.empty')}</p>}
          {data && grid.length > 0 && (
            <TableScroll>
              <table className={styles.table}>
                <caption className="visually-hidden">{t('time.grid')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('time.mission')}</th>
                    {days.map((day) => (
                      <th key={day} scope="col" className={day === data.today ? time.today : undefined}>
                        {new Intl.DateTimeFormat(locale, {
                          weekday: 'short',
                          day: 'numeric',
                          timeZone: 'UTC',
                        }).format(new Date(`${day}T00:00:00Z`))}
                      </th>
                    ))}
                    <th scope="col">{t('time.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.map(([id, row]) => {
                    const total = [...row.cells.values()].reduce((sum, value) => sum + value, 0);
                    return (
                      <tr key={id}>
                        <th scope="row">
                          {row.name}
                          <span className={styles.step}>{row.client}</span>
                        </th>
                        {days.map((day) => (
                          <td key={day}>
                            {row.cells.get(day)
                              ? formatDuration(row.cells.get(day) ?? 0, row.days, locale)
                              : '—'}
                          </td>
                        ))}
                        <td>
                          <strong>{formatDuration(total, row.days, locale)}</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}
        </section>

        <EntryForm missions={active} today={data?.today ?? days[0] ?? week} onSaved={refresh} />

        {data && data.entries.length > 0 && (
          <section className={form.section} aria-labelledby="entries-title">
            <h2 id="entries-title" className={styles.sectionTitle}>
              {t('time.entries')}
            </h2>
            <ul className={list.list}>
              {data.entries.map((entry) => (
                <li key={entry.id} className={list.item}>
                  <div className={list.row}>
                    <span className={list.primary}>
                      <strong>
                        {entry.missionName} ·{' '}
                        {formatDuration(entry.minutes, entry.billing === 'daily', locale)}
                      </strong>
                      <span className={list.secondary}>
                        {formatDate(entry.date, locale)}
                        {entry.note ? ` · ${entry.note}` : ''}
                      </span>
                    </span>
                    <span className={list.badges}>
                      {!entry.billable && <Badge>{t('time.nonBillable')}</Badge>}
                      {entry.locked && <Badge tone="ok">{t('time.billed')}</Badge>}
                    </span>
                    {!entry.locked && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          void run(
                            async () => void (await api(`/api/time/${entry.id}`, { method: 'DELETE' })),
                          )
                        }
                      >
                        {t('common.delete')}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={form.section} aria-labelledby="unbilled-title">
          <h2 id="unbilled-title" className={styles.sectionTitle}>
            {t('time.unbilled')}
          </h2>
          {byMission.size === 0 && <p className={styles.caption}>{t('time.unbilled.none')}</p>}
          <ul className={styles.plain}>
            {[...byMission.entries()].map(([missionId, entries]) => {
              const mission = missions.data?.missions.find((item) => item.id === missionId);
              const minutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
              const days = entries[0]?.billing === 'daily';
              const billable = mission?.billing === 'hourly' || mission?.billing === 'daily';
              const amount = mission
                ? Math.round((mission.rateCents * minutes) / (days ? MINUTES_PER_DAY : 60))
                : 0;
              return (
                <li key={missionId} className={time.unbilledRow}>
                  <span>
                    <strong>{entries[0]?.missionName}</strong> · {formatDuration(minutes, days, locale)}
                    {billable && mission && (
                      <span className={styles.step}>{formatMoney(amount, mission.currency, locale)}</span>
                    )}
                  </span>
                  {billable ? (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void run(async () => {
                          const { id } = await api<{ id: string }>('/api/documents/from-time', {
                            method: 'POST',
                            body: { entryIds: entries.map((entry) => entry.id) },
                          });
                          navigate(`/documents/${id}`);
                        })
                      }
                    >
                      {t('time.invoice')}
                    </Button>
                  ) : (
                    <span className={styles.caption}>{t('time.notTimeBilled')}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}

/**
 * Manual entry form (S-130, S-134)
 *
 * @param props {{ missions: Mission[]; today: string; onSaved: () => void }} - missions, default date, refresh callback
 * @returns {JSX.Element} - the form
 */
function EntryForm({
  missions,
  today,
  onSaved,
}: {
  missions: Mission[];
  today: string;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [missionId, setMissionId] = useState('');
  const [date, setDate] = useState(today);
  const [duration, setDuration] = useState('');
  const [billable, setBillable] = useState(true);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();
  const daily = missions.find((mission) => mission.id === missionId)?.billing === 'daily';

  /**
   * Validates and saves the entry
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when saved
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const minutes = parseDuration(duration, daily);
    const found: Record<string, string> = {};
    if (!missionId) found.mission = t('time.mission.required');
    if (minutes === null) found.duration = t('time.duration.invalid');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await api('/api/time', { method: 'POST', body: { missionId, date, minutes, billable, note } });
      setDuration('');
      setNote('');
      setFailure(undefined);
      onSaved();
    } catch (problem) {
      setFailure(describeError(problem, t));
    }
  }

  return (
    <form
      className={form.section}
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-labelledby="entry-title"
    >
      <h2 id="entry-title" className={styles.sectionTitle}>
        {t('time.add')}
      </h2>
      {failure && <Notice tone="error">{failure}</Notice>}
      <div className={form.grid}>
        <SelectField
          label={t('time.mission')}
          value={missionId}
          onChange={(event) => setMissionId(event.target.value)}
          error={errors.mission}
        >
          <option value="">{t('time.mission.choose')}</option>
          {missions.map((mission) => (
            <option key={mission.id} value={mission.id}>
              {mission.name} · {mission.clientName}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t('time.date')}
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <TextField
          label={daily ? t('time.duration.days') : t('time.duration')}
          hint={daily ? t('time.duration.days.hint') : t('time.duration.hint')}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          error={errors.duration}
        />
      </div>
      <TextField
        label={`${t('time.note')} ${t('common.optional')}`}
        maxLength={300}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <label className={styles.check}>
        <input type="checkbox" checked={!billable} onChange={(event) => setBillable(!event.target.checked)} />
        {t('time.nonBillable.label')}
      </label>
      <div className={form.actions}>
        <Button type="submit">{t('time.save')}</Button>
      </div>
    </form>
  );
}
