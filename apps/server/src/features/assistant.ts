import type { Hono } from 'hono';
import type { AppDeps } from '../app.ts';
import type { AppEnv } from '../http/request.ts';
import { expenseRoutes } from './expenses/expenses.routes.ts';
import { DealService, dealRoutes } from './pipeline/deals.ts';
import { instanceToday } from './planning/planning.routes.ts';
import { ReserveService, reserveRoutes } from './planning/reserve.ts';
import { ReviewService, reviewRoutes } from './review/review.ts';
import { VaultService, vaultRoutes } from './vault/vault.ts';

/**
 * Mounts the routes of the administrative assistant (reserve, weekly review…) on the web API or on the internal
 * API the MCP tools call
 *
 * @param app {Hono<AppEnv>} - application, already behind requireUser and requireCompany for these paths
 * @param deps {AppDeps} - services
 * @returns {{ reserve: ReserveService; deals: DealService }} - services other routers use
 */
export function mountAssistant(
  app: Hono<AppEnv>,
  deps: AppDeps,
): { reserve: ReserveService; deals: DealService } {
  const reserve = new ReserveService(deps.db, deps.planning, deps.packs);
  app.route('/api/reserve', reserveRoutes(deps.db, reserve));
  const vault = new VaultService(deps.db, deps.planning, deps.config.secretsKey, deps.config.vaultQuotaBytes);
  app.route(
    '/api/vault',
    vaultRoutes(deps.db, vault, () => instanceToday(deps.db)),
  );
  app.route(
    '/api/expenses',
    expenseRoutes(
      deps.db,
      deps.planning,
      deps.packs,
      async (companyId, itemId) =>
        itemId === null || (await vault.get(companyId, itemId, '2000-01-01')) !== null,
    ),
  );
  const deals = new DealService(deps.db);
  app.route(
    '/api/deals',
    dealRoutes(deps.db, deals, () => instanceToday(deps.db)),
  );
  const review = new ReviewService(deps.db, deps.planning, reserve, {
    deals: (companyId, today) => deals.review(companyId, today),
    vault: (companyId, today) => vault.review(companyId, today),
  });
  app.route('/api/review', reviewRoutes(deps.db, review));
  return { reserve, deals };
}
