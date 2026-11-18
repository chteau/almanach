import { passwordChangeSchema, passwordIssues, totpCodeSchema, totpDisableSchema } from '@almanach/shared';
import { and, desc, eq, gt, like, ne } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { auditLog, sessions, users } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import { type AppEnv, requestContext } from '../../http/request.ts';
import { readSessionCookie } from '../../http/session-cookie.ts';
import { sha256 } from '../../security/tokens.ts';
import { newTotpSecret, otpauthUri, recoveryCodes, verifyTotp } from '../../security/totp.ts';
import { exportData, importData } from '../export/export.ts';

interface AccountOptions {
  cookieSecure: boolean;
  trustProxy: boolean;
}

/** Sessions are identified by the first characters of their token hash, never by the token itself. */
const SESSION_ID = /^[0-9a-f]{16}$/;

/**
 * Account security routes: password, active sessions and two-factor sign-in (P20, S-260 to S-263).
 * Mounted behind requireUser.
 *
 * @param db {Database} - database
 * @param options {AccountOptions} - cookie and proxy settings
 * @returns {Hono<AppEnv>} - router mounted on /api/account
 */
export function accountRoutes(db: Database, options: AccountOptions): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * Hash of the session making the request
   *
   * @param c {Context<AppEnv>} - request context
   * @returns {string} - token hash, empty when absent
   */
  // biome-ignore lint/suspicious/noExplicitAny: any route path
  const currentHash = (c: Context<AppEnv, any>): string => {
    const token = readSessionCookie(c, options.cookieSecure);
    return token ? sha256(token) : '';
  };

  /**
   * Loads the signed-in account row
   *
   * @param id {string} - user id
   * @returns {Promise<typeof users.$inferSelect | undefined>} - row
   */
  const account = async (id: string) => (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];

  router.get('/', async (c) => {
    const user = await account(c.var.user.id);
    const current = currentHash(c);
    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, c.var.user.id), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.createdAt));
    return c.json({
      totpEnabled: Boolean(user?.totpSecret),
      recoveryCodesLeft: user?.recoveryCodes?.length ?? 0,
      sessions: rows.map((row) => ({
        id: row.tokenHash.slice(0, 16),
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        ip: row.ip,
        userAgent: row.userAgent,
        current: row.tokenHash === current,
      })),
    });
  });

  router.delete('/sessions/:id', async (c) => {
    const id = c.req.param('id');
    if (!SESSION_ID.test(id)) return c.json({ error: 'not_found' }, 404);
    const deleted = await db
      .delete(sessions)
      .where(
        and(
          eq(sessions.userId, c.var.user.id),
          like(sessions.tokenHash, `${id}%`),
          ne(sessions.tokenHash, currentHash(c)),
        ),
      )
      .returning({ tokenHash: sessions.tokenHash });
    return deleted.length > 0 ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
  });

  router.post('/sessions/revoke-others', async (c) => {
    await db
      .delete(sessions)
      .where(and(eq(sessions.userId, c.var.user.id), ne(sessions.tokenHash, currentHash(c))));
    return c.body(null, 204);
  });

  router.put('/password', async (c) => {
    const { data, response } = await parseBody(c, passwordChangeSchema);
    if (response) return response;
    const user = await account(c.var.user.id);
    if (!user || !(await Bun.password.verify(data.current, user.passwordHash))) {
      return c.json({ error: 'invalid_password' }, 403);
    }
    const issues = passwordIssues(data.next, user.email);
    if (issues.length > 0) return c.json({ error: 'weak_password', issues }, 422);
    await db
      .update(users)
      .set({ passwordHash: await Bun.password.hash(data.next, { algorithm: 'argon2id' }) })
      .where(eq(users.id, user.id));
    // Every other device must sign in again with the new password.
    await db
      .delete(sessions)
      .where(and(eq(sessions.userId, user.id), ne(sessions.tokenHash, currentHash(c))));
    await db.insert(auditLog).values({
      userId: user.id,
      action: 'password.changed',
      ip: requestContext(c, options.trustProxy).ip,
    });
    return c.body(null, 204);
  });

  router.post('/totp/setup', async (c) => {
    const user = await account(c.var.user.id);
    if (!user) return c.json({ error: 'not_found' }, 404);
    if (user.totpSecret) return c.json({ error: 'already_enabled' }, 409);
    const secret = newTotpSecret();
    await db.update(users).set({ totpPending: secret }).where(eq(users.id, user.id));
    return c.json({ secret, uri: otpauthUri(secret, user.email) });
  });

  router.post('/totp/enable', async (c) => {
    const { data, response } = await parseBody(c, totpCodeSchema);
    if (response) return response;
    const user = await account(c.var.user.id);
    if (!user?.totpPending) return c.json({ error: 'setup_required' }, 409);
    const step = verifyTotp(user.totpPending, data.code, null);
    if (step === null) return c.json({ error: 'invalid_code' }, 422);
    const codes = recoveryCodes();
    await db
      .update(users)
      .set({
        totpSecret: user.totpPending,
        totpPending: null,
        totpLastStep: step,
        recoveryCodes: codes.map(sha256),
      })
      .where(eq(users.id, user.id));
    await db
      .insert(auditLog)
      .values({ userId: user.id, action: 'totp.enabled', ip: requestContext(c, options.trustProxy).ip });
    return c.json({ recoveryCodes: codes });
  });

  router.post('/totp/disable', async (c) => {
    const { data, response } = await parseBody(c, totpDisableSchema);
    if (response) return response;
    const user = await account(c.var.user.id);
    if (!user || !(await Bun.password.verify(data.password, user.passwordHash))) {
      return c.json({ error: 'invalid_password' }, 403);
    }
    await db
      .update(users)
      .set({ totpSecret: null, totpPending: null, totpLastStep: null, recoveryCodes: null })
      .where(eq(users.id, user.id));
    await db
      .insert(auditLog)
      .values({ userId: user.id, action: 'totp.disabled', ip: requestContext(c, options.trustProxy).ip });
    return c.body(null, 204);
  });

  router.get('/export', async (c) => {
    const file = await exportData(db, c.var.user.id);
    await db.insert(auditLog).values({
      userId: c.var.user.id,
      action: 'data.exported',
      ip: requestContext(c, options.trustProxy).ip,
    });
    c.header(
      'Content-Disposition',
      `attachment; filename="almanach-export-${file.exportedAt.slice(0, 10)}.json"`,
    );
    return c.json(file);
  });

  router.post('/import', async (c) => {
    const body = await c.req.json().catch(() => null);
    const result = await importData(db, c.var.user.id, body);
    if ('error' in result) return c.json(result, result.error === 'not_empty' ? 409 : 422);
    return c.json(result);
  });

  return router;
}
