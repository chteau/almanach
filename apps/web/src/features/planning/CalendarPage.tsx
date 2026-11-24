import { addDays } from '@almanach/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { ButtonLink } from '../../components/Button/ButtonLink.tsx';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';
import styles from './Planning.module.css';
import { type CalendarItem, labelOf, TYPE_STYLE } from './types.ts';

type View = 'month' | 'week' | 'list' | 'agenda';
const TYPES: CalendarItem['type'][] = ['tax', 'social', 'invoice', 'mission', 'custom'];

/**
 * Monday on or before a date
 *
 * @param date {string} - YYYY-MM-DD
 * @returns {string} - YYYY-MM-DD
 */
function weekStart(date: string): string {
  const day = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -day);
}

/**
 * Date range shown by a view around an anchor date
 *
 * @param view {View} - selected view
 * @param anchor {string} - reference date
 * @returns {{ from: string; to: string }} - first and last day
 */
function rangeOf(view: View, anchor: string): { from: string; to: string } {
  if (view === 'week') return { from: weekStart(anchor), to: addDays(weekStart(anchor), 6) };
  if (view === 'agenda') return { from: anchor, to: addDays(anchor, 90) };
  const first = `${anchor.slice(0, 7)}-01`;
  const last = addDays(
    new Date(Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), 1)).toISOString().slice(0, 10),
    -1,
  );
  return view === 'month'
    ? { from: weekStart(first), to: addDays(weekStart(last), 6) }
    : { from: first, to: last };
}

/**
 * Calendar of tax, social, invoice, mission and personal deadlines (P05, S-060 to S-070)
 *
 * @returns {JSX.Element} - the page
 */
export function CalendarPage() {
  const { t, locale } = useI18n();
  const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
  const [view, setView] = useState<View>(phone ? 'agenda' : 'month');
  const [anchor, setAnchor] = useState(() => new Date().toISOString().slice(0, 10));
  const [types, setTypes] = useState<Set<CalendarItem['type']>>(new Set(TYPES));
  const [showHidden, setShowHidden] = useState(false);
  const [failure, setFailure] = useState<string>();
  const range = rangeOf(view, anchor);
  const { data, error, loading, reload } = useResource<{ today: string; items: CalendarItem[] }>(
    `/api/calendar?from=${range.from}&to=${range.to}`,
  );
  const visible = useMemo(
    () => (data?.items ?? []).filter((item) => types.has(item.type) && (showHidden || !item.hidden)),
    [data, types, showHidden],
  );

  /**
   * Moves the view by one period
   *
   * @param direction {1 | -1} - forward or back
   * @returns {void} - nothing
   */
  function move(direction: 1 | -1): void {
    if (view === 'week') setAnchor(addDays(anchor, 7 * direction));
    else if (view === 'agenda') setAnchor(addDays(anchor, 90 * direction));
    else
      setAnchor(
        new Date(Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 1 + direction, 1))
          .toISOString()
          .slice(0, 10),
      );
  }

  /**
   * Marks a personal deadline done or not done, without leaving the calendar (S-064, S-065)
   *
   * @param item {CalendarItem} - entry
   * @returns {Promise<void>} - resolves when saved
   */
  async function toggleDone(item: CalendarItem): Promise<void> {
    try {
      await api(`/api/deadlines/${encodeURIComponent(item.key)}/mark`, {
        method: 'PUT',
        body: { doneOn: item.done ? null : (data?.today ?? item.date), note: null, actualCents: null },
      });
      reload();
    } catch (problem) {
      setFailure(describeError(problem, t));
    }
  }

  const title =
    view === 'month' || view === 'list'
      ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
          new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`),
        )
      : `${formatDate(range.from, locale)} – ${formatDate(range.to, locale)}`;

  /**
   * Link target of an entry
   *
   * @param item {CalendarItem} - entry
   * @returns {string | null} - in-app path, or null for personal deadlines
   */
  const target = (item: CalendarItem): string | null =>
    item.type === 'tax' || item.type === 'social'
      ? `/calendar/${encodeURIComponent(item.key)}`
      : item.type === 'custom'
        ? null
        : item.link;

  /**
   * Renders one entry as a compact chip
   *
   * @param item {CalendarItem} - entry
   * @returns {JSX.Element} - chip
   */
  const chip = (item: CalendarItem) => {
    const text = labelOf(item.title, locale);
    const className = `${styles.chip} ${styles[`tone_${TYPE_STYLE[item.type].tone}`]} ${item.done ? styles.done : ''} ${item.overdue ? styles.late : ''}`;
    const path =
      target(item) ?? (item.type === 'custom' ? `/calendar/custom/${item.key.split(':')[1]}` : null);
    return path ? (
      <Link key={item.key} to={path} className={className} title={text}>
        {item.done ? '✓ ' : ''}
        {text}
      </Link>
    ) : (
      <span key={item.key} className={className}>
        {text}
      </span>
    );
  };

  const days: string[] = [];
  if (view === 'month' || view === 'week')
    for (let day = range.from; day <= range.to; day = addDays(day, 1)) days.push(day);
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of visible) byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 1 + index)),
    ),
  );

  return (
    <>
      <PageHeader title={t('nav.calendar')}>
        <ButtonLink to="/calendar/custom/new" variant="primary">
          {t('calendar.add')}
        </ButtonLink>
      </PageHeader>
      <div className={styles.calendarBar}>
        <div className={styles.nav}>
          <Button variant="ghost" onClick={() => move(-1)} aria-label={t('calendar.previous')}>
            ‹
          </Button>
          <Button variant="ghost" onClick={() => setAnchor(new Date().toISOString().slice(0, 10))}>
            {t('calendar.today')}
          </Button>
          <Button variant="ghost" onClick={() => move(1)} aria-label={t('calendar.next')}>
            ›
          </Button>
          <h2 className={styles.rangeTitle} aria-live="polite">
            {title}
          </h2>
        </div>
        <SelectField
          label={t('calendar.view')}
          value={view}
          onChange={(event) => setView(event.target.value as View)}
        >
          {(['month', 'week', 'list', 'agenda'] as const).map((value) => (
            <option key={value} value={value}>
              {t(`calendar.view.${value}`)}
            </option>
          ))}
        </SelectField>
      </div>
      <fieldset className={styles.filters}>
        <legend className="visually-hidden">{t('calendar.filter')}</legend>
        {TYPES.map((type) => (
          <label key={type} className={styles.filter}>
            <input
              type="checkbox"
              checked={types.has(type)}
              onChange={(event) => {
                const next = new Set(types);
                if (event.target.checked) next.add(type);
                else next.delete(type);
                setTypes(next);
              }}
            />
            <span className={`${styles.dot} ${styles[`tone_${TYPE_STYLE[type].tone}`]}`} aria-hidden="true" />
            {t(`calendar.type.${type}`)}
          </label>
        ))}
        <label className={styles.filter}>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />
          {t('calendar.showHidden')}
        </label>
      </fieldset>
      {failure && (
        <Notice tone="error" live>
          {failure}
        </Notice>
      )}
      {error !== undefined && <LoadError error={error} onRetry={reload} />}
      {loading && !data && <Skeleton rows={5} />}
      {data && (view === 'month' || view === 'week') && (
        <table className={styles.grid}>
          <caption className="visually-hidden">{title}</caption>
          <thead>
            <tr>
              {weekdays.map((name) => (
                <th key={name} scope="col" className={styles.weekday}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: days.length / 7 }, (_, row) => (
              <tr key={days[row * 7]}>
                {days.slice(row * 7, row * 7 + 7).map((day) => (
                  <td
                    key={day}
                    className={`${styles.cell} ${view === 'month' && day.slice(0, 7) !== anchor.slice(0, 7) ? styles.outside : ''} ${day === data.today ? styles.todayCell : ''}`}
                  >
                    <span className={styles.dayNumber}>
                      <span aria-hidden="true">{Number(day.slice(8))}</span>
                      <span className="visually-hidden">{formatDate(day, locale)}</span>
                    </span>
                    {(byDay.get(day) ?? []).map(chip)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && (view === 'list' || view === 'agenda') && visible.length === 0 && (
        <EmptyState inline title={t('calendar.empty')} body={t('calendar.empty.body')} />
      )}
      {data && (view === 'list' || view === 'agenda') && visible.length > 0 && (
        <ul className={list.list}>
          {visible.map((item) => {
            const path = target(item);
            const content = (
              <>
                <span className={list.primary}>
                  <strong>{labelOf(item.title, locale)}</strong>
                  <span className={list.secondary}>
                    {formatDate(item.date, locale)}
                    {item.movedFrom
                      ? ` · ${t('calendar.movedFrom', { date: formatDate(item.movedFrom, locale) })}`
                      : ''}
                  </span>
                </span>
                <span className={list.badges}>
                  <Badge tone={TYPE_STYLE[item.type].tone}>{t(`calendar.type.${item.type}`)}</Badge>
                  {item.done && <Badge tone="ok">{t('calendar.done')}</Badge>}
                  {item.overdue && <Badge tone="err">{t('calendar.overdue')}</Badge>}
                  {item.hidden && <Badge>{t('calendar.hidden')}</Badge>}
                </span>
              </>
            );
            return (
              <li key={item.key} className={list.item}>
                {path ? (
                  <Link to={path} className={list.row}>
                    {content}
                  </Link>
                ) : (
                  <div className={`${list.row} ${styles.customRow}`}>
                    {content}
                    <span className={styles.rowActions}>
                      <Button variant="ghost" onClick={() => void toggleDone(item)}>
                        {item.done ? t('calendar.undo') : t('calendar.markDone')}
                      </Button>
                      <ButtonLink to={`/calendar/custom/${item.key.split(':')[1]}`} variant="ghost">
                        {t('common.edit')}
                      </ButtonLink>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.caption}>
        <Link to="/settings/calendar">{t('calendar.subscribe')}</Link>
      </p>
    </>
  );
}
