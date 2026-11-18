import { type SyntheticEvent, useState } from 'react';
import { Button } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';
import styles from './Planning.module.css';

interface ReminderSettings {
  emailReminders: boolean;
  reminderDays: number[];
  quietHours: { start: string; end: string } | null;
  ntfy: { server: string; topic: string; token: string | null } | null;
  icalEnabled: boolean;
}

/**
 * Reminder channels, reminder days, quiet hours and the private calendar feed (P20, S-240 to S-244, S-070)
 *
 * @returns {JSX.Element} - the settings sections
 */
export function RemindersSettings() {
  const { data, error, reload } = useResource<{ settings: ReminderSettings }>('/api/settings/reminders');
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  return (
    <>
      <RemindersForm initial={data.settings} />
      <CalendarFeed enabled={data.settings.icalEnabled} onChange={reload} />
    </>
  );
}

/**
 * Form for reminder channels and timing
 *
 * @param props {{ initial: ReminderSettings }} - stored settings
 * @returns {JSX.Element} - the form
 */
function RemindersForm({ initial }: { initial: ReminderSettings }) {
  const { t } = useI18n();
  const [email, setEmail] = useState(initial.emailReminders);
  const [days, setDays] = useState(initial.reminderDays.join(', '));
  const [quiet, setQuiet] = useState(initial.quietHours !== null);
  const [quietStart, setQuietStart] = useState(initial.quietHours?.start ?? '21:00');
  const [quietEnd, setQuietEnd] = useState(initial.quietHours?.end ?? '08:00');
  const [push, setPush] = useState(initial.ntfy !== null);
  const [server, setServer] = useState(initial.ntfy?.server ?? 'https://ntfy.sh');
  const [topic, setTopic] = useState(initial.ntfy?.topic ?? '');
  const [token, setToken] = useState(initial.ntfy?.token ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'info' | 'warn' | 'error'; text: string }>();

  /**
   * Validates and saves
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<boolean>} - true when saved
   */
  async function save(event?: SyntheticEvent): Promise<boolean> {
    event?.preventDefault();
    const parsed = days
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number);
    const found: Record<string, string> = {};
    if (parsed.length > 6 || parsed.some((day) => !Number.isInteger(day) || day < 0 || day > 60))
      found.days = t('reminders.days.invalid');
    if (push && !/^https:\/\//.test(server)) found.server = t('reminders.ntfy.server.invalid');
    if (push && !/^[A-Za-z0-9_-]{1,64}$/.test(topic)) found.topic = t('reminders.ntfy.topic.invalid');
    setErrors(found);
    if (Object.keys(found).length > 0) return false;
    try {
      await api('/api/settings/reminders', {
        method: 'PUT',
        body: {
          emailReminders: email,
          reminderDays: parsed,
          quietHours: quiet ? { start: quietStart, end: quietEnd } : null,
          ntfy: push ? { server, topic, token: token || null } : null,
        },
      });
      setMessage({ tone: 'info', text: t('reminders.saved') });
      return true;
    } catch (problem) {
      setMessage({ tone: 'error', text: describeError(problem, t) });
      return false;
    }
  }

  /**
   * Saves, then sends a test e-mail and push
   *
   * @returns {Promise<void>} - resolves with the outcome shown
   */
  async function test(): Promise<void> {
    if (!(await save())) return;
    const { result, smtp } = await api<{ result: { email: string; ntfy: string }; smtp: boolean }>(
      '/api/settings/reminders/test',
      {
        method: 'POST',
      },
    );
    const parts = [
      t(
        `reminders.test.email.${result.email === 'off' && !smtp ? 'nosmtp' : result.email}` as 'reminders.test.email.sent',
      ),
      t(`reminders.test.ntfy.${result.ntfy}` as 'reminders.test.ntfy.sent'),
    ];
    setMessage({
      tone: result.email === 'failed' || result.ntfy === 'failed' ? 'warn' : 'info',
      text: parts.join(' '),
    });
  }

  return (
    <form
      id="reminders"
      className={form.section}
      onSubmit={(event) => void save(event)}
      noValidate
      aria-labelledby="reminders-title"
    >
      <h2 id="reminders-title" className={styles.sectionTitle}>
        {t('reminders.title')}
      </h2>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <label className={styles.check}>
        <input type="checkbox" checked={email} onChange={(event) => setEmail(event.target.checked)} />
        {t('reminders.email')}
      </label>
      <TextField
        label={t('reminders.days')}
        hint={t('reminders.days.hint')}
        value={days}
        onChange={(event) => setDays(event.target.value)}
        error={errors.days}
      />
      <label className={styles.check}>
        <input type="checkbox" checked={quiet} onChange={(event) => setQuiet(event.target.checked)} />
        {t('reminders.quiet')}
      </label>
      {quiet && (
        <div className={form.grid}>
          <TextField
            label={t('reminders.quiet.start')}
            type="time"
            value={quietStart}
            onChange={(event) => setQuietStart(event.target.value)}
          />
          <TextField
            label={t('reminders.quiet.end')}
            type="time"
            value={quietEnd}
            onChange={(event) => setQuietEnd(event.target.value)}
          />
        </div>
      )}
      <label className={styles.check}>
        <input type="checkbox" checked={push} onChange={(event) => setPush(event.target.checked)} />
        {t('reminders.ntfy')}
      </label>
      {push && (
        <div className={form.grid}>
          <TextField
            label={t('reminders.ntfy.server')}
            type="url"
            value={server}
            onChange={(event) => setServer(event.target.value)}
            error={errors.server}
          />
          <TextField
            label={t('reminders.ntfy.topic')}
            hint={t('reminders.ntfy.topic.hint')}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            error={errors.topic}
          />
          <TextField
            label={`${t('reminders.ntfy.token')} ${t('common.optional')}`}
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </div>
      )}
      <div className={form.actions}>
        <Button variant="ghost" onClick={() => void test()}>
          {t('reminders.test')}
        </Button>
        <Button type="submit">{t('common.save')}</Button>
      </div>
    </form>
  );
}

/**
 * Private iCal subscription link: generate, copy, revoke (S-070)
 *
 * @param props {{ enabled: boolean; onChange: () => void }} - whether a link exists, refresh callback
 * @returns {JSX.Element} - the section
 */
function CalendarFeed({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string>();

  /**
   * Creates a new link, which invalidates the previous one
   *
   * @returns {Promise<void>} - resolves when shown
   */
  async function generate(): Promise<void> {
    const { path } = await api<{ path: string }>('/api/settings/ical', { method: 'POST' });
    setUrl(new URL(path, window.location.origin).toString());
    onChange();
  }

  /**
   * Revokes the link
   *
   * @returns {Promise<void>} - resolves when revoked
   */
  async function revoke(): Promise<void> {
    await api('/api/settings/ical', { method: 'DELETE' });
    setUrl(undefined);
    onChange();
  }

  return (
    <section id="calendar-feed" className={form.section} aria-labelledby="feed-title">
      <h2 id="feed-title" className={styles.sectionTitle}>
        {t('ical.title')}
      </h2>
      <p className={styles.text}>{t('ical.body')}</p>
      {url && (
        <>
          <TextField label={t('ical.url')} value={url} readOnly onFocus={(event) => event.target.select()} />
          <Notice tone="warn">{t('ical.once')}</Notice>
        </>
      )}
      {!url && enabled && <p className={styles.caption}>{t('ical.active')}</p>}
      <div className={form.actions}>
        {enabled && (
          <Button variant="ghost" onClick={() => void revoke()}>
            {t('ical.revoke')}
          </Button>
        )}
        <Button onClick={() => void generate()}>{enabled ? t('ical.regenerate') : t('ical.generate')}</Button>
      </div>
    </section>
  );
}
