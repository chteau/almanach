import { and, eq, gt, lt } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { Database } from '../../db/client.ts';
import { sessions, users } from '../../db/schema.ts';
import type { AppEnv, SessionUser } from '../../http/request.ts';
import { readSessionCookie } from '../../http/session-cookie.ts';
import { randomToken, sha256 } from '../../security/tokens.ts';
import { type RequestContext, SESSION_TTL_MS } from '../install/install.service.ts';

/** Server-side session store; only token hashes reach the database. */
export class SessionStore {
  /**
   * Creates the store
   *
   * @param db {Database} - Drizzle database
   */
  constructor(private readonly db: Database) {}

  /**
   * Opens a session for a user
   *
   * @param userId {string} - user id
   * @param request {RequestContext} - client IP and user agent kept for the security page
   * @returns {Promise<string>} - raw token to place in the cookie
   */
  async create(userId: string, request: Pick<RequestContext, 'ip' | 'userAgent'>): Promise<string> {
    const token = randomToken();
    await this.db.insert(sessions).values({
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: request.ip,
      userAgent: request.userAgent?.slice(0, 300) ?? null,
    });
    return token;
  }

  /**
   * Resolves a raw token to its user, ignoring expired sessions
   *
   * @param token {string | undefined} - raw cookie token
   * @returns {Promise<SessionUser | null>} - the user, or null when the session is unknown or expired
   */
  async user(token: string | undefined): Promise<SessionUser | null> {
    if (!token || token.length > 128) return null;
    const [row] = await this.db
      .select({ id: users.id, email: users.email, role: users.role, locale: users.locale })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return row ?? null;
  }

  /**
   * Ends one session
   *
   * @param token {string | undefined} - raw cookie token
   * @returns {Promise<void>} - resolves once deleted
   */
  async destroy(token: string | undefined): Promise<void> {
    if (token) await this.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  }

  /**
   * Ends every session of a user, e.g. after a password reset
   *
   * @param userId {string} - user id
   * @returns {Promise<void>} - resolves once deleted
   */
  async destroyAll(userId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }

  /**
   * Removes expired sessions
   *
   * @returns {Promise<void>} - resolves once purged
   */
  async purgeExpired(): Promise<void> {
    await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  }
}

/**
 * Middleware that rejects requests without a valid session (401) and exposes the user as c.var.user
 *
 * @param store {SessionStore} - session store
 * @param cookieSecure {boolean} - whether the cookie carries the __Host- prefix
 * @returns {MiddlewareHandler<AppEnv>} - the middleware
 */
export function requireUser(store: SessionStore, cookieSecure: boolean): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await store.user(readSessionCookie(c, cookieSecure));
    if (!user) return c.json({ error: 'unauthenticated' }, 401);
    c.set('user', user);
    await next();
  };
}
