import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { clients, customDeadlines, documents, missions } from '../../db/schema.ts';
import type { AppEnv } from '../../http/request.ts';

/**
 * Escapes LIKE wildcards so the search text is matched literally
 *
 * @param text {string} - typed text
 * @returns {string} - pattern for ILIKE, matching anywhere
 */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Global search over clients, missions, documents and personal deadlines (P21, S-260, S-261).
 * Mounted behind requireUser on /api/search.
 *
 * @param db {Database} - database
 * @returns {Hono<AppEnv>} - router
 */
export function searchRoutes(db: Database): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2 || q.length > 80)
      return c.json({ clients: [], missions: [], documents: [], deadlines: [] });
    const userId = c.var.user.id;
    const pattern = containsPattern(q);
    const [clientRows, missionRows, documentRows, deadlineRows] = await Promise.all([
      db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(
          and(eq(clients.userId, userId), or(ilike(clients.name, pattern), ilike(clients.email, pattern))),
        )
        .orderBy(asc(clients.name))
        .limit(6),
      db
        .select({ id: missions.id, name: missions.name, clientName: clients.name })
        .from(missions)
        .innerJoin(clients, eq(clients.id, missions.clientId))
        .where(and(eq(missions.userId, userId), ilike(missions.name, pattern)))
        .orderBy(asc(missions.name))
        .limit(6),
      db
        .select({
          id: documents.id,
          number: documents.number,
          type: documents.type,
          state: documents.state,
          clientName: clients.name,
        })
        .from(documents)
        .innerJoin(clients, eq(clients.id, documents.clientId))
        .where(
          and(
            eq(documents.userId, userId),
            or(eq(documents.number, q), ilike(documents.number, pattern), ilike(clients.name, pattern)),
          ),
        )
        .limit(8),
      db
        .select({ id: customDeadlines.id, title: customDeadlines.title, date: customDeadlines.date })
        .from(customDeadlines)
        .where(and(eq(customDeadlines.userId, userId), ilike(customDeadlines.title, pattern)))
        .limit(5),
    ]);
    // An exact invoice number comes first (S-261).
    documentRows.sort((a, b) => Number(b.number === q) - Number(a.number === q));
    return c.json({
      clients: clientRows,
      missions: missionRows,
      documents: documentRows,
      deadlines: deadlineRows,
    });
  });

  return router;
}
