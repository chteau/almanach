import { addDays, cessationSchema, type Situation, situationChangeSchema } from '@almanach/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { auditLog, profiles, situationChanges } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import { pinNumbering } from '../billing/billing.ts';
import { normalizeIdentifier, type PackRegistry, profileIssues } from '../packs/packs.ts';
import { instanceToday } from '../planning/planning.routes.ts';

/** Profile fields that make up a situation; nothing else is ever written back from history. */
export const SITUATION_KEYS = [
  'country',
  'status',
  'declarationPeriod',
  'options',
  'identifiers',
  'currency',
] as const;

/**
 * Situation part of a profile row
 *
 * @param row {typeof profiles.$inferSelect} - profile
 * @returns {Situation} - status, country and related facts
 */
function situationOf(row: typeof profiles.$inferSelect): Situation {
  return {
    country: row.country,
    status: row.status,
    declarationPeriod: row.declarationPeriod,
    options: row.options,
    identifiers: row.identifiers,
    currency: row.currency,
  };
}

/**
 * Write paths that stay open after a cessation: money still owed can be recorded.
 *
 * @param path {string} - request path
 * @returns {boolean} - true when allowed
 */
function allowedAfterCessation(path: string): boolean {
  return /^\/api\/(documents\/[^/]+\/payments|payments)(\/|$)/.test(path);
}

/**
 * Makes clients, missions, documents and time read-only once the activity has ended (S-233)
 *
 * @param db {Database} - database
 * @returns {MiddlewareHandler<AppEnv>} - middleware, to mount after requireUser
 */
export function readOnlyAfterCessation(db: Database): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD' || allowedAfterCessation(c.req.path)) return next();
    const [row] = await db
      .select({ ceasedOn: profiles.ceasedOn })
      .from(profiles)
      .where(eq(profiles.userId, c.var.user.id))
      .limit(1);
    if (row?.ceasedOn && row.ceasedOn < (await instanceToday(db))) {
      return c.json({ error: 'ceased', ceasedOn: row.ceasedOn }, 409);
    }
    return next();
  };
}

/**
 * Status and country changes with an effective date, and cessation of activity (S-231 to S-233).
 * Mounted behind requireUser on /api/situation.
 *
 * @param db {Database} - database
 * @param packs {PackRegistry} - country packs, to validate the new situation
 * @returns {Hono<AppEnv>} - router
 */
export function situationRoutes(db: Database, packs: PackRegistry): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * Profile of the person
   *
   * @param userId {string} - owner
   * @returns {Promise<typeof profiles.$inferSelect | undefined>} - profile
   */
  const profileOf = async (userId: string) =>
    (await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1))[0];

  /**
   * Most recent change of a person
   *
   * @param userId {string} - owner
   * @returns {Promise<typeof situationChanges.$inferSelect | undefined>} - change
   */
  const latestChange = async (userId: string) =>
    (
      await db
        .select()
        .from(situationChanges)
        .where(eq(situationChanges.userId, userId))
        .orderBy(desc(situationChanges.effectiveOn))
        .limit(1)
    )[0];

  router.get('/', async (c) => {
    const profile = await profileOf(c.var.user.id);
    if (!profile) return c.json({ error: 'no_profile' }, 409);
    const changes = await db
      .select()
      .from(situationChanges)
      .where(eq(situationChanges.userId, profile.userId))
      .orderBy(desc(situationChanges.effectiveOn));
    return c.json({
      today: await instanceToday(db),
      activityStart: profile.activityStart,
      ceasedOn: profile.ceasedOn,
      current: situationOf(profile),
      changes: changes.map(({ id, effectiveOn, before, after }) => ({ id, effectiveOn, before, after })),
    });
  });

  router.post('/changes', async (c) => {
    const userId = c.var.user.id;
    const profile = await profileOf(userId);
    if (!profile) return c.json({ error: 'no_profile' }, 409);
    if (profile.ceasedOn) return c.json({ error: 'ceased' }, 409);
    const { data, response } = await parseBody(c, situationChangeSchema);
    if (response) return response;
    const { effectiveOn, ...after } = data;
    const today = await instanceToday(db);
    const latest = await latestChange(userId);
    // Changes are recorded in order and never in the future, so the current profile is always "today".
    if (
      effectiveOn <= profile.activityStart ||
      effectiveOn > today ||
      (latest && effectiveOn <= latest.effectiveOn)
    ) {
      return c.json(
        { error: 'validation_failed', issues: [{ path: 'effectiveOn', message: 'out_of_range' }] },
        422,
      );
    }
    const issues = profileIssues(after, packs.get(after.country));
    if (issues.length > 0) return c.json({ error: 'validation_failed', issues }, 422);
    const identifiers = Object.fromEntries(
      Object.entries(after.identifiers)
        .map(([key, value]) => [key, normalizeIdentifier(value)] as const)
        .filter(([, value]) => value),
    );
    const next = { ...after, identifiers };
    await db.transaction(async (tx) => {
      // The numbering series in progress keeps the prefixes of the country it started in.
      await pinNumbering(tx, userId, profile.country);
      await tx
        .insert(situationChanges)
        .values({ userId, effectiveOn, before: situationOf(profile), after: next });
      await tx
        .update(profiles)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(profiles.userId, userId));
      await tx.insert(auditLog).values({
        userId,
        action: 'situation.changed',
        meta: { effectiveOn, country: next.country, status: next.status },
      });
    });
    return c.json({ ok: true }, 201);
  });

  router.delete('/changes/latest', async (c) => {
    const userId = c.var.user.id;
    const profile = await profileOf(userId);
    const latest = await latestChange(userId);
    if (!profile || !latest) return c.json({ error: 'not_found' }, 404);
    if (profile.ceasedOn) return c.json({ error: 'ceased' }, 409);
    // Only fields still holding what the change wrote go back: later edits (a new VAT number…) stay.
    const current = situationOf(profile);
    const restored = Object.fromEntries(
      SITUATION_KEYS.filter((key) => JSON.stringify(current[key]) === JSON.stringify(latest.after[key])).map(
        (key) => [key, latest.before[key]],
      ),
    );
    await db.transaction(async (tx) => {
      await tx
        .update(profiles)
        .set({ ...restored, updatedAt: new Date() })
        .where(eq(profiles.userId, userId));
      await tx
        .delete(situationChanges)
        .where(and(eq(situationChanges.id, latest.id), eq(situationChanges.userId, userId)));
      await tx
        .insert(auditLog)
        .values({ userId, action: 'situation.undone', meta: { effectiveOn: latest.effectiveOn } });
    });
    return c.body(null, 204);
  });

  router.put('/cessation', async (c) => {
    const userId = c.var.user.id;
    const profile = await profileOf(userId);
    if (!profile) return c.json({ error: 'no_profile' }, 409);
    const { data, response } = await parseBody(c, cessationSchema);
    if (response) return response;
    const today = await instanceToday(db);
    const latest = await latestChange(userId);
    if (
      data.effectiveOn < profile.activityStart ||
      data.effectiveOn > addDays(today, 366) ||
      (latest && data.effectiveOn < latest.effectiveOn)
    ) {
      return c.json(
        { error: 'validation_failed', issues: [{ path: 'effectiveOn', message: 'out_of_range' }] },
        422,
      );
    }
    await db
      .update(profiles)
      .set({ ceasedOn: data.effectiveOn, updatedAt: new Date() })
      .where(eq(profiles.userId, userId));
    await db
      .insert(auditLog)
      .values({ userId, action: 'activity.ceased', meta: { ceasedOn: data.effectiveOn } });
    return c.body(null, 204);
  });

  router.delete('/cessation', async (c) => {
    const userId = c.var.user.id;
    await db
      .update(profiles)
      .set({ ceasedOn: null, updatedAt: new Date() })
      .where(eq(profiles.userId, userId));
    await db.insert(auditLog).values({ userId, action: 'activity.resumed', meta: {} });
    return c.body(null, 204);
  });

  return router;
}
