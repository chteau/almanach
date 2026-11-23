import { type Company, companyInputSchema, idSchema } from '@almanach/shared';
import { and, asc, eq, type SQL, sql } from 'drizzle-orm';
import { Hono, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Database } from '../../db/client.ts';
import { auditLog, companies, profiles } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';

/** Cookie remembering the active company, so plain links (PDF, export) work on it too. */
export const COMPANY_COOKIE = 'almanach_company';

/**
 * Builds the owner of a company as an SQL value, for audit rows written where only the company is known
 *
 * @param companyId {string} - company id
 * @returns {SQL} - subquery returning the owner's user id
 */
export function ownerOf(companyId: string): SQL {
  return sql`(select ${companies.userId} from ${companies} where ${companies.id} = ${companyId})`;
}

/**
 * Lists the companies of a person, oldest first, with the profile facts the interface needs
 *
 * @param db {Database} - Drizzle database
 * @param userId {string} - owner
 * @returns {Promise<Company[]>} - the companies
 */
export async function listCompanies(db: Database, userId: string): Promise<Company[]> {
  return db
    .select({
      id: companies.id,
      name: companies.name,
      country: profiles.country,
      status: profiles.status,
      activityStart: profiles.activityStart,
      ceasedOn: profiles.ceasedOn,
    })
    .from(companies)
    .leftJoin(profiles, eq(profiles.companyId, companies.id))
    .where(eq(companies.userId, userId))
    .orderBy(asc(companies.createdAt), asc(companies.id));
}

/**
 * Middleware choosing the company of the request (cookie, else the oldest one) among the signed-in person's
 * own companies, and creating the first one for a new account. Mount after requireUser.
 *
 * @param db {Database} - Drizzle database
 * @returns {MiddlewareHandler<AppEnv>} - the middleware, which sets c.var.company
 */
export function requireCompany(db: Database): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.var.user;
    const wanted = getCookie(c, COMPANY_COOKIE);
    const pick = async () => {
      const rows = await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(eq(companies.userId, user.id))
        .orderBy(asc(companies.createdAt), asc(companies.id));
      return rows.find((row) => row.id === wanted) ?? rows[0];
    };
    let company = await pick();
    if (!company) {
      // The first company reuses the user id, so concurrent first requests cannot create two.
      await db
        .insert(companies)
        .values({ id: user.id, userId: user.id, name: user.email.split('@')[0] ?? user.email })
        .onConflictDoNothing();
      company = await pick();
    }
    if (!company) return c.json({ error: 'not_found' }, 404);
    c.set('company', company);
    await next();
  };
}

/**
 * Builds /api/companies: list, create, rename and activate the signed-in person's companies. Mount behind
 * requireUser and requireCompany.
 *
 * @param db {Database} - Drizzle database
 * @param cookieSecure {boolean} - whether cookies require HTTPS
 * @returns {Hono<AppEnv>} - the router
 */
export function companyRoutes(db: Database, cookieSecure: boolean): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) =>
    c.json({ companies: await listCompanies(db, c.var.user.id), active: c.var.company.id }),
  );

  router.post('/', async (c) => {
    const { data, response } = await parseBody(c, companyInputSchema);
    if (response) return response;
    const [row] = await db
      .insert(companies)
      .values({ userId: c.var.user.id, name: data.name })
      .returning({ id: companies.id, name: companies.name });
    await db
      .insert(auditLog)
      .values({ userId: c.var.user.id, action: 'company.created', meta: { id: row?.id } });
    return c.json({ company: row }, 201);
  });

  router.put('/active', async (c) => {
    const body = await c.req.json().catch(() => null);
    const id = idSchema.safeParse(body?.id);
    if (!id.success) return c.json({ error: 'validation_failed' }, 422);
    const owned = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, id.data), eq(companies.userId, c.var.user.id)));
    if (owned.length === 0) return c.json({ error: 'not_found' }, 404);
    setCookie(c, COMPANY_COOKIE, id.data, {
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
      secure: cookieSecure,
      maxAge: 400 * 86_400,
    });
    return c.body(null, 204);
  });

  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const { data, response } = await parseBody(c, companyInputSchema);
    if (response) return response;
    if (!idSchema.safeParse(id).success) return c.json({ error: 'not_found' }, 404);
    const updated = await db
      .update(companies)
      .set({ name: data.name })
      .where(and(eq(companies.id, id), eq(companies.userId, c.var.user.id)))
      .returning({ id: companies.id });
    return updated.length > 0 ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
  });

  return router;
}
