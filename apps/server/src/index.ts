import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDatabase, runMigrations } from './db/client.ts';
import { SessionStore } from './features/auth/sessions.ts';
import { DocumentService } from './features/documents/documents.service.ts';
import { ExternalSources } from './features/external/external.ts';
import { Federation } from './features/federation/federation.ts';
import { DrizzleInstallRepository } from './features/install/install.repository.ts';
import { InstallService } from './features/install/install.service.ts';
import { InstallTokenStore } from './features/install/install-token.ts';
import { PackRegistry } from './features/packs/packs.ts';
import { PackUpdates } from './features/packs/updates.ts';
import { PlanningService } from './features/planning/planning.service.ts';
import { ReminderJob } from './features/planning/reminders.ts';
import { StripeSync } from './features/stripe/stripe.ts';
import { ReleaseCheck } from './features/system/system.ts';
import { maintenanceFetch } from './http/maintenance.ts';

/**
 * Boots Almanach: validates configuration, migrates the database, prints the installation token when
 * the instance is not installed yet, then starts the HTTP server
 *
 * @returns {Promise<void>} - resolves once the server listens
 */
async function main(): Promise<void> {
  const config = loadConfig();
  // Listen at once: while migrations run, visitors see the maintenance page instead of a dead port (S-272).
  const server = Bun.serve({ port: config.port, hostname: config.host, fetch: maintenanceFetch });
  console.log(`Almanach listening on http://${server.hostname}:${server.port} (starting)`);
  const db = createDatabase(config.databaseUrl);
  await runMigrations(db);

  const tokens = new InstallTokenStore();
  const install = new InstallService(new DrizzleInstallRepository(db), tokens, config.cookieSecure);

  if (!(await install.isInstalled())) {
    const token = tokens.issue(config.presetInstallToken);
    const shown = token ?? '(preset via ALMANACH_INSTALL_TOKEN)';
    console.log(
      [
        '',
        '================================================================',
        `  Almanach installation token: ${shown}`,
        '  Open /install in your browser and paste this token.',
        '================================================================',
        '',
      ].join('\n'),
    );
  }

  const sessions = new SessionStore(db);
  await sessions.purgeExpired();
  const packs = await PackRegistry.load();
  const packUpdates = new PackUpdates(db, packs, config.packPublicKeys, config.packUpdateUrl);
  await packUpdates.restore();
  const documents = new DocumentService(db, packs);
  const planning = new PlanningService(db, packs, config.federation);
  const reminders = new ReminderJob(db, planning, config);
  const releases = new ReleaseCheck(db, config.releaseCheckUrl);
  const stripe = new StripeSync(db, config.secretsKey, fetch, config.stripeSync);
  const federation = new Federation(db, planning, config.secretsKey, fetch, config.federation, {
    documents,
    intervalMinutes: config.federationIntervalMinutes,
  });
  stripe.onChange = (companyId) => federation.touch(companyId);
  const externalSources = new ExternalSources(db, config.secretsKey, fetch, config.externalSources);
  externalSources.onChange = (companyId) => federation.touch(companyId);
  await stripe.backfillLivemode();
  const app = createApp({
    config,
    install,
    db,
    sessions,
    packs,
    documents,
    planning,
    reminders,
    packUpdates,
    releases,
    stripe,
    federation,
    externalSources,
  });
  if (config.maintenance) {
    console.log('MAINTENANCE=true: only the maintenance page is served, background jobs are off.');
    return;
  }
  packUpdates.start();
  if (config.reminders) reminders.start();
  releases.start();
  stripe.start();
  federation.start();
  externalSources.start();
  server.reload({ fetch: app.fetch });
  console.log('Almanach is ready.');
}

await main();
