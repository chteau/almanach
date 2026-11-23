import type { Context } from 'hono';
import type { RequestContext } from '../features/install/install.service.ts';

/** Bun passes its server as the Hono environment; only the client-address lookup is used. */
interface BunServerBinding {
  requestIP?: (request: Request) => { address: string } | null;
}

/** The signed-in person, attached to the context by the session middleware. */
export interface SessionUser {
  id: string;
  email: string;
  role: 'admin' | 'member';
  locale: string;
}

/** The company the request works on, checked to belong to the signed-in person. */
export interface ActiveCompany {
  id: string;
  name: string;
}

/** Hono environment shared by every router. */
export type AppEnv = { Bindings: BunServerBinding; Variables: { user: SessionUser; company: ActiveCompany } };

/**
 * Extracts the facts the server trusts about a request; forwarded headers are only honoured behind a
 * reverse proxy the administrator declared with TRUST_PROXY
 *
 * @param c {Context} - Hono context
 * @param trustProxy {boolean} - whether X-Forwarded-* headers come from a trusted proxy
 * @returns {RequestContext} - protocol, hostname, client IP and user agent
 */
export function requestContext(c: Context<AppEnv>, trustProxy: boolean): RequestContext {
  const url = new URL(c.req.url);
  const forwardedProto = trustProxy ? c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() : undefined;
  const forwardedFor = trustProxy ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
  const env = c.env as BunServerBinding | undefined;
  const ip = forwardedFor || env?.requestIP?.(c.req.raw)?.address || null;
  return {
    https: (forwardedProto ?? url.protocol.replace(':', '')) === 'https',
    hostname: url.hostname,
    ip,
    userAgent: c.req.header('user-agent') ?? null,
  };
}
