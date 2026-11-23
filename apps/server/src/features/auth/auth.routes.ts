import { loginSchema, type Me } from '@almanach/shared';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { auditLog, profiles, users } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import { type AppEnv, requestContext } from '../../http/request.ts';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '../../http/session-cookie.ts';
import { LoginThrottle } from '../../security/login-throttle.ts';
import { sha256 } from '../../security/tokens.ts';
import { verifyTotp } from '../../security/totp.ts';
import { requireCompany } from '../companies/companies.ts';
import { requireUser, type SessionStore } from './sessions.ts';

/** Hash compared against when the e-mail is unknown, so both paths cost the same time (S-011). */
const DUMMY_HASH = await Bun.password.hash('almanach-timing-equalizer', { algorithm: 'argon2id' });

/**
 * Checks an authenticator code, or consumes a recovery code; updates are conditional so two parallel
 * requests cannot both use the same code
 *
 * @param db {Database} - database
 * @param user {typeof users.$inferSelect} - account with two-factor sign-in on
 * @param code {string} - six digits or a ten-character recovery code
 * @returns {Promise<boolean>} - true when accepted
 */
async function secondFactor(db: Database, user: typeof users.$inferSelect, code: string): Promise<boolean> {
  if (/^\d{6}$/.test(code)) {
    const step = verifyTotp(user.totpSecret ?? '', code, user.totpLastStep);
    if (step === null) return false;
    const updated = await db
      .update(users)
      .set({ totpLastStep: step })
      .where(and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
      .returning({ id: users.id });
    return updated.length > 0;
  }
  const hash = sha256(code);
  const remaining = user.recoveryCodes ?? [];
  if (!remaining.includes(hash)) return false;
  const updated = await db
    .update(users)
    .set({ recoveryCodes: remaining.filter((item) => item !== hash) })
    .where(and(eq(users.id, user.id), eq(users.recoveryCodes, remaining)))
    .returning({ id: users.id });
  return updated.length > 0;
}

interface AuthOptions {
  cookieSecure: boolean;
  trustProxy: boolean;
}

/**
 * Builds /api/auth: sign-in with per-account and per-IP lockout, sign-out and the current user
 *
 * @param db {Database} - Drizzle database
 * @param store {SessionStore} - session store
 * @param options {AuthOptions} - cookie and proxy settings
 * @returns {Hono<AppEnv>} - the router
 */
export function authRoutes(db: Database, store: SessionStore, options: AuthOptions): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const throttle = new LoginThrottle();

  router.post('/login', async (c) => {
    const { data, response } = await parseBody(c, loginSchema);
    if (response) return response;
    const request = requestContext(c, options.trustProxy);
    const ip = request.ip ?? 'unknown';

    const locked = throttle.lockedFor(data.email, ip);
    if (locked > 0) {
      c.header('Retry-After', String(locked));
      return c.json({ error: 'locked', retryAfterSeconds: locked }, 429);
    }

    const [user] = await db.select().from(users).where(eq(users.email, data.email)).limit(1);
    const valid = await Bun.password.verify(data.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      throttle.fail(data.email, ip);
      await db.insert(auditLog).values({ action: 'login.failed', ip, meta: { email: data.email } });
      return c.json({ error: 'invalid_credentials' }, 401);
    }

    if (user.totpSecret) {
      // The password was right: ask for the second factor without revealing more.
      if (!data.code) return c.json({ error: 'totp_required' }, 401);
      const accepted = await secondFactor(db, user, data.code);
      if (!accepted) {
        throttle.fail(data.email, ip);
        await db.insert(auditLog).values({ userId: user.id, action: 'login.totp_failed', ip });
        return c.json({ error: 'invalid_code' }, 401);
      }
    }

    throttle.succeed(data.email);
    const token = await store.create(user.id, request);
    await db.insert(auditLog).values({ userId: user.id, action: 'login.succeeded', ip });
    setSessionCookie(c, token, options.cookieSecure);
    return c.body(null, 204);
  });

  router.post('/logout', async (c) => {
    await store.destroy(readSessionCookie(c, options.cookieSecure));
    clearSessionCookie(c, options.cookieSecure);
    return c.body(null, 204);
  });

  router.get('/me', requireUser(store, options.cookieSecure), requireCompany(db), async (c) => {
    const user = c.var.user;
    const [profile] = await db
      .select({ companyId: profiles.companyId })
      .from(profiles)
      .where(eq(profiles.companyId, c.var.company.id))
      .limit(1);
    const me: Me = { ...user, onboarded: Boolean(profile) };
    return c.json(me);
  });

  return router;
}
