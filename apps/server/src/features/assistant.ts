import type { Hono } from 'hono';
import type { AppDeps } from '../app.ts';
import type { AppEnv } from '../http/request.ts';
import { expenseRoutes } from './expenses/expenses.routes.ts';
import { ReserveService, reserveRoutes } from './planning/reserve.ts';
import { ReviewService, reviewRoutes } from './review/review.ts';

/**
 * Mounts the routes of the administrative assistant (reserve, weekly review…) on the web API or on the internal
 * API the MCP tools call
 *
 * @param app {Hono<AppEnv>} - application, already behind requireUser and requireCompany for these paths
 * @param deps {AppDeps} - services
 * @returns {{ reserve: ReserveService }} - services other routers use
 */
export function mountAssistant(app: Hono<AppEnv>, deps: AppDeps): { reserve: ReserveService } {
  const reserve = new ReserveService(deps.db, deps.planning, deps.packs);
  app.route('/api/reserve', reserveRoutes(deps.db, reserve));
  // Until the vault exists, an expense cannot point to a receipt.
  app.route(
    '/api/expenses',
    expenseRoutes(deps.db, deps.planning, deps.packs, async (_companyId, itemId) => itemId === null),
  );
  app.route('/api/review', reviewRoutes(deps.db, new ReviewService(deps.db, deps.planning, reserve)));
  return { reserve };
}
