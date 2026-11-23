import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { Config } from './config.ts';
import type { Database } from './db/client.ts';
import { accountRoutes } from './features/auth/account.routes.ts';
import { authRoutes } from './features/auth/auth.routes.ts';
import { requireUser, type SessionStore } from './features/auth/sessions.ts';
import { billingRoutes } from './features/billing/billing.ts';
import { clientRoutes } from './features/clients/clients.routes.ts';
import { companyRoutes, requireCompany } from './features/companies/companies.ts';
import { documentRoutes } from './features/documents/documents.routes.ts';
import type { DocumentService } from './features/documents/documents.service.ts';
import {
  type Federation,
  federationRoutes,
  federationSettingsRoutes,
} from './features/federation/federation.ts';
import { installRoutes } from './features/install/install.routes.ts';
import type { InstallService } from './features/install/install.service.ts';
import { missionRoutes } from './features/missions/missions.routes.ts';
import type { PackRegistry } from './features/packs/packs.ts';
import { packAdminRoutes } from './features/packs/updates.routes.ts';
import type { PackUpdates } from './features/packs/updates.ts';
import { planningRoutes } from './features/planning/planning.routes.ts';
import type { PlanningService } from './features/planning/planning.service.ts';
import type { ReminderJob } from './features/planning/reminders.ts';
import { profileRoutes } from './features/profile/profile.routes.ts';
import { readOnlyAfterCessation, situationRoutes } from './features/profile/situation.routes.ts';
import { searchRoutes } from './features/search/search.routes.ts';
import { type StripeSync, stripeRoutes } from './features/stripe/stripe.ts';
import { type ReleaseCheck, systemRoutes } from './features/system/system.ts';
import { timeRoutes } from './features/time/time.routes.ts';
import type { AppEnv } from './http/request.ts';
import { sameOrigin } from './http/same-origin.ts';
import { serveWebApp } from './http/static.ts';
import { randomToken } from './security/tokens.ts';

/** Services the HTTP layer depends on. */
export interface AppDeps {
  config: Pick<
    Config,
    'cookieSecure' | 'trustProxy' | 'webDist' | 'secretsKey' | 'stripeSync' | 'federation'
  >;
  install: InstallService;
  db: Database;
  sessions: SessionStore;
  packs: PackRegistry;
  documents: DocumentService;
  planning: PlanningService;
  reminders: ReminderJob;
  packUpdates: PackUpdates;
  releases: ReleaseCheck;
  stripe: StripeSync;
  federation: Federation;
}

/**
 * Assembles the HTTP application: security headers, CSRF and size limits on the API, feature routers
 * and the built web app
 *
 * @param deps {AppDeps} - configuration and services
 * @returns {Hono<AppEnv>} - the application, ready for Bun.serve
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      strictTransportSecurity: deps.config.cookieSecure ? 'max-age=63072000; includeSubDomains' : false,
      referrerPolicy: 'same-origin',
      permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
    }),
  );

  // Signed pack bundles, data imports and logos are the only large bodies the API accepts.
  const largePaths = new Set([
    '/api/admin/packs/import',
    '/api/account/import',
    '/api/billing/logo',
    '/api/clients/import',
  ]);
  const tooLarge = bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: 'payload_too_large' }, 413),
  });
  const largeBody = bodyLimit({
    maxSize: 8 * 1024 * 1024,
    onError: (c) => c.json({ error: 'payload_too_large' }, 413),
  });
  app.use('/api/*', (c, next) => (largePaths.has(c.req.path) ? largeBody(c, next) : tooLarge(c, next)));
  app.use('/api/*', sameOrigin(deps.config.trustProxy));
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/install', installRoutes(deps.install, deps.config));
  app.route('/api/auth', authRoutes(deps.db, deps.sessions, deps.config));
  app.route('/api/federation', federationRoutes(deps.federation, deps.config.trustProxy));

  const user = requireUser(deps.sessions, deps.config.cookieSecure);
  const company = requireCompany(deps.db);
  for (const path of [
    '/api/companies',
    '/api/companies/*',
    '/api/packs',
    '/api/profile',
    '/api/onboarding',
    '/api/clients/*',
    '/api/missions/*',
    '/api/documents/*',
    '/api/payments/*',
    '/api/calendar',
    '/api/deadlines/*',
    '/api/custom-deadlines/*',
    '/api/outlook',
    '/api/dashboard',
    '/api/notifications/*',
    '/api/settings/*',
    '/api/account',
    '/api/account/*',
    '/api/time',
    '/api/time/*',
    '/api/admin/*',
    '/api/search',
    '/api/billing',
    '/api/billing/*',
    '/api/system',
    '/api/system/*',
    '/api/situation',
    '/api/situation/*',
  ]) {
    app.use(path, user, company);
  }
  const readOnly = readOnlyAfterCessation(deps.db);
  for (const path of ['/api/clients/*', '/api/missions/*', '/api/documents/*', '/api/time/*']) {
    app.use(path, readOnly);
  }
  app.route('/api/companies', companyRoutes(deps.db, deps.config.cookieSecure));
  app.route('/api/settings/stripe', stripeRoutes(deps.db, deps.stripe, deps.config.secretsKey));
  app.route(
    '/api/settings/federation',
    federationSettingsRoutes(deps.db, deps.federation, deps.config.secretsKey),
  );
  app.route('/api/account', accountRoutes(deps.db, deps.config));
  app.route('/api/time', timeRoutes(deps.db));
  app.route('/api/search', searchRoutes(deps.db));
  app.route('/api/billing', billingRoutes(deps.db));
  app.route(
    '/api/system',
    systemRoutes(deps.db, deps.releases, {
      stripeSync: deps.config.stripeSync,
      federation: deps.config.federation,
    }),
  );
  app.route('/api/situation', situationRoutes(deps.db, deps.packs));
  app.route('/api/admin/packs', packAdminRoutes(deps.packs, deps.packUpdates));
  app.route('/api', profileRoutes(deps.db, deps.packs));
  app.route('/api/clients', clientRoutes(deps.db));
  app.route('/api/missions', missionRoutes(deps.db));
  app.route('/api', documentRoutes(deps.db, deps.documents));
  const planning = planningRoutes(deps.db, deps.planning, deps.packs, deps.reminders);
  app.route('/api', planning.api);
  app.route('/api/ical', planning.feed);
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  app.on(['GET', 'HEAD'], '*', serveWebApp(deps.config.webDist));

  app.onError((error, c) => {
    const id = randomToken(6);
    console.error(`[${id}]`, error);
    return c.json({ error: 'internal', id }, 500);
  });

  return app;
}
