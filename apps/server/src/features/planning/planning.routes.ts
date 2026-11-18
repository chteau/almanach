import { addDays, fiscalYearOf, idSchema, isoDateSchema, LOCALES, optionalText } from '@almanach/shared';
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import {
  customDeadlines,
  deadlineMarks,
  documents,
  instance,
  notifications,
  userSettings,
  users,
} from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import { randomToken, sha256 } from '../../security/tokens.ts';
import type { PackRegistry } from '../packs/packs.ts';
import { renderIcal } from './ical.ts';
import { occurrencesOf, type PlanningService } from './planning.service.ts';
import type { ReminderJob } from './reminders.ts';

const KEY = /^(?:[a-z0-9_]{1,60}:\d{4}-\d{2}-\d{2}|custom:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2})$/;

const customSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    date: isoDateSchema,
    recurrence: z.enum(['none', 'monthly', 'quarterly', 'yearly']),
    until: isoDateSchema.nullable(),
    notes: optionalText(1000),
  })
  .strict()
  .refine((value) => !value.until || value.until >= value.date, {
    path: ['until'],
    message: 'until_before_date',
  });

const markSchema = z
  .object({
    doneOn: isoDateSchema.nullable(),
    note: optionalText(500),
    actualCents: z.number().int().min(0).max(100_000_000_000).nullable(),
  })
  .strict();

const settingsSchema = z
  .object({
    emailReminders: z.boolean(),
    reminderDays: z.array(z.number().int().min(0).max(60)).max(6),
    quietHours: z
      .object({
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .strict()
      .nullable(),
    ntfy: z
      .object({
        server: z.url({ protocol: /^https$/ }).max(200),
        topic: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        token: z.string().max(200).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/**
 * Today's date in the instance time zone, so deadlines follow the fiscal country's calendar (S-322)
 *
 * @param db {Database} - Drizzle database
 * @returns {Promise<string>} - YYYY-MM-DD
 */
export async function instanceToday(db: Database): Promise<string> {
  const [row] = await db.select({ timezone: instance.timezone }).from(instance).limit(1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: row?.timezone ?? 'UTC' }).format(new Date());
}

/**
 * Validates an optional date query parameter
 *
 * @param value {string | undefined} - raw parameter
 * @param fallback {string} - default value
 * @returns {string | null} - the date, or null when malformed
 */
function dateParam(value: string | undefined, fallback: string): string | null {
  if (value === undefined) return fallback;
  return isoDateSchema.safeParse(value).success ? value : null;
}

/**
 * Builds the calendar, deadline, dashboard, outlook, notification and reminder settings routes.
 * Mount behind requireUser, except the iCal feed which authenticates with its secret token.
 *
 * @param db {Database} - Drizzle database
 * @param planning {PlanningService} - planning rules
 * @param packs {PackRegistry} - country packs
 * @param reminders {ReminderJob} - reminder delivery, for test messages
 * @returns {{ api: Hono<AppEnv>; feed: Hono<AppEnv> }} - authenticated routes and the public feed
 */
export function planningRoutes(
  db: Database,
  planning: PlanningService,
  packs: PackRegistry,
  reminders: ReminderJob,
) {
  const api = new Hono<AppEnv>();

  api.get('/calendar', async (c) => {
    const today = await instanceToday(db);
    const from = dateParam(c.req.query('from'), addDays(today, -31));
    const to = dateParam(c.req.query('to'), addDays(today, 62));
    if (!from || !to || to < from || addDays(from, 400) < to) return c.json({ error: 'invalid_range' }, 422);
    return c.json({ today, items: await planning.calendar(c.var.user.id, from, to, today) });
  });

  api.get('/deadlines/:key', async (c) => {
    const key = c.req.param('key');
    if (!KEY.test(key) || key.startsWith('custom:')) return c.json({ error: 'not_found' }, 404);
    const detail = await planning.deadline(c.var.user.id, key);
    return detail
      ? c.json({ deadline: detail, today: await instanceToday(db) })
      : c.json({ error: 'not_found' }, 404);
  });

  /**
   * Checks that a deadline key belongs to the person: an existing pack occurrence or one of their custom deadlines
   *
   * @param userId {string} - owner
   * @param key {string} - occurrence key
   * @returns {Promise<boolean>} - true when the key is theirs
   */
  async function ownsKey(userId: string, key: string): Promise<boolean> {
    if (!KEY.test(key)) return false;
    if (key.startsWith('custom:')) {
      const [, id, date] = key.split(':');
      if (!id || !date) return false;
      const [row] = await db
        .select()
        .from(customDeadlines)
        .where(and(eq(customDeadlines.id, id), eq(customDeadlines.userId, userId)))
        .limit(1);
      return Boolean(row && occurrencesOf(row, date, date).length === 1);
    }
    return (await planning.deadline(userId, key)) !== undefined;
  }

  api.put('/deadlines/:key/mark', async (c) => {
    const key = c.req.param('key');
    if (!(await ownsKey(c.var.user.id, key))) return c.json({ error: 'not_found' }, 404);
    const { data, response } = await parseBody(c, markSchema);
    if (response) return response;
    await db
      .insert(deadlineMarks)
      .values({ userId: c.var.user.id, key, ...data })
      .onConflictDoUpdate({
        target: [deadlineMarks.userId, deadlineMarks.key],
        set: { ...data, updatedAt: new Date() },
      });
    if (data.doneOn) {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, c.var.user.id),
            sql`${notifications.dedupeKey} LIKE ${`deadline:${key}:%`}`,
            isNull(notifications.readAt),
          ),
        );
    }
    return c.body(null, 204);
  });

  api.put('/deadlines/:key/hidden', async (c) => {
    const key = c.req.param('key');
    if (!(await ownsKey(c.var.user.id, key))) return c.json({ error: 'not_found' }, 404);
    const { data, response } = await parseBody(c, z.object({ hidden: z.boolean() }).strict());
    if (response) return response;
    await db
      .insert(deadlineMarks)
      .values({ userId: c.var.user.id, key, hidden: data.hidden })
      .onConflictDoUpdate({
        target: [deadlineMarks.userId, deadlineMarks.key],
        set: { hidden: data.hidden, updatedAt: new Date() },
      });
    return c.body(null, 204);
  });

  api.get('/custom-deadlines', async (c) => {
    const rows = await db
      .select()
      .from(customDeadlines)
      .where(eq(customDeadlines.userId, c.var.user.id))
      .orderBy(customDeadlines.date);
    return c.json({ deadlines: rows.map(({ userId: _owner, ...row }) => row) });
  });

  api.post('/custom-deadlines', async (c) => {
    const { data, response } = await parseBody(c, customSchema);
    if (response) return response;
    const [row] = await db
      .insert(customDeadlines)
      .values({ ...data, userId: c.var.user.id })
      .returning({ id: customDeadlines.id });
    return c.json({ id: row?.id }, 201);
  });

  api.put('/custom-deadlines/:id', async (c) => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success) return c.json({ error: 'not_found' }, 404);
    const { data, response } = await parseBody(c, customSchema);
    if (response) return response;
    const updated = await db
      .update(customDeadlines)
      .set(data)
      .where(and(eq(customDeadlines.id, id), eq(customDeadlines.userId, c.var.user.id)))
      .returning({ id: customDeadlines.id });
    return updated.length > 0 ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
  });

  api.delete('/custom-deadlines/:id', async (c) => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success) return c.json({ error: 'not_found' }, 404);
    const deleted = await db
      .delete(customDeadlines)
      .where(and(eq(customDeadlines.id, id), eq(customDeadlines.userId, c.var.user.id)))
      .returning({ id: customDeadlines.id });
    if (deleted.length === 0) return c.json({ error: 'not_found' }, 404);
    await db
      .delete(deadlineMarks)
      .where(
        and(eq(deadlineMarks.userId, c.var.user.id), sql`${deadlineMarks.key} LIKE ${`custom:${id}:%`}`),
      );
    return c.body(null, 204);
  });

  api.get('/outlook', async (c) => {
    const simulate = Number(c.req.query('simulate') ?? 0);
    if (!Number.isSafeInteger(simulate) || simulate < 0 || simulate > 100_000_000_000) {
      return c.json({ error: 'invalid_simulation' }, 422);
    }
    const outlook = await planning.outlook(c.var.user.id, await instanceToday(db), simulate);
    return c.json({ outlook });
  });

  api.get('/dashboard', async (c) => {
    const userId = c.var.user.id;
    const today = await instanceToday(db);
    const profile = await planning.profile(userId);
    if (!profile) return c.json({ error: 'not_found' }, 404);
    const pack = packs.get(profile.country);
    const fiscal = fiscalYearOf(today, pack?.fiscalYearStart ?? '01-01');
    const month = today.slice(0, 7);
    const quarterStartMonth = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
    const periods = {
      month: { start: `${month}-01`, end: addDays(`${shiftMonth(month, 1)}-01`, -1) },
      quarter: {
        start: `${today.slice(0, 4)}-${String(quarterStartMonth).padStart(2, '0')}-01`,
        end: addDays(
          `${shiftMonth(`${today.slice(0, 4)}-${String(quarterStartMonth).padStart(2, '0')}`, 3)}-01`,
          -1,
        ),
      },
      year: { start: fiscal.start, end: fiscal.end },
    };
    const previous = {
      month: { start: `${shiftMonth(month, -1)}-01`, end: addDays(periods.month.start, -1) },
      quarter: {
        start: `${shiftMonth(periods.quarter.start.slice(0, 7), -3)}-01`,
        end: addDays(periods.quarter.start, -1),
      },
      year: { start: `${fiscal.year - 1}${fiscal.start.slice(4)}`, end: addDays(fiscal.start, -1) },
    };
    const earliest = [previous.year.start, previous.quarter.start].sort()[0] ?? previous.year.start;
    const collected = await planning.receipts(userId, profile.currency, earliest, fiscal.end);
    const invoiced = await db
      .select({ type: documents.type, issueDate: documents.issueDate, totals: documents.totals })
      .from(documents)
      .where(
        and(
          eq(documents.userId, userId),
          ne(documents.state, 'draft'),
          inArray(documents.type, ['invoice', 'deposit', 'credit_note']),
          eq(documents.currency, profile.currency),
          gte(documents.issueDate, earliest),
          lte(documents.issueDate, fiscal.end),
        ),
      );
    /**
     * Sums collected and invoiced amounts within a period
     *
     * @param range {{ start: string; end: string }} - period
     * @returns {{ collectedCents: number; invoicedCents: number }} - totals in the main currency
     */
    const sum = (range: { start: string; end: string }) => ({
      collectedCents: collected.receipts
        .filter((receipt) => receipt.date >= range.start && receipt.date <= range.end)
        .reduce((total, receipt) => total + receipt.cents, 0),
      invoicedCents: invoiced
        .filter((doc) => doc.issueDate >= range.start && doc.issueDate <= range.end)
        .reduce((total, doc) => total + (doc.type === 'credit_note' ? -1 : 1) * doc.totals.netCents, 0),
    });
    const calendar = await planning.calendar(userId, addDays(today, -366), addDays(today, 30), today);
    const visible = calendar.filter((item) => !item.hidden && !item.done && item.type !== 'mission');
    const outlook = await planning.outlook(userId, today);
    return c.json({
      today,
      currency: profile.currency,
      revenue: {
        month: { ...sum(periods.month), previous: sum(previous.month) },
        quarter: { ...sum(periods.quarter), previous: sum(previous.quarter) },
        year: { ...sum(periods.year), previous: sum(previous.year), start: fiscal.start, end: fiscal.end },
      },
      unconverted: collected.unconverted,
      overdueDeadlines: visible.filter((item) => item.overdue && item.type !== 'invoice'),
      upcoming: visible.filter((item) => item.date >= today).slice(0, 8),
      overdueInvoices: (await planning.openInvoices(userId, today)).filter(
        (invoice) => invoice.status === 'overdue',
      ),
      outlook,
    });
  });

  api.get('/notifications', async (c) => {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, c.var.user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(100);
    return c.json({
      notifications: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        params: row.params,
        link: row.link,
        createdAt: row.createdAt.toISOString(),
        read: row.readAt !== null,
      })),
    });
  });

  api.post('/notifications/read-all', async (c) => {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, c.var.user.id), isNull(notifications.readAt)));
    return c.body(null, 204);
  });

  api.post('/notifications/:id/read', async (c) => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success) return c.json({ error: 'not_found' }, 404);
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, c.var.user.id)));
    return c.body(null, 204);
  });

  api.get('/settings/reminders', async (c) => {
    const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, c.var.user.id)).limit(1);
    return c.json({
      settings: {
        emailReminders: row?.emailReminders ?? true,
        reminderDays: row?.reminderDays ?? [7, 1, 0],
        quietHours: row?.quietHours ?? null,
        ntfy: row?.ntfy ? { ...row.ntfy, token: row.ntfy.token ? '********' : null } : null,
        icalEnabled: Boolean(row?.icalTokenHash),
      },
    });
  });

  api.put('/settings/reminders', async (c) => {
    const { data, response } = await parseBody(c, settingsSchema);
    if (response) return response;
    const [current] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, c.var.user.id))
      .limit(1);
    // The token is never sent back; "********" keeps the stored one.
    const ntfy =
      data.ntfy && data.ntfy.token === '********'
        ? { ...data.ntfy, token: current?.ntfy?.token ?? null }
        : data.ntfy;
    const values = { ...data, ntfy, reminderDays: [...new Set(data.reminderDays)].sort((a, b) => b - a) };
    await db
      .insert(userSettings)
      .values({ userId: c.var.user.id, ...values })
      .onConflictDoUpdate({ target: userSettings.userId, set: { ...values, updatedAt: new Date() } });
    return c.body(null, 204);
  });

  api.post('/settings/reminders/test', async (c) => {
    const [row] = await db
      .select({ ntfy: userSettings.ntfy, email: users.email, locale: users.locale })
      .from(users)
      .leftJoin(userSettings, eq(userSettings.userId, users.id))
      .where(eq(users.id, c.var.user.id))
      .limit(1);
    if (!row) return c.json({ error: 'not_found' }, 404);
    const locale = LOCALES.find((code) => code === row.locale) ?? 'en';
    return c.json({
      result: await reminders.test(row.email, row.ntfy ?? null, locale),
      smtp: reminders.hasMail,
    });
  });

  api.post('/settings/ical', async (c) => {
    const token = randomToken(24);
    await db
      .insert(userSettings)
      .values({ userId: c.var.user.id, icalTokenHash: sha256(token) })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { icalTokenHash: sha256(token), updatedAt: new Date() },
      });
    return c.json({ path: `/api/ical/${token}.ics` });
  });

  api.delete('/settings/ical', async (c) => {
    await db.update(userSettings).set({ icalTokenHash: null }).where(eq(userSettings.userId, c.var.user.id));
    return c.body(null, 204);
  });

  const feed = new Hono<AppEnv>();
  feed.get('/:file', async (c) => {
    const match = /^([A-Za-z0-9_-]{20,64})\.ics$/.exec(c.req.param('file'));
    if (!match?.[1]) return c.text('Not found', 404);
    const [row] = await db
      .select({ userId: userSettings.userId, locale: users.locale })
      .from(userSettings)
      .innerJoin(users, eq(users.id, userSettings.userId))
      .where(eq(userSettings.icalTokenHash, sha256(match[1])))
      .limit(1);
    if (!row) return c.text('Not found', 404);
    const today = await instanceToday(db);
    const items = await planning.calendar(row.userId, addDays(today, -90), addDays(today, 400), today);
    return c.body(
      renderIcal(
        items.filter((item) => !item.hidden),
        new Date(),
        LOCALES.find((locale) => locale === row.locale) ?? 'en',
      ),
      200,
      {
        'Content-Type': 'text/calendar; charset=utf-8',
      },
    );
  });

  return { api, feed };
}

/**
 * Shifts a YYYY-MM month by a number of months
 *
 * @param month {string} - YYYY-MM
 * @param delta {number} - months to add, may be negative
 * @returns {string} - resulting YYYY-MM
 */
function shiftMonth(month: string, delta: number): string {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}
