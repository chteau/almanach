import { idSchema, type Mission, missionInputSchema } from '@almanach/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { clients, missions } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';

const columns = {
  id: missions.id,
  clientId: missions.clientId,
  clientName: clients.name,
  name: missions.name,
  status: missions.status,
  billing: missions.billing,
  rateCents: missions.rateCents,
  currency: missions.currency,
  startDate: missions.startDate,
  endDate: missions.endDate,
  budgetCents: missions.budgetCents,
  endClient: missions.endClient,
  notes: missions.notes,
  createdAt: missions.createdAt,
};

/**
 * Converts a selected row to the API shape
 *
 * @param row {{ createdAt: Date } & Omit<Mission, 'createdAt'>} - joined mission row
 * @returns {Mission} - API mission
 */
function toMission(row: { createdAt: Date } & Omit<Mission, 'createdAt'>): Mission {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/**
 * Builds /api/missions; every query is scoped to the active company and a mission may only point to
 * one of the user's own clients. Mount behind requireUser.
 *
 * @param db {Database} - Drizzle database
 * @returns {Hono<AppEnv>} - the router
 */
export function missionRoutes(db: Database): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * Selects the user's missions, optionally narrowed to one id
   *
   * @param companyId {string} - owner
   * @param id {string} - optional mission id
   * @returns {Promise<Mission[]>} - matching missions, most recent first
   */
  async function find(companyId: string, id?: string): Promise<Mission[]> {
    const rows = await db
      .select(columns)
      .from(missions)
      .innerJoin(clients, eq(clients.id, missions.clientId))
      .where(and(eq(missions.companyId, companyId), id ? eq(missions.id, id) : undefined))
      .orderBy(desc(missions.startDate));
    return rows.map(toMission);
  }

  /**
   * Tells whether a client belongs to the user and is not archived
   *
   * @param companyId {string} - owner
   * @param clientId {string} - client id from the body
   * @returns {Promise<boolean>} - true when the mission may use this client
   */
  async function usableClient(companyId: string, clientId: string): Promise<boolean> {
    const [row] = await db
      .select({ archived: clients.archived })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
      .limit(1);
    return row !== undefined && !row.archived;
  }

  router.get('/', async (c) => c.json({ missions: await find(c.var.company.id) }));

  router.get('/:id', async (c) => {
    const id = c.req.param('id');
    const [mission] = idSchema.safeParse(id).success ? await find(c.var.company.id, id) : [];
    return mission ? c.json({ mission }) : c.json({ error: 'not_found' }, 404);
  });

  router.post('/', async (c) => {
    const { data, response } = await parseBody(c, missionInputSchema);
    if (response) return response;
    if (!(await usableClient(c.var.company.id, data.clientId)))
      return c.json({ error: 'unknown_client' }, 422);
    const [row] = await db
      .insert(missions)
      .values({ ...data, companyId: c.var.company.id })
      .returning({ id: missions.id });
    const [mission] = row ? await find(c.var.company.id, row.id) : [];
    return c.json({ mission }, 201);
  });

  router.put('/:id', async (c) => {
    const id = c.req.param('id');
    const [existing] = idSchema.safeParse(id).success ? await find(c.var.company.id, id) : [];
    if (!existing) return c.json({ error: 'not_found' }, 404);
    const { data, response } = await parseBody(c, missionInputSchema);
    if (response) return response;
    if (data.clientId !== existing.clientId && !(await usableClient(c.var.company.id, data.clientId))) {
      return c.json({ error: 'unknown_client' }, 422);
    }
    await db
      .update(missions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(missions.id, id));
    const [mission] = await find(c.var.company.id, id);
    return c.json({ mission });
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success) return c.json({ error: 'not_found' }, 404);
    const deleted = await db
      .delete(missions)
      .where(and(eq(missions.id, id), eq(missions.companyId, c.var.company.id)))
      .returning({ id: missions.id });
    return deleted.length > 0 ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
  });

  return router;
}
