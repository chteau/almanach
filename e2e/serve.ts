import { SQL } from 'bun';
import { E2E_SECRETS_KEY, INSTALL_TOKEN, PACK_TEST_KEYS } from './fixtures.ts';

/**
 * Test-only launcher: recreates an empty database for one Playwright project, then starts the real
 * server against it. Never used in production.
 *
 * @returns {Promise<void>} - resolves once the server is started
 */
async function serve(): Promise<void> {
  const [database, port] = Bun.argv.slice(2);
  if (!database || !/^[a-z0-9_]+$/.test(database) || !port) {
    throw new Error('Usage: bun e2e/serve.ts <database_name> <port>');
  }
  const adminUrl = process.env.E2E_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const admin = new SQL(adminUrl);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${database}`);
  await admin.close();

  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  Object.assign(process.env, {
    DATABASE_URL: url.toString(),
    PORT: port,
    HOST: '127.0.0.1',
    COOKIE_SECURE: 'false',
    ALMANACH_INSTALL_TOKEN: INSTALL_TOKEN,
    REMINDERS: 'false',
    PACK_PUBLIC_KEYS: PACK_TEST_KEYS.publicKey,
    SECRETS_KEY: E2E_SECRETS_KEY,
  });
  await import('../apps/server/src/index.ts');
}

await serve();
