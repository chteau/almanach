import {
  type Client,
  clientFromCsv,
  clientImportSchema,
  clientInputSchema,
  idSchema,
  LOCALES,
  type Locale,
} from '@almanach/shared';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';
import type { Database } from '../../db/client.ts';
import { auditLog, clients, externalRevenues, missions, profiles } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import { loadBilling } from '../billing/billing.ts';

/**
 * Converts a database row to the API shape
 *
 * @param row {typeof clients.$inferSelect} - client row
 * @returns {Client} - API client
 */
function toClient(row: typeof clients.$inferSelect): Client {
  const {
    companyId: _companyId,
    updatedAt: _updatedAt,
    stripeEdited: _edited,
    stripeDeletedAt,
    createdAt,
    ...rest
  } = row;
  return {
    ...rest,
    stripeDeletedAt: stripeDeletedAt?.toISOString() ?? null,
    createdAt: createdAt.toISOString(),
  };
}

/**
 * Builds /api/clients; every query is scoped to the active company. Mount behind requireUser and requireCompany.
 *
 * @param db {Database} - Drizzle database
 * @returns {Hono<AppEnv>} - the router
 */
export function clientRoutes(db: Database): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * Loads one client owned by the user
   *
   * @param companyId {string} - owner
   * @param id {string} - client id from the URL
   * @returns {Promise<typeof clients.$inferSelect | undefined>} - the row, or undefined when absent or not owned
   */
  async function owned(companyId: string, id: string) {
    if (!idSchema.safeParse(id).success) return undefined;
    const [row] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.companyId, companyId)))
      .limit(1);
    return row;
  }

  router.get('/', async (c) => {
    const rows = await db
      .select()
      .from(clients)
      .where(eq(clients.companyId, c.var.company.id))
      .orderBy(asc(sql`lower(${clients.name})`));
    return c.json({ clients: rows.map(toClient) });
  });

  router.post('/import', async (c) => {
    const { data, response } = await parseBody(c, clientImportSchema);
    if (response) return response;
    const companyId = c.var.company.id;
    const [profile] = await db.select().from(profiles).where(eq(profiles.companyId, companyId)).limit(1);
    if (!profile) return c.json({ error: 'no_profile' }, 409);
    const { defaultTermsDays } = await loadBilling(db, companyId, profile.country);
    const language = (LOCALES as readonly string[]).includes(c.var.user.locale)
      ? (c.var.user.locale as Locale)
      : 'en';
    const defaults = {
      country: profile.country,
      currency: profile.currency,
      language,
      paymentTermsDays: defaultTermsDays,
    };

    // Names and VAT numbers already known, so an import run twice does not create everything twice.
    const known = await db
      .select({ name: clients.name, vatNumber: clients.vatNumber })
      .from(clients)
      .where(eq(clients.companyId, companyId));
    const names = new Set(known.map((row) => row.name.toLowerCase()));
    const vats = new Set(known.flatMap((row) => (row.vatNumber ? [row.vatNumber] : [])));

    const accepted: z.output<typeof clientInputSchema>[] = [];
    const rejected: { line: number; name: string; issues: { field: string; message: string }[] }[] = [];
    data.rows.forEach((row, index) => {
      // Line 1 is the header row of the file.
      const line = index + 2;
      const result = clientFromCsv(row, defaults);
      if ('issues' in result) {
        rejected.push({ line, name: row.name?.trim() ?? '', issues: result.issues });
        return;
      }
      const { client } = result;
      if (names.has(client.name.toLowerCase()) || (client.vatNumber && vats.has(client.vatNumber))) {
        rejected.push({ line, name: client.name, issues: [{ field: 'name', message: 'duplicate' }] });
        return;
      }
      names.add(client.name.toLowerCase());
      if (client.vatNumber) vats.add(client.vatNumber);
      accepted.push(client);
    });

    if (!data.dryRun && accepted.length > 0) {
      await db.transaction(async (tx) => {
        for (let start = 0; start < accepted.length; start += 200) {
          const chunk = accepted.slice(start, start + 200).map(({ allowDuplicate: _allow, ...client }) => ({
            ...client,
            companyId,
          }));
          await tx.insert(clients).values(chunk);
        }
        await tx.insert(auditLog).values({
          userId: c.var.user.id,
          action: 'clients.imported',
          meta: { count: accepted.length, rejected: rejected.length },
        });
      });
    }
    return c.json({ accepted: accepted.length, rejected, imported: !data.dryRun });
  });

  router.get('/:id', async (c) => {
    const row = await owned(c.var.company.id, c.req.param('id'));
    if (!row) return c.json({ error: 'not_found' }, 404);
    const missionCount = await db.$count(missions, eq(missions.clientId, row.id));
    const receipts = await db
      .select({
        id: externalRevenues.id,
        date: externalRevenues.date,
        amountCents: externalRevenues.amountCents,
        currency: externalRevenues.currency,
        reference: externalRevenues.reference,
        livemode: externalRevenues.livemode,
      })
      .from(externalRevenues)
      .where(eq(externalRevenues.clientId, row.id))
      .orderBy(desc(externalRevenues.date))
      .limit(200);
    return c.json({ client: toClient(row), missionCount, receipts });
  });

  router.post('/', async (c) => {
    const { data, response } = await parseBody(c, clientInputSchema);
    if (response) return response;
    const { allowDuplicate, ...input } = data;
    const companyId = c.var.company.id;

    if (!allowDuplicate) {
      const matches = await db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(
          and(
            eq(clients.companyId, companyId),
            or(
              ilike(clients.name, input.name.replace(/[\\%_]/g, '\\$&')),
              input.vatNumber ? eq(clients.vatNumber, input.vatNumber) : undefined,
            ),
          ),
        )
        .limit(5);
      if (matches.length > 0) return c.json({ error: 'possible_duplicate', matches }, 409);
    }

    const [row] = await db
      .insert(clients)
      .values({ ...input, companyId })
      .returning();
    return c.json({ client: row && toClient(row) }, 201);
  });

  router.put('/:id', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    const { data, response } = await parseBody(c, clientInputSchema);
    if (response) return response;
    const { allowDuplicate: _allow, ...input } = data;
    const [row] = await db
      .update(clients)
      // A client from Stripe edited here keeps this version: the sync no longer overwrites it.
      .set({ ...input, stripeEdited: existing.stripeId !== null, updatedAt: new Date() })
      .where(eq(clients.id, existing.id))
      .returning();
    return c.json({ client: row && toClient(row) });
  });

  router.post('/:id/archive', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    const archived = c.req.query('undo') !== '1';
    await db.update(clients).set({ archived, updatedAt: new Date() }).where(eq(clients.id, existing.id));
    return c.body(null, 204);
  });

  router.delete('/:id', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    if (
      (await db.$count(missions, eq(missions.clientId, existing.id))) > 0 ||
      (await db.$count(externalRevenues, eq(externalRevenues.clientId, existing.id))) > 0
    ) {
      return c.json({ error: 'has_history' }, 409);
    }
    await db.delete(clients).where(eq(clients.id, existing.id));
    return c.body(null, 204);
  });

  return router;
}
