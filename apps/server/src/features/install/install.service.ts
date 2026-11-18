import type { InstallCheck, InstallRequest } from '@almanach/shared';
import { randomToken, sha256 } from '../../security/tokens.ts';
import type { InstallTokenStore } from './install-token.ts';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Data persisted atomically when installation completes. */
export interface CompleteInstallData {
  locale: string;
  instance: { name: string; publicUrl: string; timezone: string };
  admin: { email: string; passwordHash: string };
  session: { tokenHash: string; expiresAt: Date };
  ip: string | null;
  userAgent: string | null;
}

/** Persistence needed by the installer, implemented with Drizzle in production and in memory in tests. */
export interface InstallRepository {
  isInstalled(): Promise<boolean>;
  ping(): Promise<boolean>;
  migrationsApplied(): Promise<boolean>;
  complete(data: CompleteInstallData): Promise<{ userId: string } | null>;
}

/** Request facts the checks depend on, read by the HTTP layer. */
export interface RequestContext {
  https: boolean;
  hostname: string;
  ip: string | null;
  userAgent: string | null;
}

export type CompleteResult = { ok: true; sessionToken: string } | { ok: false; reason: 'already_installed' };

/** Orchestrates the first-run installation: status, environment checks and atomic completion. */
export class InstallService {
  /**
   * Creates the service
   *
   * @param repo {InstallRepository} - persistence
   * @param tokens {InstallTokenStore} - one-time installation token
   * @param cookieSecure {boolean} - whether session cookies require HTTPS
   * @param hashPassword {(password: string) => Promise<string>} - password hasher, argon2id by default
   */
  constructor(
    private readonly repo: InstallRepository,
    private readonly tokens: InstallTokenStore,
    private readonly cookieSecure: boolean,
    private readonly hashPassword: (password: string) => Promise<string> = (password) =>
      Bun.password.hash(password, { algorithm: 'argon2id' }),
  ) {}

  /**
   * Tells whether the instance is already installed
   *
   * @returns {Promise<boolean>} - true once installation has completed
   */
  isInstalled(): Promise<boolean> {
    return this.repo.isInstalled();
  }

  /**
   * Verifies the installation token sent by the client
   *
   * @param candidate {string | undefined} - token to verify
   * @returns {boolean} - true when it matches the active token
   */
  verifyToken(candidate: string | undefined): boolean {
    return this.tokens.verify(candidate);
  }

  /**
   * Runs the environment checks shown before the administrator account is created
   *
   * @param request {RequestContext} - facts about the current request
   * @returns {Promise<InstallCheck[]>} - one entry per check, failures block installation
   */
  async checks(request: RequestContext): Promise<InstallCheck[]> {
    const local = isLocalHost(request.hostname);
    const database = await this.repo.ping();
    const migrations = database && (await this.repo.migrationsApplied());
    const cookies: InstallCheck['status'] =
      this.cookieSecure && !request.https && !local
        ? 'fail'
        : !this.cookieSecure && request.https
          ? 'warn'
          : 'ok';
    return [
      { id: 'database', status: database ? 'ok' : 'fail' },
      { id: 'migrations', status: migrations ? 'ok' : 'fail' },
      { id: 'https', status: request.https ? 'ok' : 'warn' },
      { id: 'cookies', status: cookies },
      { id: 'timezone', status: 'ok', detail: Intl.DateTimeFormat().resolvedOptions().timeZone },
    ];
  }

  /**
   * Creates the instance, the administrator and their first session in one transaction
   *
   * @param input {InstallRequest} - validated installation form
   * @param request {RequestContext} - facts about the current request, kept for the audit log
   * @returns {Promise<CompleteResult>} - the session token to set as cookie, or why it failed
   */
  async complete(input: InstallRequest, request: RequestContext): Promise<CompleteResult> {
    const sessionToken = randomToken();
    const created = await this.repo.complete({
      locale: input.locale,
      instance: input.instance,
      admin: { email: input.admin.email, passwordHash: await this.hashPassword(input.admin.password) },
      session: { tokenHash: sha256(sessionToken), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      ip: request.ip,
      userAgent: request.userAgent,
    });
    if (!created) return { ok: false, reason: 'already_installed' };
    this.tokens.revoke();
    return { ok: true, sessionToken };
  }
}

/**
 * Tells whether a hostname points at the local machine, where browsers allow secure cookies over HTTP
 *
 * @param hostname {string} - request hostname without port
 * @returns {boolean} - true for localhost and loopback addresses
 */
export function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}
