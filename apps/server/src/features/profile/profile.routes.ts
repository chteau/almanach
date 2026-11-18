import { onboardingDraftSchema, type Profile, profileSchema } from '@almanach/shared';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { auditLog, onboardingDrafts, profiles, situationChanges } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import { pinNumbering } from '../billing/billing.ts';
import { normalizeIdentifier, type PackRegistry, profileIssues } from '../packs/packs.ts';
import { SITUATION_KEYS } from './situation.routes.ts';

/**
 * Builds /api/profile (current profile, onboarding draft, completion) and /api/packs data;
 * mount behind requireUser
 *
 * @param db {Database} - Drizzle database
 * @param packs {PackRegistry} - available country packs
 * @returns {Hono<AppEnv>} - the router
 */
export function profileRoutes(db: Database, packs: PackRegistry): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/packs', (c) => c.json({ packs: packs.list() }));

  router.get('/profile', async (c) => {
    const [row] = await db.select().from(profiles).where(eq(profiles.userId, c.var.user.id)).limit(1);
    if (!row) return c.json({ error: 'not_found' }, 404);
    const { userId: _userId, updatedAt: _updatedAt, ...profile } = row;
    return c.json({
      profile: profile satisfies Profile,
      pack: packs.get(row.country) ?? null,
      rulesYears: packs.publishedYears(row.country),
    });
  });

  router.get('/onboarding', async (c) => {
    const [draft] = await db
      .select({ step: onboardingDrafts.step, data: onboardingDrafts.data })
      .from(onboardingDrafts)
      .where(eq(onboardingDrafts.userId, c.var.user.id))
      .limit(1);
    return c.json({ draft: draft ?? null });
  });

  router.put('/onboarding', async (c) => {
    const { data, response } = await parseBody(c, onboardingDraftSchema);
    if (response) return response;
    const values = { userId: c.var.user.id, step: data.step, data: data.data, updatedAt: new Date() };
    await db
      .insert(onboardingDrafts)
      .values(values)
      .onConflictDoUpdate({ target: onboardingDrafts.userId, set: values });
    return c.body(null, 204);
  });

  /** Saves the profile, at the end of onboarding or later from the settings. */
  router.put('/profile', async (c) => {
    const { data, response } = await parseBody(c, profileSchema);
    if (response) return response;
    const issues = profileIssues(data, packs.get(data.country));
    if (issues.length > 0) return c.json({ error: 'validation_failed', issues }, 422);

    const identifiers = Object.fromEntries(
      Object.entries(data.identifiers)
        .map(([key, value]) => [key, normalizeIdentifier(value)] as const)
        .filter(([, value]) => value),
    );
    const values = { ...data, identifiers, userId: c.var.user.id, updatedAt: new Date() };
    const userId = c.var.user.id;
    const [stored] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    const [first] = await db
      .select({ effectiveOn: situationChanges.effectiveOn })
      .from(situationChanges)
      .where(eq(situationChanges.userId, userId))
      .orderBy(asc(situationChanges.effectiveOn))
      .limit(1);
    if (stored && first) {
      // With a history, status and country only move through a dated change, or the history would lie.
      const moved = SITUATION_KEYS.filter((key) => key !== 'identifiers').some(
        (key) => JSON.stringify(stored[key]) !== JSON.stringify(values[key]),
      );
      if (moved || data.activityStart >= first.effectiveOn) return c.json({ error: 'use_situation' }, 409);
    }
    await db.transaction(async (tx) => {
      if (stored && stored.country !== data.country) await pinNumbering(tx, userId, stored.country);
      await tx.insert(profiles).values(values).onConflictDoUpdate({ target: profiles.userId, set: values });
      await tx.delete(onboardingDrafts).where(eq(onboardingDrafts.userId, userId));
      await tx.insert(auditLog).values({ userId, action: 'profile.saved', meta: { country: data.country } });
    });
    return c.body(null, 204);
  });

  return router;
}
