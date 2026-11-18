import { installRequestSchema } from '@almanach/shared';
import { Hono } from 'hono';
import { validationError } from '../../http/errors.ts';
import { type AppEnv, requestContext } from '../../http/request.ts';
import { setSessionCookie } from '../../http/session-cookie.ts';
import { RateLimiter, rateLimit } from '../../security/rate-limit.ts';
import type { InstallService } from './install.service.ts';

/**
 * Builds the /api/install routes: a public status endpoint, then token-protected steps
 * that disappear (410) once the instance is installed
 *
 * @param service {InstallService} - installer logic
 * @param options {{ cookieSecure: boolean; trustProxy: boolean }} - cookie and proxy settings
 * @returns {Hono<AppEnv>} - the router to mount
 */
export function installRoutes(
  service: InstallService,
  options: { cookieSecure: boolean; trustProxy: boolean },
): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const limiter = new RateLimiter(20, 60_000);

  router.get('/status', async (c) => c.json({ installed: await service.isInstalled() }));

  router.use(
    '*',
    rateLimit(limiter, (c) => requestContext(c, options.trustProxy).ip ?? 'unknown'),
  );
  router.use('*', async (c, next) => {
    if (await service.isInstalled()) return c.json({ error: 'already_installed' }, 410);
    if (!service.verifyToken(c.req.header('x-install-token'))) return c.json({ error: 'invalid_token' }, 401);
    await next();
  });

  router.post('/token', (c) => c.body(null, 204));

  router.get('/checks', async (c) =>
    c.json({ checks: await service.checks(requestContext(c, options.trustProxy)) }),
  );

  router.post('/complete', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = installRequestSchema.safeParse(body);
    if (!parsed.success) return validationError(c, parsed.error);

    const context = requestContext(c, options.trustProxy);
    const blocking = (await service.checks(context)).filter((check) => check.status === 'fail');
    if (blocking.length > 0) return c.json({ error: 'checks_failed', checks: blocking }, 409);

    const result = await service.complete(parsed.data, context);
    if (!result.ok) return c.json({ error: result.reason }, 409);
    setSessionCookie(c, result.sessionToken, options.cookieSecure);
    return c.json({ redirect: '/onboarding' }, 201);
  });

  return router;
}
