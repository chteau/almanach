import { LOCALES } from '@almanach/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import { auditLog } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import { RateLimiter, rateLimit } from '../../security/rate-limit.ts';
import type { Mailer } from './mailer.ts';
import { mailSettingsSchema } from './providers.ts';

const outlookStartSchema = mailSettingsSchema.pick({ username: true, from: true });

/**
 * This function builds /api/settings/mail: anyone signed in reads the instance's e-mail settings, administrators
 * change, test and connect them. Mount behind requireUser.
 *
 * @param db {Database} - Drizzle database, for the audit log
 * @param mailer {Mailer} - shared mail service
 * @returns {Hono<AppEnv>} - the router
 */
export function mailRoutes(db: Database, mailer: Mailer): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const byUser = (limiter: RateLimiter) => rateLimit(limiter, (c) => c.var.user.id);
  const testLimit = byUser(new RateLimiter(10, 10 * 60_000));
  const startLimit = byUser(new RateLimiter(10, 10 * 60_000));
  const pollLimit = byUser(new RateLimiter(60, 60_000));
  const admin: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.var.user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    await next();
  };

  router.get('/', async (c) => c.json(await mailer.status()));

  router.put('/', admin, async (c) => {
    const { data, response } = await parseBody(c, mailSettingsSchema);
    if (response) return response;
    const refused = await mailer.save(data, c.var.user.id);
    if (refused && 'field' in refused) {
      return c.json(
        { error: 'validation_failed', issues: [{ path: refused.field, message: refused.message }] },
        422,
      );
    }
    if (refused) return c.json(refused, refused.error === 'secrets_key_missing' ? 409 : 422);
    await db.insert(auditLog).values({
      userId: c.var.user.id,
      action: 'mail.updated',
      meta: { provider: data.provider, host: data.host, port: data.port },
    });
    return c.json(await mailer.status());
  });

  router.delete('/', admin, async (c) => {
    await mailer.remove();
    await db.insert(auditLog).values({ userId: c.var.user.id, action: 'mail.deleted' });
    return c.json({ ok: true });
  });

  router.post('/test', admin, testLimit, async (c) => {
    const { response } = await parseBody(c, z.strictObject({}));
    if (response) return response;
    const user = c.var.user;
    const locale = LOCALES.find((code) => code === user.locale) ?? 'en';
    const result = await mailer.test(user.email, locale);
    if ('ok' in result) return c.json(result);
    const status = { not_configured: 409, secrets_key_missing: 409 } as Record<string, 409>;
    return c.json(result, status[result.error] ?? 502);
  });

  router.post('/outlook/start', admin, startLimit, async (c) => {
    const { data, response } = await parseBody(c, outlookStartSchema);
    if (response) return response;
    const result = await mailer.outlookStart(c.var.user.id, data);
    if (!('error' in result)) return c.json(result);
    return c.json(result, result.error === 'oauth_failed' ? 502 : 409);
  });

  router.post('/outlook/poll', admin, pollLimit, async (c) => {
    const result = await mailer.outlookPoll(c.var.user.id);
    if (!('error' in result)) {
      if (result.status === 'connected') {
        await db.insert(auditLog).values({ userId: c.var.user.id, action: 'mail.outlook_connected' });
      }
      return c.json(result);
    }
    return c.json(result, result.error === 'oauth_failed' ? 502 : 409);
  });

  return router;
}
