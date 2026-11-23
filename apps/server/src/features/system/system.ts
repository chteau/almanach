import { Hono } from 'hono';
import serverPackage from '../../../package.json' with { type: 'json' };
import type { Database } from '../../db/client.ts';
import { auditLog, instance } from '../../db/schema.ts';
import type { AppEnv } from '../../http/request.ts';

/** Version of this server, from its package.json. */
export const APP_VERSION: string = serverPackage.version;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compares two "x.y.z" versions
 *
 * @param a {string} - first version, optionally prefixed with "v"
 * @param b {string} - second version
 * @returns {number} - positive when a is newer, negative when older, 0 when equal
 */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.replace(/^v/, '').split('.').map(Number);
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Reads the useful part of a GitHub "latest release" answer, refusing anything unexpected
 *
 * @param body {unknown} - parsed JSON
 * @returns {{ version: string; url: string } | null} - release, or null when the answer is not usable
 */
export function parseRelease(body: unknown): { version: string; url: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { tag_name: tag, html_url: url } = body as { tag_name?: unknown; html_url?: unknown };
  if (typeof tag !== 'string' || !/^v?\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(tag)) return null;
  if (typeof url !== 'string' || !url.startsWith('https://github.com/') || url.length > 300) return null;
  return { version: tag.replace(/^v/, ''), url };
}

/** Daily look for a newer release, only when an administrator allowed it; no request otherwise (S-273). */
export class ReleaseCheck {
  private latest: { version: string; url: string } | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  /**
   * @param db {Database} - database, for the administrator's choice
   * @param url {string} - "latest release" endpoint
   */
  constructor(
    private readonly db: Database,
    private readonly url: string,
  ) {}

  /**
   * Starts the daily timer; each run first checks that the check is allowed
   *
   * @returns {void} - nothing
   */
  start(): void {
    const run = () => void this.run().catch((error) => console.warn('Release check failed:', error));
    setTimeout(run, 30_000);
    this.timer = setInterval(run, DAY_MS);
  }

  /**
   * Stops the timer
   *
   * @returns {void} - nothing
   */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Whether an administrator turned the check on
   *
   * @returns {Promise<boolean>} - stored choice
   */
  async enabled(): Promise<boolean> {
    const [row] = await this.db.select({ on: instance.versionCheck }).from(instance).limit(1);
    return row?.on ?? false;
  }

  /**
   * Turns the check on or off; turning it off forgets what was found
   *
   * @param enabled {boolean} - new state
   * @param userId {string} - administrator
   * @returns {Promise<void>} - resolves when saved
   */
  async setEnabled(enabled: boolean, userId: string): Promise<void> {
    await this.db.update(instance).set({ versionCheck: enabled });
    await this.db.insert(auditLog).values({ userId, action: 'system.version_check', meta: { enabled } });
    if (enabled) await this.run().catch(() => undefined);
    else this.latest = null;
  }

  /**
   * Fetches the latest release when allowed
   *
   * @returns {Promise<void>} - resolves when done
   */
  async run(): Promise<void> {
    if (!(await this.enabled())) return;
    const response = await fetch(this.url, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Almanach' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 500_000) throw new Error('too_large');
    const release = parseRelease(JSON.parse(text));
    // The check may have been turned off while the request was in flight.
    if (await this.enabled()) this.latest = release;
  }

  /**
   * Newer release than this server, if one was found
   *
   * @returns {{ version: string; url: string } | null} - release
   */
  newer(): { version: string; url: string } | null {
    return this.latest && compareVersions(this.latest.version, APP_VERSION) > 0 ? this.latest : null;
  }
}

/**
 * Version information and the administrator's switches, mounted behind requireUser on /api/system
 *
 * @param db {Database} - database
 * @param releases {ReleaseCheck} - release checker
 * @param preset {{ stripeSync: boolean; federation: boolean }} - permissions the server configuration grants
 * @returns {Hono<AppEnv>} - router
 */
export function systemRoutes(
  db: Database,
  releases: ReleaseCheck,
  preset: { stripeSync: boolean; federation: boolean } = { stripeSync: false, federation: false },
): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const [row] = await db
      .select({ stripeSync: instance.stripeSync, federation: instance.federation })
      .from(instance)
      .limit(1);
    return c.json({
      version: APP_VERSION,
      update: releases.newer(),
      versionCheck: await releases.enabled(),
      stripeSync: preset.stripeSync || (row?.stripeSync ?? false),
      federation: preset.federation || (row?.federation ?? false),
      preset,
    });
  });

  // Instance-wide permissions, off by default: nothing leaves the instance until an administrator allows it,
  // here or in the server configuration (STRIPE_SYNC, FEDERATION), which then cannot be undone from here.
  for (const [path, column, action] of [
    ['stripe-sync', 'stripeSync', 'system.stripe_sync'],
    ['federation', 'federation', 'system.federation'],
  ] as const) {
    router.put(`/${path}`, async (c) => {
      if (c.var.user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
      if (preset[column]) return c.json({ error: 'set_by_config' }, 409);
      const body = await c.req.json().catch(() => null);
      if (typeof body?.enabled !== 'boolean') return c.json({ error: 'validation_failed' }, 422);
      await db.update(instance).set({ [column]: body.enabled });
      await db.insert(auditLog).values({ userId: c.var.user.id, action, meta: { enabled: body.enabled } });
      return c.body(null, 204);
    });
  }

  router.put('/version-check', async (c) => {
    if (c.var.user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.enabled !== 'boolean') return c.json({ error: 'validation_failed' }, 422);
    await releases.setEnabled(body.enabled, c.var.user.id);
    return c.body(null, 204);
  });

  return router;
}
