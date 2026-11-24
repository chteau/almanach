import {
  type ExpenseInput,
  type ExpenseView,
  expenseInputSchema,
  idSchema,
  packFeatures,
} from '@almanach/shared';
import { and, desc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { expenses } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import { ownsActivity } from '../activities/activities.ts';
import type { PackRegistry } from '../packs/packs.ts';
import type { PlanningService } from '../planning/planning.service.ts';

/** Checks that a vault item belongs to the company; replaced once the vault exists. */
export type VaultOwnership = (companyId: string, itemId: string | null) => Promise<boolean>;

/**
 * Builds /api/expenses: simple expenses of the active company. Mount behind requireUser and requireCompany.
 *
 * @param db {Database} - Drizzle database
 * @param planning {PlanningService} - profile of the company
 * @param packs {PackRegistry} - country packs, for the note and maturity
 * @param ownsVaultItem {VaultOwnership} - vault ownership check
 * @returns {Hono<AppEnv>} - the router
 */
export function expenseRoutes(
  db: Database,
  planning: PlanningService,
  packs: PackRegistry,
  ownsVaultItem: VaultOwnership,
): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const view = (row: typeof expenses.$inferSelect): ExpenseView => ({
    id: row.id,
    date: row.date,
    amountCents: row.amountCents,
    vatCents: row.vatCents,
    currency: row.currency,
    category: row.category as ExpenseView['category'],
    description: row.description,
    activityId: row.activityId,
    vaultItemId: row.vaultItemId,
  });

  router.get('/', async (c) => {
    const profile = await planning.profile(c.var.company.id);
    const pack = profile ? packs.get(profile.country) : undefined;
    const rows = await db
      .select()
      .from(expenses)
      .where(eq(expenses.companyId, c.var.company.id))
      .orderBy(desc(expenses.date), desc(expenses.createdAt))
      .limit(1000);
    return c.json({
      expenses: rows.map(view),
      currency: profile?.currency ?? null,
      maturity: pack ? (packFeatures(pack).expenses ?? null) : null,
      note: pack?.expensesNote ?? null,
    });
  });

  /**
   * Validates an expense and checks what it refers to
   *
   * @param c {Context<AppEnv>} - request
   * @returns {Promise<{ data?: ExpenseInput; response?: Response }>} - data or error
   */
  async function input(c: Context<AppEnv>) {
    const { data, response } = await parseBody(c, expenseInputSchema);
    if (response) return { response };
    if (!(await ownsActivity(db, c.var.company.id, data.activityId)))
      return { response: c.json({ error: 'unknown_activity' }, 422) };
    if (!(await ownsVaultItem(c.var.company.id, data.vaultItemId)))
      return { response: c.json({ error: 'unknown_vault_item' }, 422) };
    return { data };
  }

  router.post('/', async (c) => {
    const { data, response } = await input(c);
    if (!data) return response;
    const profile = await planning.profile(c.var.company.id);
    const [row] = await db
      .insert(expenses)
      .values({ ...data, companyId: c.var.company.id, currency: profile?.currency ?? 'EUR' })
      .returning();
    return c.json({ expense: row && view(row) }, 201);
  });

  router.put('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const { data, response } = await input(c);
    if (!data) return response;
    const [row] = await db
      .update(expenses)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(expenses.id, id.data), eq(expenses.companyId, c.var.company.id)))
      .returning();
    return row ? c.json({ expense: view(row) }) : c.json({ error: 'not_found' }, 404);
  });

  router.delete('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const removed = await db
      .delete(expenses)
      .where(and(eq(expenses.id, id.data), eq(expenses.companyId, c.var.company.id)))
      .returning({ id: expenses.id });
    return removed.length > 0 ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
  });

  return router;
}
