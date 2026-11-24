import {
  addDays,
  clientInputSchema,
  type DealInput,
  type DealStage,
  type DealView,
  dealFollowUpSchema,
  dealInputSchema,
  idSchema,
  type WeeklyReview,
} from '@almanach/shared';
import { and, asc, desc, eq, ilike, inArray, isNotNull, lte, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import {
  clients,
  dealEvents,
  deals,
  documents,
  missions,
  type notifications,
  pipelineSettings,
} from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import { ownsActivity } from '../activities/activities.ts';

const OPEN_STAGES: DealStage[] = ['lead', 'quote_sent', 'follow_up'];
const DEFAULT_FOLLOW_UP_DAYS = 7;

/** What happened to the quote of a deal. */
export type QuoteEvent = 'sent' | 'accepted' | 'declined';

type DealRow = typeof deals.$inferSelect & { clientName: string | null; quoteNumber: string | null };

/** Pipeline: deals, their history, the transitions from their quote, follow-up reminders. */
export class DealService {
  /**
   * Creates the service
   *
   * @param db {Database} - Drizzle database
   */
  constructor(private readonly db: Database) {}

  /**
   * Days between a quote sent and its follow-up for a company
   *
   * @param companyId {string} - company
   * @returns {Promise<number>} - days, 7 by default
   */
  async followUpDays(companyId: string): Promise<number> {
    const [row] = await this.db
      .select({ days: pipelineSettings.followUpDays })
      .from(pipelineSettings)
      .where(eq(pipelineSettings.companyId, companyId));
    return row?.days ?? DEFAULT_FOLLOW_UP_DAYS;
  }

  /**
   * Deals of a company, open ones first by next action
   *
   * @param companyId {string} - company
   * @param today {string} - YYYY-MM-DD
   * @param filter {{ stage?: DealStage; dueOnly?: boolean; id?: string }} - stage, only follow-ups due by today, one deal
   * @returns {Promise<DealView[]>} - deals
   */
  async list(
    companyId: string,
    today: string,
    filter: { stage?: DealStage; dueOnly?: boolean; id?: string } = {},
  ): Promise<DealView[]> {
    const rows = await this.db
      .select({
        deal: deals,
        clientName: clients.name,
        quoteNumber: documents.number,
      })
      .from(deals)
      .leftJoin(clients, eq(clients.id, deals.clientId))
      .leftJoin(documents, eq(documents.id, deals.quoteId))
      .where(
        and(
          eq(deals.companyId, companyId),
          filter.id ? eq(deals.id, filter.id) : undefined,
          filter.stage ? eq(deals.stage, filter.stage) : undefined,
          filter.dueOnly
            ? and(
                inArray(deals.stage, OPEN_STAGES),
                isNotNull(deals.nextActionOn),
                lte(deals.nextActionOn, today),
              )
            : undefined,
        ),
      )
      .orderBy(asc(deals.nextActionOn), desc(deals.updatedAt));
    return rows.map(({ deal, clientName, quoteNumber }) =>
      this.view({ ...deal, clientName, quoteNumber }, today),
    );
  }

  /**
   * One deal with its history
   *
   * @param companyId {string} - company
   * @param id {string} - deal
   * @param today {string} - YYYY-MM-DD
   * @returns {Promise<DealView | null>} - the deal, null when not the company's
   */
  async get(companyId: string, id: string, today: string): Promise<DealView | null> {
    const [deal] = await this.list(companyId, today, { id });
    if (!deal) return null;
    const events = await this.db
      .select()
      .from(dealEvents)
      .where(eq(dealEvents.dealId, id))
      .orderBy(desc(dealEvents.at));
    return {
      ...deal,
      events: events.map((event) => ({
        id: event.id,
        kind: event.kind,
        fromStage: event.fromStage,
        toStage: event.toStage,
        note: event.note,
        at: event.at.toISOString(),
      })),
    };
  }

  /**
   * Shapes a row for the API
   *
   * @param row {DealRow} - deal with its client and quote
   * @param today {string} - YYYY-MM-DD
   * @returns {DealView} - view
   */
  private view(row: DealRow, today: string): DealView {
    return {
      id: row.id,
      title: row.title,
      stage: row.stage,
      activityId: row.activityId,
      clientId: row.clientId,
      prospectName: row.prospectName,
      prospectContact: row.prospectContact,
      amountCents: row.amountCents,
      currency: row.currency,
      quoteId: row.quoteId,
      missionId: row.missionId,
      nextActionOn: row.nextActionOn,
      nextAction: row.nextAction,
      lostReason: row.lostReason,
      name: row.clientName ?? row.prospectName ?? '',
      quoteNumber: row.quoteNumber,
      closedOn: row.closedOn,
      createdAt: row.createdAt.toISOString(),
      late: OPEN_STAGES.includes(row.stage) && row.nextActionOn !== null && row.nextActionOn < today,
    };
  }

  /**
   * Moves a deal to a stage and records it; won and lost set the closing date, reopening clears it
   *
   * @param companyId {string} - company
   * @param id {string} - deal
   * @param from {DealStage} - current stage
   * @param to {DealStage} - new stage
   * @param today {string} - YYYY-MM-DD
   * @param extra {Partial<typeof deals.$inferInsert>} - other columns to change
   * @param note {string | null} - why, for the history
   * @returns {Promise<void>} - resolves when saved
   */
  async move(
    companyId: string,
    id: string,
    from: DealStage,
    to: DealStage,
    today: string,
    extra: Partial<typeof deals.$inferInsert> = {},
    note: string | null = null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(deals)
        .set({
          ...extra,
          stage: to,
          ...(from !== to && { closedOn: to === 'won' || to === 'lost' ? today : null }),
          updatedAt: new Date(),
        })
        .where(and(eq(deals.id, id), eq(deals.companyId, companyId)));
      if (from !== to)
        await tx
          .insert(dealEvents)
          .values({ companyId, dealId: id, kind: 'stage_changed', fromStage: from, toStage: to, note });
    });
  }

  /**
   * Follows the quote of a deal: sent → quote sent with a follow-up date, accepted → won, declined → lost
   *
   * @param companyId {string} - company
   * @param quoteId {string} - quote
   * @param event {QuoteEvent} - what happened
   * @param today {string} - YYYY-MM-DD
   * @returns {Promise<void>} - resolves when done; nothing when no deal holds the quote
   */
  async onQuote(companyId: string, quoteId: string, event: QuoteEvent, today: string): Promise<void> {
    const [deal] = await this.db
      .select({ id: deals.id, stage: deals.stage })
      .from(deals)
      .where(and(eq(deals.companyId, companyId), eq(deals.quoteId, quoteId)));
    if (!deal) return;
    if (event === 'sent') {
      if (deal.stage !== 'lead' && deal.stage !== 'quote_sent') return;
      const days = await this.followUpDays(companyId);
      await this.move(
        companyId,
        deal.id,
        deal.stage,
        'quote_sent',
        today,
        { nextActionOn: addDays(today, days) },
        'quote_sent',
      );
      return;
    }
    const to = event === 'accepted' ? 'won' : 'lost';
    await this.move(companyId, deal.id, deal.stage, to, today, { nextActionOn: null }, `quote_${event}`);
  }

  /**
   * Weekly review section: follow-ups due within seven days and late ones
   *
   * @param companyId {string} - company
   * @param today {string} - YYYY-MM-DD
   * @returns {Promise<WeeklyReview['deals']>} - the section
   */
  async review(companyId: string, today: string): Promise<WeeklyReview['deals']> {
    const open = (await this.list(companyId, today)).filter(
      (deal) => OPEN_STAGES.includes(deal.stage) && deal.nextActionOn !== null,
    );
    const brief = (deal: DealView) => ({
      id: deal.id,
      title: deal.title,
      name: deal.name,
      nextActionOn: deal.nextActionOn ?? '',
      nextAction: deal.nextAction,
    });
    return {
      followUpsDue: open
        .filter(
          (deal) => (deal.nextActionOn ?? '') >= today && (deal.nextActionOn ?? '') <= addDays(today, 7),
        )
        .map(brief),
      followUpsLate: open.filter((deal) => deal.late).map(brief),
    };
  }

  /**
   * Notifications: the follow-up on its day, then once when it is late
   *
   * @param companyId {string} - company
   * @param today {string} - YYYY-MM-DD
   * @returns {Promise<(typeof notifications.$inferInsert)[]>} - rows to insert, deduplicated by key
   */
  async reminders(companyId: string, today: string): Promise<(typeof notifications.$inferInsert)[]> {
    const due = await this.list(companyId, today, { dueOnly: true });
    return due.map((deal) => {
      const date = deal.nextActionOn ?? today;
      const late = date < today;
      return {
        companyId,
        kind: late ? 'deal_follow_up_late' : 'deal_follow_up',
        dedupeKey: `deal:${deal.id}:${date}${late ? ':late' : ''}`,
        params: { title: deal.title, name: deal.name, date },
        link: '/pipeline',
      };
    });
  }
}

/**
 * Builds /api/deals. Mount behind requireUser and requireCompany.
 *
 * @param db {Database} - Drizzle database
 * @param service {DealService} - the pipeline
 * @param today {() => Promise<string>} - today in the instance time zone
 * @returns {Hono<AppEnv>} - the router
 */
export function dealRoutes(db: Database, service: DealService, today: () => Promise<string>): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * Checks that what a deal points to belongs to the company, and that its quote has no other deal
   *
   * @param companyId {string} - company
   * @param data {DealInput} - validated input
   * @param id {string | undefined} - deal being changed
   * @returns {Promise<{ error: string; status: 409 | 422 } | null>} - problem, null when fine
   */
  async function problem(
    companyId: string,
    data: DealInput,
    id?: string,
  ): Promise<{ error: string; status: 409 | 422 } | null> {
    if (!(await ownsActivity(db, companyId, data.activityId)))
      return { error: 'unknown_activity', status: 422 };
    const owns = async (table: typeof clients | typeof missions, value: string | null) => {
      if (!value) return true;
      const [row] = await db
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, value), eq(table.companyId, companyId)));
      return Boolean(row);
    };
    if (!(await owns(clients, data.clientId))) return { error: 'unknown_client', status: 422 };
    if (!(await owns(missions, data.missionId))) return { error: 'unknown_mission', status: 422 };
    if (data.quoteId) {
      const [quote] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.id, data.quoteId),
            eq(documents.companyId, companyId),
            eq(documents.type, 'quote'),
          ),
        );
      if (!quote) return { error: 'unknown_quote', status: 422 };
      const [other] = await db
        .select({ id: deals.id })
        .from(deals)
        .where(and(eq(deals.quoteId, data.quoteId), id ? ne(deals.id, id) : undefined));
      if (other) return { error: 'quote_has_deal', status: 409 };
    }
    return null;
  }

  router.get('/', async (c) => {
    const stage = z
      .enum(['lead', 'quote_sent', 'follow_up', 'won', 'lost'])
      .optional()
      .safeParse(c.req.query('stage') || undefined);
    if (!stage.success) return c.json({ error: 'invalid_stage' }, 422);
    return c.json({
      deals: await service.list(c.var.company.id, await today(), {
        stage: stage.data,
        dueOnly: c.req.query('dueOnly') === 'true',
      }),
      followUpDays: await service.followUpDays(c.var.company.id),
    });
  });

  router.put('/settings', async (c) => {
    const { data, response } = await parseBody(
      c,
      z.object({ followUpDays: z.number().int().min(1).max(90) }).strict(),
    );
    if (response) return response;
    await db
      .insert(pipelineSettings)
      .values({ companyId: c.var.company.id, followUpDays: data.followUpDays })
      .onConflictDoUpdate({ target: pipelineSettings.companyId, set: { followUpDays: data.followUpDays } });
    return c.json({ followUpDays: data.followUpDays });
  });

  router.post('/', async (c) => {
    const { data, response } = await parseBody(c, dealInputSchema);
    if (response) return response;
    const wrong = await problem(c.var.company.id, data);
    if (wrong) return c.json({ error: wrong.error }, wrong.status);
    const day = await today();
    const closed = data.stage === 'won' || data.stage === 'lost';
    const [row] = await db
      .insert(deals)
      .values({ ...data, companyId: c.var.company.id, closedOn: closed ? day : null })
      .returning({ id: deals.id });
    if (!row) throw new Error('deal_not_created');
    return c.json({ deal: await service.get(c.var.company.id, row.id, day) }, 201);
  });

  router.get('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    const deal = id.success ? await service.get(c.var.company.id, id.data, await today()) : null;
    return deal ? c.json({ deal }) : c.json({ error: 'not_found' }, 404);
  });

  router.put('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    const day = await today();
    const existing = id.success ? await service.get(c.var.company.id, id.data, day) : null;
    if (!existing) return c.json({ error: 'not_found' }, 404);
    const { data, response } = await parseBody(c, dealInputSchema);
    if (response) return response;
    const wrong = await problem(c.var.company.id, data, existing.id);
    if (wrong) return c.json({ error: wrong.error }, wrong.status);
    const { stage, ...rest } = data;
    await service.move(c.var.company.id, existing.id, existing.stage, stage, day, rest);
    return c.json({ deal: await service.get(c.var.company.id, existing.id, day) });
  });

  router.delete('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const removed = await db
      .delete(deals)
      .where(and(eq(deals.id, id.data), eq(deals.companyId, c.var.company.id)))
      .returning({ id: deals.id });
    return removed.length > 0 ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
  });

  router.post('/:id/follow-up', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    const day = await today();
    const existing = id.success ? await service.get(c.var.company.id, id.data, day) : null;
    if (!existing) return c.json({ error: 'not_found' }, 404);
    const { data, response } = await parseBody(c, dealFollowUpSchema);
    if (response) return response;
    const to = existing.stage === 'quote_sent' ? 'follow_up' : existing.stage;
    await service.move(c.var.company.id, existing.id, existing.stage, to, day, {
      nextActionOn: data.nextActionOn,
      nextAction: data.nextAction,
    });
    await db.insert(dealEvents).values({
      companyId: c.var.company.id,
      dealId: existing.id,
      kind: 'follow_up_done',
      note: data.note || null,
    });
    return c.json({ deal: await service.get(c.var.company.id, existing.id, day) }, 201);
  });

  /** Creates the client from the prospect, with the validations of /api/clients, and links the deal to it. */
  router.post('/:id/convert-client', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    const day = await today();
    const existing = id.success ? await service.get(c.var.company.id, id.data, day) : null;
    if (!existing) return c.json({ error: 'not_found' }, 404);
    if (existing.clientId) return c.json({ error: 'already_client' }, 409);
    const { data, response } = await parseBody(c, clientInputSchema);
    if (response) return response;
    const { allowDuplicate, ...input } = data;
    if (!allowDuplicate) {
      const matches = await db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(
          and(
            eq(clients.companyId, c.var.company.id),
            ilike(clients.name, input.name.replace(/[\\%_]/g, '\\$&')),
          ),
        )
        .limit(5);
      if (matches.length > 0) return c.json({ error: 'possible_duplicate', matches }, 409);
    }
    const client = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(clients)
        .values({ ...input, companyId: c.var.company.id })
        .returning({ id: clients.id, name: clients.name });
      if (!row) throw new Error('client_not_created');
      await tx
        .update(deals)
        .set({ clientId: row.id, updatedAt: new Date() })
        .where(eq(deals.id, existing.id));
      return row;
    });
    return c.json({ client, deal: await service.get(c.var.company.id, existing.id, day) }, 201);
  });

  return router;
}
