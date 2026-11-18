import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SESSION_TTL_MS } from '../features/install/install.service.ts';

export const SESSION_COOKIE = 'almanach_session';

/**
 * Sets the session cookie: HttpOnly, SameSite=Lax and, over HTTPS, the __Host- prefix that pins it
 * to this exact origin
 *
 * @param c {Context} - Hono context
 * @param token {string} - raw session token (only its hash is stored server-side)
 * @param secure {boolean} - whether the cookie requires HTTPS
 * @returns {void} - nothing
 */
export function setSessionCookie(c: Context, token: string, secure: boolean): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    ...(secure ? { prefix: 'host' as const } : {}),
  });
}

/**
 * Reads the raw session token from the request, whichever cookie name the deployment uses
 *
 * @param c {Context} - Hono context
 * @param secure {boolean} - whether the cookie carries the __Host- prefix
 * @returns {string | undefined} - the token, if present
 */
export function readSessionCookie(c: Context, secure: boolean): string | undefined {
  return secure ? getCookie(c, SESSION_COOKIE, 'host') : getCookie(c, SESSION_COOKIE);
}

/**
 * Removes the session cookie from the browser
 *
 * @param c {Context} - Hono context
 * @param secure {boolean} - whether the cookie carries the __Host- prefix
 * @returns {void} - nothing
 */
export function clearSessionCookie(c: Context, secure: boolean): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure, ...(secure ? { prefix: 'host' as const } : {}) });
}
