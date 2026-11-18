import { resolve } from 'node:path';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import * as schema from './schema.ts';

export type Database = ReturnType<typeof createDatabase>;

/**
 * Opens a PostgreSQL connection pool wrapped by Drizzle
 *
 * @param url {string} - PostgreSQL connection string
 * @returns {Database} - the Drizzle database
 */
export function createDatabase(url: string) {
  return drizzle({ client: new SQL(url), schema });
}

/**
 * Applies pending SQL migrations shipped in apps/server/drizzle
 *
 * @param db {Database} - database to migrate
 * @returns {Promise<void>} - resolves once every migration is applied
 */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: resolve(import.meta.dir, '../../drizzle') });
}
