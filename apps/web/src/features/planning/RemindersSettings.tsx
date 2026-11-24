import { type SyntheticEvent, useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { ButtonLink } from '../../components/Button/ButtonLink.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import { DangerAction, DangerZone } from '../../components/DangerZone/DangerZone.tsx';
import { Field } from '../../components/Field/Field.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { useResource } from '../../lib/useResource.ts';
import text from '../../styles/text.module.css';
import { describeError } from '../install/errors.ts';
import { useAction } from '../settings/useAction.ts';

/** A test that reached the server but where a channel failed; its message is shown as is. */
class TestFailure extends Error {}

interface ReminderSettings {
  emailReminders: boolean;
  reminderDays: number[];
  quietHours: { start: string; end: string } | null;
  ntfy: { server: string; topic: string; token: string | null } | null;
  icalEnabled: boolean;
}

/**
 * Reminder channels, reminder days and quiet hours (P20, S-240 to S-244)
 *
 * @returns {JSX.Element} - the settings section
 */
export function RemindersSettings() {
  const { data, error, reload } = useResource<{ settings: ReminderSettings }>('/api/settings/reminders');
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  return <RemindersForm initial={data.settings} />;
}

/**
 * Private calendar feed panel (S-070)
 *
 * @returns {JSX.Element} - the settings section
 */
export function CalendarFeedSettings() {
  const { data, error, reload } = useResource<{ settings: ReminderSettings }>('/api/settings/reminders');
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={2} />;
  return <CalendarFeed enabled={data.settings.icalEnabled} onChange={reload} />;
}

/**
 * Form for reminder channels and timing
 *
 * @param props {{ initial: ReminderSettings }} - stored settings
 * @returns {JSX.Element} - the form
 */
function RemindersForm({ initial }: { initial: ReminderSettings }) {
  const { t } = useI18n();
  const start = () => ({
    email: initial.emailReminders,
    days: initial.reminderDays.join(', '),
    quiet: initial.quietHours !== null,
    quietStart: initial.quietHours?.start ?? '21:00',
    quietEnd: initial.quietHours?.end ?? '08:00',
    push: initial.ntfy !== null,
    server: initial.ntfy?.server ?? 'https://ntfy.sh',
    topic: initial.ntfy?.topic ?? '',
    token: initial.ntfy?.token ?? '',
  });
  const [saved, setSaved] = useState(start);
  const [values, setValues] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction((problem) => (problem instanceof TestFailure ? problem.message : undefined));
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

  /**
   * Updates one field
   *
   * @param patch {Partial<typeof values>} - changed fields
   * @returns {void} - nothing
   */
  const set = (patch: Partial<typeof values>): void => setValues({ ...values, ...patch });

  /**
   * Validates and stores the settings
   *
   * @returns {Promise<void>} - resolves when saved; throws the API error otherwise
   */
  async function persist(): Promise<void> {
    await api('/api/settings/reminders', {
      method: 'PUT',
      body: {
        emailReminders: values.email,
        reminderDays: values.days
          .split(/[\s,;]+/)
          .filter(Boolean)
          .map(Number),
        quietHours: values.quiet ? { start: values.quietStart, end: values.quietEnd } : null,
        ntfy: values.push
          ? { server: values.server, topic: values.topic, token: values.token || null }
          : null,
      },
    });
    setSaved(values);
  }

  /**
   * Checks the fields before saving
   *
   * @returns {boolean} - true when valid
   */
  function validate(): boolean {
    const parsed = values.days
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number);
    const found: Record<string, string> = {};
    if (parsed.length > 6 || parsed.some((day) => !Number.isInteger(day) || day < 0 || day > 60))
      found.days = t('reminders.days.invalid');
    if (values.push && !/^https:\/\//.test(values.server)) found.server = t('reminders.ntfy.server.invalid');
    if (values.push && !/^[A-Za-z0-9_-]{1,64}$/.test(values.topic))
      found.topic = t('reminders.ntfy.topic.invalid');
    setErrors(found);
    if (Object.keys(found).length > 0)
      action.setFeedback({ tone: 'error', text: t('settings.form.invalid') });
    return Object.keys(found).length === 0;
  }

  /**
   * Saves the form
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    if (!validate()) return;
    await action.run(async () => {
      await persist();
      return t('reminders.saved');
    });
  }

  /**
   * Saves, then sends a test e-mail and push; the outcome of each channel is shown by the button
   *
   * @returns {Promise<void>} - resolves when done
   */
  async function test(): Promise<void> {
    if (!validate()) return;
    await action.run(async () => {
      await persist();
      const { result, smtp } = await api<{ result: { email: string; ntfy: string }; smtp: boolean }>(
        '/api/settings/reminders/test',
        { method: 'POST' },
      );
      const parts = [
        t(
          `reminders.test.email.${result.email === 'off' && !smtp ? 'nosmtp' : result.email}` as 'reminders.test.email.sent',
        ),
        t(`reminders.test.ntfy.${result.ntfy}` as 'reminders.test.ntfy.sent'),
      ].join(' ');
      if (result.email === 'failed' || result.ntfy === 'failed') throw new TestFailure(parts);
      return parts;
    });
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <SettingsSection
        title={t('reminders.title')}
        description={t('settings.reminders.body')}
        footer={
          <ActionBar
            primaryLabel={t('common.save')}
            busy={action.busy}
            dirty={dirty}
            feedback={action.feedback}
          >
            <Button variant="ghost" disabled={action.busy} onClick={() => void test()}>
              {t('reminders.test')}
            </Button>
          </ActionBar>
        }
      >
        <Field label={t('reminders.email')} hint={<EmailHint />} checkbox>
          {(control) => (
            <input
              {...control}
              type="checkbox"
              checked={values.email}
              onChange={(event) => set({ email: event.target.checked })}
            />
          )}
        </Field>
        <TextField
          label={t('reminders.days')}
          hint={t('reminders.days.hint')}
          value={values.days}
          onChange={(event) => set({ days: event.target.value })}
          error={errors.days}
        />
        <Field label={t('reminders.quiet')} checkbox>
          {(control) => (
            <input
              {...control}
              type="checkbox"
              checked={values.quiet}
              onChange={(event) => set({ quiet: event.target.checked })}
            />
          )}
        </Field>
        {values.quiet && (
          <div className={form.grid}>
            <TextField
              label={t('reminders.quiet.start')}
              type="time"
              value={values.quietStart}
              onChange={(event) => set({ quietStart: event.target.value })}
            />
            <TextField
              label={t('reminders.quiet.end')}
              type="time"
              value={values.quietEnd}
              onChange={(event) => set({ quietEnd: event.target.value })}
            />
          </div>
        )}
        <Field label={t('reminders.ntfy')} checkbox>
          {(control) => (
            <input
              {...control}
              type="checkbox"
              checked={values.push}
              onChange={(event) => set({ push: event.target.checked })}
            />
          )}
        </Field>
        {values.push && (
          <div className={form.grid}>
            <TextField
              label={t('reminders.ntfy.server')}
              type="url"
              value={values.server}
              onChange={(event) => set({ server: event.target.value })}
              error={errors.server}
            />
            <TextField
              label={t('reminders.ntfy.topic')}
              hint={t('reminders.ntfy.topic.hint')}
              value={values.topic}
              onChange={(event) => set({ topic: event.target.value })}
              error={errors.topic}
            />
            <TextField
              label={`${t('reminders.ntfy.token')} ${t('common.optional')}`}
              type="password"
              autoComplete="off"
              value={values.token}
              onChange={(event) => set({ token: event.target.value })}
            />
          </div>
        )}
      </SettingsSection>
    </form>
  );
}

/**
 * Hint under the e-mail switch, pointing to the panel where sending is set up
 *
 * @returns {JSX.Element} - the hint
 */
function EmailHint() {
  const { t } = useI18n();
  return (
    <>
      {t('settings.reminders.email.hint')}{' '}
      <ButtonLink to="/settings/email" variant="subtle">
        {t('settings.panel.email')}
      </ButtonLink>
    </>
  );
}

/**
 * Private iCal subscription link: generate, copy, replace or revoke after confirmation (S-070)
 *
 * @param props {{ enabled: boolean; onChange: () => void }} - whether a link exists, refresh callback
 * @returns {JSX.Element} - the sections
 */
function CalendarFeed({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string>();
  const action = useAction();

  /**
   * Creates a new link, which invalidates the previous one
   *
   * @returns {Promise<void>} - resolves when shown
   */
  async function generate(): Promise<void> {
    setResult(undefined);
    await action.run(async () => {
      const { path } = await api<{ path: string }>('/api/settings/ical', { method: 'POST' });
      setUrl(new URL(path, window.location.origin).toString());
      onChange();
    });
  }

  /**
   * Revokes the link
   *
   * @returns {Promise<void>} - resolves when revoked
   */
  async function revoke(): Promise<void> {
    try {
      await api('/api/settings/ical', { method: 'DELETE' });
      setUrl(undefined);
      setResult(t('settings.ical.revoked'));
      action.setFeedback(null);
      onChange();
    } catch (problem) {
      action.setFeedback({ tone: 'error', text: describeError(problem, t) });
    }
  }

  return (
    <>
      <SettingsSection
        title={t('ical.title')}
        description={t('ical.body')}
        footer={
          <ActionBar
            primaryLabel={enabled ? t('ical.regenerate') : t('ical.generate')}
            busy={action.busy}
            feedback={action.feedback?.tone === 'error' ? action.feedback : null}
            onPrimary={() => (enabled ? setConfirming(true) : void generate())}
          />
        }
      >
        {result && (
          <Notice tone="success" live>
            {result}
          </Notice>
        )}
        {url && (
          <>
            <TextField
              label={t('ical.url')}
              value={url}
              readOnly
              onFocus={(event) => event.target.select()}
            />
            <Notice tone="warn" live>
              {t('ical.once')}
            </Notice>
          </>
        )}
        {!url && <p className={text.text}>{enabled ? t('ical.active') : t('settings.ical.none')}</p>}
      </SettingsSection>
      {enabled && (
        <DangerZone>
          <DangerAction
            label={t('ical.revoke')}
            consequence={t('settings.ical.revoke.consequence')}
            actionLabel={t('settings.ical.revoke.action')}
            onConfirm={() => void revoke()}
          />
        </DangerZone>
      )}
      <ConfirmDialog
        open={confirming}
        title={t('ical.regenerate')}
        body={t('settings.ical.regenerate.body')}
        confirmLabel={t('ical.regenerate')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void generate();
        }}
      />
    </>
  );
}
