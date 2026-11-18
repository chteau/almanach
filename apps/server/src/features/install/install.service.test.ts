import { beforeEach, describe, expect, test } from 'bun:test';
import type { InstallRequest } from '@almanach/shared';
import {
  type CompleteInstallData,
  type InstallRepository,
  InstallService,
  type RequestContext,
} from './install.service.ts';
import { InstallTokenStore } from './install-token.ts';

/** In-memory repository mirroring the singleton behaviour of the database. */
class MemoryRepo implements InstallRepository {
  saved: CompleteInstallData | null = null;
  up = true;

  /**
   * Tells whether an installation was saved
   *
   * @returns {Promise<boolean>} - true once complete() succeeded
   */
  async isInstalled(): Promise<boolean> {
    return this.saved !== null;
  }

  /**
   * Simulates the database health
   *
   * @returns {Promise<boolean>} - current health flag
   */
  async ping(): Promise<boolean> {
    return this.up;
  }

  /**
   * Simulates the migration journal
   *
   * @returns {Promise<boolean>} - same as the health flag
   */
  async migrationsApplied(): Promise<boolean> {
    return this.up;
  }

  /**
   * Saves the first installation only
   *
   * @param data {CompleteInstallData} - values to persist
   * @returns {Promise<{ userId: string } | null>} - fake id, or null when already installed
   */
  async complete(data: CompleteInstallData): Promise<{ userId: string } | null> {
    if (this.saved) return null;
    this.saved = data;
    return { userId: 'u1' };
  }
}

const request: RequestContext = {
  https: true,
  hostname: 'almanach.example.com',
  ip: '1.2.3.4',
  userAgent: 'test',
};
const input: InstallRequest = {
  locale: 'fr',
  admin: { email: 'lea@example.com', password: 'correct-horse-battery' },
  instance: { name: 'Almanach', publicUrl: 'https://almanach.example.com', timezone: 'Europe/Paris' },
};

describe('InstallService', () => {
  let repo: MemoryRepo;
  let tokens: InstallTokenStore;
  let service: InstallService;

  beforeEach(() => {
    repo = new MemoryRepo();
    tokens = new InstallTokenStore();
    service = new InstallService(repo, tokens, true, async (p) => `hashed:${p.length}`);
  });

  test('accepts only the issued token', () => {
    const token = tokens.issue();
    expect(token).not.toBeNull();
    expect(service.verifyToken(token ?? '')).toBe(true);
    expect(service.verifyToken('wrong')).toBe(false);
    expect(service.verifyToken(undefined)).toBe(false);
  });

  test('a preset token is never printed', () => {
    expect(tokens.issue('x'.repeat(32))).toBeNull();
    expect(service.verifyToken('x'.repeat(32))).toBe(true);
  });

  test('completes once, hashes the password and revokes the token', async () => {
    const token = tokens.issue() ?? '';
    const result = await service.complete(input, request);
    expect(result.ok).toBe(true);
    expect(repo.saved?.admin.passwordHash).toBe('hashed:21');
    expect(repo.saved?.session.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(service.verifyToken(token)).toBe(false);
    expect(await service.complete(input, request)).toEqual({ ok: false, reason: 'already_installed' });
  });

  test('checks fail on a dead database and on secure cookies over public HTTP', async () => {
    repo.up = false;
    const checks = await service.checks({ ...request, https: false });
    const byId = Object.fromEntries(checks.map((check) => [check.id, check.status]));
    expect(byId).toMatchObject({ database: 'fail', migrations: 'fail', https: 'warn', cookies: 'fail' });
  });

  test('secure cookies over HTTP are fine on localhost', async () => {
    const checks = await service.checks({ ...request, https: false, hostname: 'localhost' });
    expect(checks.find((check) => check.id === 'cookies')?.status).toBe('ok');
  });
});
