import { passwordIssues } from '@almanach/shared';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/client.ts';
import { auditLog, sessions, users } from '../db/schema.ts';

/**
 * Resets a password from the server shell when no e-mail is configured (S-016):
 * `docker compose exec almanach bun apps/server/src/cli/reset-password.ts you@example.com`
 * The new password is read from standard input so it never appears in the shell history.
 *
 * @returns {Promise<void>} - resolves once the password is changed and sessions are closed
 */
async function main(): Promise<void> {
  const email = Bun.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Usage: bun apps/server/src/cli/reset-password.ts <email>');

  process.stdout.write('New password (12+ characters), then Enter: ');
  const password = (await new Response(Bun.stdin.stream()).text()).split('\n')[0] ?? '';
  const issues = passwordIssues(password, email);
  if (issues.length > 0) throw new Error(`Password rejected: ${issues.join(', ')}`);

  const db = createDatabase(loadConfig().databaseUrl);
  const hash = await Bun.password.hash(password, { algorithm: 'argon2id' });
  const [user] = await db
    .update(users)
    .set({ passwordHash: hash })
    .where(eq(users.email, email))
    .returning({ id: users.id });
  if (!user) throw new Error(`No account uses ${email}`);
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await db.insert(auditLog).values({ userId: user.id, action: 'password.reset_cli' });
  console.log('\nPassword changed. Every open session was signed out.');
  process.exit(0);
}

await main();
