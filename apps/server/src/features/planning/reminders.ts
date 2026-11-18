import { addDays, daysBetween, LOCALES, type Locale } from '@almanach/shared';
import { and, eq, gte, isNull, lt } from 'drizzle-orm';
import { createTransport, type Transporter } from 'nodemailer';
import type { Config } from '../../config.ts';
import type { Database } from '../../db/client.ts';
import { instance, notifications, profiles, userSettings, users } from '../../db/schema.ts';
import type { PlanningService } from './planning.service.ts';

type NotificationRow = typeof notifications.$inferSelect;

/** Text of each notification kind, used for pushes and e-mails; the web app has its own copy. */
const TEXT: Record<Locale, Record<string, (params: Record<string, string | number>) => string>> = {
  fr: {
    deadline_soon: (p) =>
      p.days === 0 ? `Aujourd’hui : ${p.title}` : `${p.title} dans ${p.days} j (${p.date})`,
    deadline_late: (p) => `En retard : ${p.title} (prévu le ${p.date})`,
    invoice_overdue: (p) => `Facture ${p.number} en retard (${p.client})`,
    threshold_near: (p) => `${p.label} : ${p.percent} % atteint`,
    threshold_exceeded: (p) => `${p.label} : seuil dépassé`,
  },
  en: {
    deadline_soon: (p) => (p.days === 0 ? `Today: ${p.title}` : `${p.title} in ${p.days} days (${p.date})`),
    deadline_late: (p) => `Overdue: ${p.title} (due ${p.date})`,
    invoice_overdue: (p) => `Invoice ${p.number} is overdue (${p.client})`,
    threshold_near: (p) => `${p.label}: ${p.percent} % reached`,
    threshold_exceeded: (p) => `${p.label}: threshold exceeded`,
  },
  de: {
    deadline_soon: (p) => (p.days === 0 ? `Heute: ${p.title}` : `${p.title} in ${p.days} Tagen (${p.date})`),
    deadline_late: (p) => `Überfällig: ${p.title} (fällig am ${p.date})`,
    invoice_overdue: (p) => `Rechnung ${p.number} ist überfällig (${p.client})`,
    threshold_near: (p) => `${p.label}: ${p.percent} % erreicht`,
    threshold_exceeded: (p) => `${p.label}: Schwelle überschritten`,
  },
};

/**
 * Renders a notification as one line of text
 *
 * @param row {Pick<NotificationRow, 'kind' | 'params'>} - notification
 * @param locale {Locale} - language
 * @returns {string} - message
 */
export function notificationText(row: Pick<NotificationRow, 'kind' | 'params'>, locale: Locale): string {
  return TEXT[locale][row.kind]?.(row.params) ?? row.kind;
}

/**
 * Tells whether a local time falls within quiet hours, which may span midnight (S-240)
 *
 * @param time {string} - HH:MM local time
 * @param quiet {{ start: string; end: string } | null} - quiet hours
 * @returns {boolean} - true when pushes must wait
 */
export function inQuietHours(time: string, quiet: { start: string; end: string } | null): boolean {
  if (!quiet || quiet.start === quiet.end) return false;
  return quiet.start < quiet.end
    ? time >= quiet.start && time < quiet.end
    : time >= quiet.start || time < quiet.end;
}

/**
 * Picks the reminder offset that is due now: the smallest configured number of days still at or above
 * the days left, so a person gets one reminder per step and never a burst after downtime (S-331)
 *
 * @param daysLeft {number} - days until the deadline
 * @param offsets {number[]} - configured reminder days, e.g. [14, 7, 1, 0]
 * @returns {number | null} - the offset to notify, or null when none applies yet
 */
export function dueOffset(daysLeft: number, offsets: number[]): number | null {
  const candidates = offsets.filter((offset) => daysLeft <= offset);
  return candidates.length === 0 ? null : Math.min(...candidates);
}

/** Creates in-app notifications and sends pushes and e-mails; safe to run repeatedly (S-330 to S-332). */
export class ReminderJob {
  private readonly mailer: Transporter | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /**
   * Creates the job
   *
   * @param db {Database} - Drizzle database
   * @param planning {PlanningService} - planning rules
   * @param config {Config} - runtime configuration (SMTP)
   */
  constructor(
    private readonly db: Database,
    private readonly planning: PlanningService,
    private readonly config: Config,
  ) {
    this.mailer = config.smtpUrl ? createTransport(config.smtpUrl) : null;
  }

  /** Whether SMTP is configured on this instance. */
  get hasMail(): boolean {
    return this.mailer !== null;
  }

  /**
   * Runs now, then every ten minutes
   *
   * @returns {void} - nothing
   */
  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 10 * 60 * 1000);
  }

  /**
   * Stops the schedule
   *
   * @returns {void} - nothing
   */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One pass: create due notifications, then deliver pending ones. Errors are logged, never thrown.
   *
   * @returns {Promise<void>} - resolves when done
   */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const [settings] = await this.db.select({ timezone: instance.timezone }).from(instance).limit(1);
      if (!settings) return;
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: settings.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(now);
      const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '00';
      const today = `${part('year')}-${part('month')}-${part('day')}`;
      const time = `${part('hour')}:${part('minute')}`;
      const people = await this.db
        .select({ userId: profiles.userId, settings: userSettings, locale: users.locale, email: users.email })
        .from(profiles)
        .innerJoin(users, eq(users.id, profiles.userId))
        .leftJoin(userSettings, eq(userSettings.userId, profiles.userId));
      for (const person of people) {
        const locale = LOCALES.find((code) => code === person.locale) ?? 'en';
        await this.collect(person.userId, today, person.settings?.reminderDays ?? [7, 1, 0], locale);
        if (!inQuietHours(time, person.settings?.quietHours ?? null)) {
          await this.deliver(person.userId, locale, person.email, person.settings ?? null);
        }
      }
    } catch (error) {
      console.error('[reminders]', error);
    } finally {
      this.running = false;
    }
  }

  /**
   * Inserts the notifications that are due for one person; duplicates are ignored by the dedupe key
   *
   * @param userId {string} - person
   * @param today {string} - YYYY-MM-DD in the instance time zone
   * @param offsets {number[]} - reminder days
   * @param locale {Locale} - language of the titles stored with the notification
   * @returns {Promise<void>} - resolves when done
   */
  async collect(userId: string, today: string, offsets: number[], locale: Locale): Promise<void> {
    const horizon = Math.max(0, ...offsets);
    const items = await this.planning.calendar(userId, addDays(today, -7), addDays(today, horizon), today);
    const rows: (typeof notifications.$inferInsert)[] = [];
    for (const item of items) {
      if (item.done || item.hidden || !['tax', 'social', 'custom'].includes(item.type)) continue;
      const title = typeof item.title === 'string' ? item.title : item.title[locale];
      const link = item.type === 'custom' ? '/calendar' : `/calendar/${encodeURIComponent(item.key)}`;
      const left = daysBetween(today, item.date);
      if (left < 0) {
        rows.push({
          userId,
          kind: 'deadline_late',
          dedupeKey: `deadline:${item.key}:late`,
          params: { title, date: item.date, key: item.key },
          link,
        });
        continue;
      }
      const offset = dueOffset(left, offsets);
      if (offset === null) continue;
      rows.push({
        userId,
        kind: 'deadline_soon',
        dedupeKey: `deadline:${item.key}:${offset}`,
        params: { title, date: item.date, days: left, key: item.key },
        link,
      });
    }
    for (const invoice of await this.planning.openInvoices(userId, today)) {
      if (invoice.status !== 'overdue') continue;
      rows.push({
        userId,
        kind: 'invoice_overdue',
        dedupeKey: `invoice:${invoice.id}:overdue`,
        params: { number: invoice.number, client: invoice.clientName },
        link: `/documents/${invoice.id}`,
      });
    }
    const outlook = await this.planning.outlook(userId, today);
    for (const threshold of outlook?.thresholds ?? []) {
      if (threshold.window === 'previous_fiscal_year') continue;
      const key = `threshold:${threshold.id}:${threshold.windowStart.slice(0, 7)}`;
      if (threshold.exceeded) {
        rows.push({
          userId,
          kind: 'threshold_exceeded',
          dedupeKey: `${key}:100`,
          params: { label: threshold.label[locale], id: threshold.id },
          link: '/thresholds',
        });
      } else if (threshold.reachedBp >= 8000) {
        rows.push({
          userId,
          kind: 'threshold_near',
          dedupeKey: `${key}:80`,
          params: {
            label: threshold.label[locale],
            id: threshold.id,
            percent: Math.floor(threshold.reachedBp / 100),
          },
          link: '/thresholds',
        });
      }
    }
    if (rows.length > 0) await this.db.insert(notifications).values(rows).onConflictDoNothing();
  }

  /**
   * Sends pending notifications by ntfy and e-mail; failures are retried on later passes, up to five times
   *
   * @param userId {string} - person
   * @param locale {Locale} - language of the messages
   * @param email {string} - address for e-mail reminders
   * @param settings {typeof userSettings.$inferSelect | null} - channels
   * @returns {Promise<void>} - resolves when done
   */
  async deliver(
    userId: string,
    locale: Locale,
    email: string,
    settings: typeof userSettings.$inferSelect | null,
  ): Promise<void> {
    const wantsMail = (settings?.emailReminders ?? true) && this.mailer !== null;
    const ntfy = settings?.ntfy ?? null;
    if (!wantsMail && !ntfy) return;
    const pending = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.pushedAt),
          isNull(notifications.readAt),
          lt(notifications.pushAttempts, 5),
          gte(notifications.createdAt, new Date(Date.now() - 7 * 86_400_000)),
        ),
      )
      .limit(20);
    for (const row of pending) {
      const text = notificationText(row, locale);
      try {
        if (ntfy) {
          const response = await fetch(
            `${ntfy.server.replace(/\/$/, '')}/${encodeURIComponent(ntfy.topic)}`,
            {
              method: 'POST',
              body: text,
              headers: {
                Title: 'Almanach',
                ...(ntfy.token ? { Authorization: `Bearer ${ntfy.token}` } : {}),
              },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!response.ok) throw new Error(`ntfy answered ${response.status}`);
        }
        if (wantsMail && this.mailer) {
          await this.mailer.sendMail({
            from: this.config.smtpFrom ?? 'Almanach <almanach@localhost>',
            to: email,
            subject: `Almanach — ${text}`,
            text,
          });
        }
        await this.db.update(notifications).set({ pushedAt: new Date() }).where(eq(notifications.id, row.id));
      } catch (error) {
        console.error('[reminders] delivery failed', error instanceof Error ? error.message : error);
        await this.db
          .update(notifications)
          .set({ pushAttempts: row.pushAttempts + 1 })
          .where(eq(notifications.id, row.id));
      }
    }
  }

  /**
   * Sends a test message on the configured channels (S-237, S-238)
   *
   * @param email {string} - recipient
   * @param ntfy {{ server: string; topic: string; token: string | null } | null} - ntfy settings
   * @param locale {Locale} - language
   * @returns {Promise<{ email: 'sent' | 'off' | 'failed'; ntfy: 'sent' | 'off' | 'failed' }>} - per channel result
   */
  async test(
    email: string,
    ntfy: { server: string; topic: string; token: string | null } | null,
    locale: Locale,
  ): Promise<{ email: 'sent' | 'off' | 'failed'; ntfy: 'sent' | 'off' | 'failed' }> {
    const text = {
      fr: 'Test Almanach : les rappels fonctionnent.',
      en: 'Almanach test: reminders work.',
      de: 'Almanach-Test: Erinnerungen funktionieren.',
    }[locale];
    const result: { email: 'sent' | 'off' | 'failed'; ntfy: 'sent' | 'off' | 'failed' } = {
      email: 'off',
      ntfy: 'off',
    };
    if (this.mailer) {
      result.email = await this.mailer
        .sendMail({
          from: this.config.smtpFrom ?? 'Almanach <almanach@localhost>',
          to: email,
          subject: text,
          text,
        })
        .then(() => 'sent' as const)
        .catch(() => 'failed' as const);
    }
    if (ntfy) {
      result.ntfy = await fetch(`${ntfy.server.replace(/\/$/, '')}/${encodeURIComponent(ntfy.topic)}`, {
        method: 'POST',
        body: text,
        headers: { Title: 'Almanach', ...(ntfy.token ? { Authorization: `Bearer ${ntfy.token}` } : {}) },
        signal: AbortSignal.timeout(10_000),
      })
        .then((response) => (response.ok ? ('sent' as const) : ('failed' as const)))
        .catch(() => 'failed' as const);
    }
    return result;
  }
}
