import { idSchema, packFeatures } from '@almanach/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../http/request.ts';
import type { PackRegistry } from './packs.ts';
import type { PackUpdates } from './updates.ts';

/**
 * Administration of country packs: list, import a signed update, roll back (P20, S-300 to S-304).
 * Mounted behind requireUser on /api/admin/packs; only administrators may use it.
 *
 * @param packs {PackRegistry} - registry
 * @param updates {PackUpdates} - update service
 * @returns {Hono<AppEnv>} - router
 */
export function packAdminRoutes(packs: PackRegistry, updates: PackUpdates): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.use('*', async (c, next) => {
    if (c.var.user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    await next();
  });

  router.get('/', async (c) => {
    const bundles = await updates.list();
    return c.json({
      enabled: updates.enabled,
      automatic: updates.automatic,
      autoCheck: await updates.autoCheck(),
      packs: packs.list().map((pack) => ({
        country: pack.country,
        name: pack.name,
        maturity: pack.maturity,
        features: packFeatures(pack),
        minAppVersion: pack.minAppVersion ?? null,
        years: packs.publishedYears(pack.country),
        activeSequence:
          bundles.find((bundle) => bundle.country === pack.country && bundle.active)?.sequence ?? null,
      })),
      bundles,
    });
  });

  router.post('/import', async (c) => {
    const body = await c.req.json().catch(() => null);
    const result = await updates.import(body, c.var.user.id);
    if ('error' in result) return c.json(result, result.error === 'not_newer' ? 409 : 422);
    return c.json(result, 201);
  });

  router.put('/auto-check', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (typeof body?.enabled !== 'boolean') return c.json({ error: 'validation_failed' }, 422);
    await updates.setAutoCheck(body.enabled, c.var.user.id);
    return c.body(null, 204);
  });

  router.post('/check', async (c) => {
    if (!updates.automatic) return c.json({ error: 'no_update_url' }, 409);
    return c.json(await updates.check().catch(() => ({ error: 'unreachable' })));
  });

  router.post('/bundles/:id/activate', async (c) => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success || !(await updates.activate(id, c.var.user.id))) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  router.post('/:country/builtin', async (c) => {
    const country = c.req.param('country');
    if (!/^[A-Z]{2}$/.test(country) || !(await updates.revert(country, c.var.user.id))) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  return router;
}
