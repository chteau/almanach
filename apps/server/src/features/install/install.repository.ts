import { sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { auditLog, instance, sessions, users } from '../../db/schema.ts';
import type { CompleteInstallData, InstallRepository } from './install.service.ts';

/** Drizzle implementation of the installer's persistence. */
export class DrizzleInstallRepository implements InstallRepository {
  /**
   * Creates the repository
   *
   * @param db {Database} - Drizzle database
   */
  constructor(private readonly db: Database) {}

  /**
   * Tells whether the instance row exists
   *
   * @returns {Promise<boolean>} - true once installed
   */
  async isInstalled(): Promise<boolean> {
    const rows = await this.db.select({ id: instance.id }).from(instance).limit(1);
    return rows.length > 0;
  }

  /**
   * Checks that the database answers
   *
   * @returns {Promise<boolean>} - true when a trivial query succeeds
   */
  async ping(): Promise<boolean> {
    try {
      await this.db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks that Drizzle's migration journal holds at least one entry
   *
   * @returns {Promise<boolean>} - true when migrations have run
   */
  async migrationsApplied(): Promise<boolean> {
    try {
      const rows = await this.db.execute(sql`select 1 from drizzle.__drizzle_migrations limit 1`);
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Inserts the instance, the administrator, their session and an audit entry atomically;
   * the singleton constraint makes a concurrent second installation impossible
   *
   * @param data {CompleteInstallData} - values to persist
   * @returns {Promise<{ userId: string } | null>} - the administrator id, or null if already installed
   */
  complete(data: CompleteInstallData): Promise<{ userId: string } | null> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(instance)
        .values({ id: 1, ...data.instance, defaultLocale: data.locale })
        .onConflictDoNothing()
        .returning({ id: instance.id });
      if (inserted.length === 0) return null;

      const [user] = await tx
        .insert(users)
        .values({
          email: data.admin.email,
          passwordHash: data.admin.passwordHash,
          role: 'admin',
          locale: data.locale,
        })
        .returning({ id: users.id });
      if (!user) throw new Error('Administrator insert returned no row');

      await tx.insert(sessions).values({
        tokenHash: data.session.tokenHash,
        userId: user.id,
        expiresAt: data.session.expiresAt,
        ip: data.ip,
        userAgent: data.userAgent?.slice(0, 512) ?? null,
      });
      await tx.insert(auditLog).values({ userId: user.id, action: 'instance.installed', ip: data.ip });
      return { userId: user.id };
    });
  }
}
