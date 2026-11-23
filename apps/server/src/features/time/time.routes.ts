import {
  addDays,
  idSchema,
  isoDateSchema,
  TIMER_WARNING_MINUTES,
  timeEntrySchema,
  timerStartSchema,
  timerStopSchema,
} from '@almanach/shared';
import { and, asc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { clients, missions, timeEntries } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import { instanceToday } from '../planning/planning.routes.ts';

/**
 * Time tracking routes (P11, S-130 to S-135). Entries linked to an invoice are read-only.
 * Mounted behind requireUser on /api/time.
 *
 * @param db {Database} - database
 * @returns {Hono<AppEnv>} - router
 */
export function timeRoutes(db: Database): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * Checks that a mission belongs to the person
   *
   * @param companyId {string} - owner
   * @param missionId {string} - mission
   * @returns {Promise<boolean>} - true when owned
   */
  const ownsMission = async (companyId: string, missionId: string): Promise<boolean> =>
    (
      await db
        .select({ id: missions.id })
        .from(missions)
        .where(and(eq(missions.id, missionId), eq(missions.companyId, companyId)))
        .limit(1)
    ).length > 0;

  /**
   * Loads one entry of the person
   *
   * @param companyId {string} - owner
   * @param id {string} - entry id
   * @returns {Promise<typeof timeEntries.$inferSelect | undefined>} - entry
   */
  const owned = async (companyId: string, id: string) => {
    if (!idSchema.safeParse(id).success) return undefined;
    const [row] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)))
      .limit(1);
    return row;
  };

  router.get('/', async (c) => {
    const today = await instanceToday(db);
    const from = c.req.query('from') ?? today;
    const to = c.req.query('to') ?? from;
    const unbilled = c.req.query('unbilled') === '1';
    if (
      !isoDateSchema.safeParse(from).success ||
      !isoDateSchema.safeParse(to).success ||
      to < from ||
      addDays(from, 370) < to
    ) {
      return c.json({ error: 'invalid_range' }, 422);
    }
    const rows = await db
      .select({
        id: timeEntries.id,
        missionId: timeEntries.missionId,
        missionName: missions.name,
        billing: missions.billing,
        clientName: clients.name,
        date: timeEntries.date,
        minutes: timeEntries.minutes,
        billable: timeEntries.billable,
        note: timeEntries.note,
        startedAt: timeEntries.startedAt,
        documentId: timeEntries.documentId,
      })
      .from(timeEntries)
      .innerJoin(missions, eq(missions.id, timeEntries.missionId))
      .innerJoin(clients, eq(clients.id, missions.clientId))
      .where(
        and(
          eq(timeEntries.companyId, c.var.company.id),
          unbilled
            ? and(
                isNull(timeEntries.documentId),
                eq(timeEntries.billable, true),
                isNull(timeEntries.startedAt),
              )
            : and(gte(timeEntries.date, from), lte(timeEntries.date, to)),
        ),
      )
      .orderBy(asc(timeEntries.date), asc(timeEntries.createdAt));
    const [running] = await db
      .select({
        id: timeEntries.id,
        missionId: timeEntries.missionId,
        startedAt: timeEntries.startedAt,
        note: timeEntries.note,
      })
      .from(timeEntries)
      .where(and(eq(timeEntries.companyId, c.var.company.id), isNotNull(timeEntries.startedAt)))
      .limit(1);
    return c.json({
      today,
      entries: rows
        .filter((row) => row.startedAt === null)
        .map(({ startedAt: _running, ...row }) => ({ ...row, locked: row.documentId !== null })),
      timer: running
        ? {
            id: running.id,
            missionId: running.missionId,
            note: running.note,
            startedAt: running.startedAt?.toISOString(),
          }
        : null,
    });
  });

  router.post('/', async (c) => {
    const { data, response } = await parseBody(c, timeEntrySchema);
    if (response) return response;
    if (!(await ownsMission(c.var.company.id, data.missionId)))
      return c.json({ error: 'unknown_mission' }, 422);
    const [row] = await db
      .insert(timeEntries)
      .values({ ...data, companyId: c.var.company.id })
      .returning({ id: timeEntries.id });
    return c.json({ id: row?.id }, 201);
  });

  router.put('/:id', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    if (existing.documentId) return c.json({ error: 'locked' }, 409);
    const { data, response } = await parseBody(c, timeEntrySchema);
    if (response) return response;
    if (!(await ownsMission(c.var.company.id, data.missionId)))
      return c.json({ error: 'unknown_mission' }, 422);
    await db
      .update(timeEntries)
      .set(data)
      .where(and(eq(timeEntries.id, existing.id), isNull(timeEntries.documentId)));
    return c.body(null, 204);
  });

  router.delete('/:id', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    if (existing.documentId) return c.json({ error: 'locked' }, 409);
    await db.delete(timeEntries).where(and(eq(timeEntries.id, existing.id), isNull(timeEntries.documentId)));
    return c.body(null, 204);
  });

  router.post('/timer/start', async (c) => {
    const { data, response } = await parseBody(c, timerStartSchema);
    if (response) return response;
    if (!(await ownsMission(c.var.company.id, data.missionId)))
      return c.json({ error: 'unknown_mission' }, 422);
    const inserted = await db
      .insert(timeEntries)
      .values({
        ...data,
        companyId: c.var.company.id,
        date: await instanceToday(db),
        minutes: 0,
        startedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: timeEntries.id });
    return inserted.length > 0
      ? c.json({ id: inserted[0]?.id }, 201)
      : c.json({ error: 'timer_running' }, 409);
  });

  router.post('/timer/stop', async (c) => {
    const { data, response } = await parseBody(c, timerStopSchema);
    if (response) return response;
    const [running] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.companyId, c.var.company.id), isNotNull(timeEntries.startedAt)))
      .limit(1);
    if (!running?.startedAt) return c.json({ error: 'no_timer' }, 409);
    const elapsed = Math.max(1, Math.round((Date.now() - running.startedAt.getTime()) / 60_000));
    // A timer left running overnight is almost always a mistake: ask for the real duration (S-135).
    if (elapsed > TIMER_WARNING_MINUTES && data.minutes === undefined) {
      return c.json({ error: 'too_long', elapsedMinutes: elapsed }, 409);
    }
    const minutes = data.minutes ?? Math.min(elapsed, 1440);
    await db
      .update(timeEntries)
      .set({ minutes, startedAt: null })
      .where(and(eq(timeEntries.id, running.id), isNotNull(timeEntries.startedAt)));
    return c.json({ id: running.id, minutes });
  });

  return router;
}
