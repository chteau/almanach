import type { MiddlewareHandler } from 'hono';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Rejects state-changing requests sent from another site, whatever their content type: the Origin
 * header (or Sec-Fetch-Site when Origin is absent) must designate this very host
 *
 * @param trustProxy {boolean} - whether X-Forwarded-Host reflects the public host
 * @returns {MiddlewareHandler} - the middleware, answering 403 on cross-site writes
 */
export function sameOrigin(trustProxy: boolean): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const host =
      (trustProxy && c.req.header('x-forwarded-host')?.split(',')[0]?.trim()) || c.req.header('host');
    const origin = c.req.header('origin');
    if (origin) {
      let originHost: string | undefined;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = undefined;
      }
      if (!host || originHost !== host) return c.json({ error: 'cross_origin' }, 403);
    } else if (c.req.header('sec-fetch-site') === 'cross-site') {
      return c.json({ error: 'cross_origin' }, 403);
    }
    await next();
  };
}
