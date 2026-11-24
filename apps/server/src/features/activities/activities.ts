import { activityInputSchema, type CompanyActivity, idSchema, packFeatures } from '@almanach/shared';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { auditLog, companyActivities, federationLinks, profiles } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import type { PackRegistry } from '../packs/packs.ts';

type Reader = Pick<Database, 'select'>;
type Writer = Pick<Database, 'select' | 'insert'>;

/**
 * Lists the activities of a company: the main one (profile status) first, then the secondary ones
 *
 * @param db {Reader} - database or transaction
 * @param companyId {string} - company
 * @param mainStatus {string | null} - profile status, null before onboarding or for a generic profile
 * @returns {Promise<CompanyActivity[]>} - activities
 */
export async function listActivities(
  db: Reader,
  companyId: string,
  mainStatus: string | null,
): Promise<CompanyActivity[]> {
  const rows = await db
    .select({
      id: companyActivities.id,
      status: companyActivities.status,
      linkId: companyActivities.linkId,
      linkLabel: federationLinks.peerLabel,
    })
    .from(companyActivities)
    .leftJoin(federationLinks, eq(federationLinks.id, companyActivities.linkId))
    .where(eq(companyActivities.companyId, companyId))
    .orderBy(asc(companyActivities.createdAt), asc(companyActivities.id));
  const main: CompanyActivity[] = mainStatus
    ? [{ id: null, status: mainStatus, main: true, linkId: null, linkLabel: null }]
    : [];
  return [
    ...main,
    ...rows.filter((row) => row.status !== mainStatus).map((row) => ({ ...row, main: false })),
  ];
}

/**
 * Tells whether an activity reference is valid for a company: null (main) or one of its secondary activities
 *
 * @param db {Reader} - database
 * @param companyId {string} - company
 * @param activityId {string | null} - reference to check
 * @returns {Promise<boolean>} - true when it can be stored
 */
export async function ownsActivity(
  db: Reader,
  companyId: string,
  activityId: string | null,
): Promise<boolean> {
  if (activityId === null) return true;
  const [row] = await db
    .select({ id: companyActivities.id })
    .from(companyActivities)
    .where(and(eq(companyActivities.id, activityId), eq(companyActivities.companyId, companyId)));
  return row !== undefined;
}

/**
 * Finds the activity of a company with a status, creating it as a secondary activity when missing
 *
 * @param db {Writer} - database or transaction
 * @param companyId {string} - company
 * @param status {string} - status of the wanted activity
 * @param linkId {string | null} - link that announced it, recorded when the activity is created
 * @returns {Promise<{ main: boolean; id: string | null; created: boolean }>} - main activity, or the secondary one
 */
export async function ensureActivity(
  db: Writer,
  companyId: string,
  status: string,
  linkId: string | null,
): Promise<{ main: boolean; id: string | null; created: boolean }> {
  const [profile] = await db
    .select({ status: profiles.status })
    .from(profiles)
    .where(eq(profiles.companyId, companyId));
  if (profile?.status === status) return { main: true, id: null, created: false };
  const inserted = await db
    .insert(companyActivities)
    .values({ companyId, status, linkId })
    .onConflictDoNothing()
    .returning({ id: companyActivities.id });
  if (inserted[0]) return { main: false, id: inserted[0].id, created: true };
  const [found] = await db
    .select({ id: companyActivities.id })
    .from(companyActivities)
    .where(and(eq(companyActivities.companyId, companyId), eq(companyActivities.status, status)));
  return { main: false, id: found?.id ?? null, created: false };
}

/**
 * Builds /api/profile/activities: list, add and remove the secondary activities of the active company.
 * Mount behind requireUser and requireCompany.
 *
 * @param db {Database} - Drizzle database
 * @param packs {PackRegistry} - country packs, whose statuses are the only activities allowed
 * @returns {Hono<AppEnv>} - the router
 */
export function activityRoutes(db: Database, packs: PackRegistry): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const [profile] = await db
      .select({ status: profiles.status, country: profiles.country })
      .from(profiles)
      .where(eq(profiles.companyId, c.var.company.id));
    return c.json({
      activities: await listActivities(db, c.var.company.id, profile?.status ?? null),
      // Statuses of the country pack: the activities that can be added, with their labels.
      statuses: (profile && packs.get(profile.country)?.statuses) ?? [],
    });
  });

  router.post('/', async (c) => {
    const { data, response } = await parseBody(c, activityInputSchema);
    if (response) return response;
    const companyId = c.var.company.id;
    const [profile] = await db.select().from(profiles).where(eq(profiles.companyId, companyId));
    if (!profile) return c.json({ error: 'no_profile' }, 409);
    const pack = packs.get(profile.country);
    // Countries whose pack cannot model several activities (e.g. the UK, one status for every trade) refuse them.
    if (pack && !packFeatures(pack).activities) return c.json({ error: 'feature_unavailable' }, 409);
    if (!pack?.statuses.some((status) => status.id === data.status))
      return c.json({ error: 'validation_failed', issues: [{ path: 'status', message: 'unknown' }] }, 422);
    if (data.status === profile.status) return c.json({ error: 'activity_exists' }, 409);
    const [row] = await db
      .insert(companyActivities)
      .values({ companyId, status: data.status })
      .onConflictDoNothing()
      .returning({ id: companyActivities.id });
    if (!row) return c.json({ error: 'activity_exists' }, 409);
    await db
      .insert(auditLog)
      .values({ userId: c.var.user.id, action: 'activity.added', meta: { company: companyId, ...data } });
    return c.json({ id: row.id }, 201);
  });

  router.delete('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    const companyId = c.var.company.id;
    if (!id.success || !(await ownsActivity(db, companyId, id.data)))
      return c.json({ error: 'not_found' }, 404);
    await db.transaction(async (tx) => {
      // A link following its announced activity would bring it back at the next exchange: it stops following.
      await tx
        .update(federationLinks)
        .set({ activityAuto: false })
        .where(eq(federationLinks.activityId, id.data));
      // Documents, payments and deadlines of this activity fall back to the main one (ON DELETE SET NULL).
      await tx.delete(companyActivities).where(eq(companyActivities.id, id.data));
      await tx.insert(auditLog).values({
        userId: c.var.user.id,
        action: 'activity.removed',
        meta: { company: companyId, id: id.data },
      });
    });
    return c.body(null, 204);
  });

  return router;
}
