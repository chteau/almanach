import {
  documentDraftSchema,
  idSchema,
  type Line,
  type PaymentView,
  PERCENT_SCALE,
  paymentInputSchema,
  QUANTITY_SCALE,
  timeInvoiceSchema,
  timeQuantity,
} from '@almanach/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import { auditLog, clients, documents, missions, payments, timeEntries } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import { ownsActivity } from '../activities/activities.ts';
import { loadBilling } from '../billing/billing.ts';
import type { DocumentService } from './documents.service.ts';
import { type PdfStyle, renderPdf } from './pdf.ts';

/**
 * Today's date for status computations; the client may send its own time zone's date
 *
 * @param value {string | undefined} - `today` query parameter
 * @returns {string} - YYYY-MM-DD
 */
function todayFrom(value: string | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
}

/**
 * Builds /api/documents and /api/payments. Drafts are freely editable; issued documents are frozen and
 * can only be corrected by a credit note (S-171, S-172). Mount behind requireUser.
 *
 * @param db {Database} - Drizzle database
 * @param service {DocumentService} - document rules
 * @param reserveShare {(companyId: string, paymentId: string) => Promise<number | null>} - share of the tax
 * reserve a recorded payment brings, returned with it; none when absent
 * @param onQuote {(companyId: string, quoteId: string, event: 'sent' | 'accepted' | 'declined') => Promise<void>} -
 * moves the deal holding a quote when it is sent or answered
 * @returns {Hono<AppEnv>} - the router
 */
export function documentRoutes(
  db: Database,
  service: DocumentService,
  reserveShare?: (companyId: string, paymentId: string) => Promise<number | null>,
  onQuote?: (companyId: string, quoteId: string, event: 'sent' | 'accepted' | 'declined') => Promise<void>,
): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * PDF look chosen by the person (S-235)
   *
   * @param companyId {string} - owner
   * @returns {Promise<PdfStyle | undefined>} - style, or undefined before onboarding
   */
  const styleFor = async (companyId: string): Promise<PdfStyle | undefined> => {
    const profile = await service.profile(companyId);
    if (!profile) return undefined;
    const { pdf, logo } = await loadBilling(db, companyId, profile.country);
    return { ...pdf, logo };
  };

  /**
   * Loads one of the user's documents
   *
   * @param companyId {string} - owner
   * @param id {string} - document id from the URL
   * @returns {Promise<typeof documents.$inferSelect | undefined>} - the row, if owned
   */
  async function owned(companyId: string, id: string) {
    if (!idSchema.safeParse(id).success) return undefined;
    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.companyId, companyId)))
      .limit(1);
    return row;
  }

  /**
   * Validates references of a draft and computes its derived fields
   *
   * @param companyId {string} - owner
   * @param draft {DocumentDraft} - validated draft
   * @returns {Promise<{ values: Record<string, unknown> } | { error: string }>} - row values or an error code
   */
  async function prepare(companyId: string, draft: z.output<typeof documentDraftSchema>) {
    const profile = await service.profile(companyId);
    const client = await service.client(companyId, draft.clientId);
    if (!profile) return { error: 'no_profile' };
    if (!client) return { error: 'unknown_client' };
    if (!(await ownsActivity(db, companyId, draft.activityId))) return { error: 'unknown_activity' };
    if (draft.missionId) {
      const [mission] = await db
        .select({ id: missions.id })
        .from(missions)
        .where(
          and(
            eq(missions.id, draft.missionId),
            eq(missions.companyId, companyId),
            eq(missions.clientId, client.id),
          ),
        )
        .limit(1);
      if (!mission) return { error: 'unknown_mission' };
    }
    const derived = await service.derive(companyId, draft, profile, client);
    const { depositIds: _ids, ...rest } = draft;
    return { values: { ...rest, ...derived, validUntil: draft.type === 'quote' ? draft.validUntil : null } };
  }

  router.get('/documents', async (c) => {
    const type = c.req.query('type');
    const all = await service.views(c.var.company.id, todayFrom(c.req.query('today')));
    const wanted =
      type === 'quote'
        ? ['quote']
        : type === 'credit_note'
          ? ['credit_note']
          : type
            ? ['invoice', 'deposit']
            : null;
    return c.json({ documents: wanted ? all.filter((doc) => wanted.includes(doc.type)) : all });
  });

  router.get('/documents/:id', async (c) => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success) return c.json({ error: 'not_found' }, 404);
    const [view] = await service.views(c.var.company.id, todayFrom(c.req.query('today')), id);
    if (!view) return c.json({ error: 'not_found' }, 404);
    const profile = await service.profile(c.var.company.id);
    const client = await service.client(c.var.company.id, view.clientId);
    const missing =
      view.state === 'draft' && profile && client
        ? service.missing(profile, client, view.lines, view.vatMode)
        : [];
    return c.json({ document: view, missing });
  });

  router.post('/documents', async (c) => {
    const { data, response } = await parseBody(c, documentDraftSchema);
    if (response) return response;
    const prepared = await prepare(c.var.company.id, data);
    if ('error' in prepared) return c.json({ error: prepared.error }, 422);
    const [row] = await db
      .insert(documents)
      .values({
        ...(prepared.values as typeof documents.$inferInsert),
        companyId: c.var.company.id,
        state: 'draft',
      })
      .returning({ id: documents.id });
    return c.json({ id: row?.id }, 201);
  });

  router.put('/documents/:id', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    if (existing.state !== 'draft') return c.json({ error: 'not_draft' }, 409);
    const { data, response } = await parseBody(c, documentDraftSchema);
    if (response) return response;
    if (data.type !== existing.type) return c.json({ error: 'type_change' }, 422);
    const prepared = await prepare(c.var.company.id, data);
    if ('error' in prepared) return c.json({ error: prepared.error }, 422);
    await db
      .update(documents)
      .set({ ...(prepared.values as Partial<typeof documents.$inferInsert>), updatedAt: new Date() })
      .where(eq(documents.id, existing.id));
    return c.body(null, 204);
  });

  router.post('/documents/from-time', async (c) => {
    const { data, response } = await parseBody(c, timeInvoiceSchema);
    if (response) return response;
    const companyId = c.var.company.id;
    const entries = await db
      .select({
        id: timeEntries.id,
        missionId: timeEntries.missionId,
        date: timeEntries.date,
        minutes: timeEntries.minutes,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          inArray(timeEntries.id, data.entryIds),
          isNull(timeEntries.documentId),
          isNull(timeEntries.startedAt),
          eq(timeEntries.billable, true),
        ),
      );
    const missionIds = new Set(entries.map((entry) => entry.missionId));
    if (entries.length !== new Set(data.entryIds).size || missionIds.size !== 1) {
      return c.json({ error: 'invalid_entries' }, 422);
    }
    const [mission] = await db
      .select()
      .from(missions)
      .where(and(eq(missions.id, [...missionIds][0] ?? ''), eq(missions.companyId, companyId)))
      .limit(1);
    if (!mission) return c.json({ error: 'invalid_entries' }, 422);
    if (mission.billing !== 'hourly' && mission.billing !== 'daily')
      return c.json({ error: 'not_time_billed' }, 422);
    const [client] = await db.select().from(clients).where(eq(clients.id, mission.clientId)).limit(1);
    if (!client) return c.json({ error: 'unknown_client' }, 422);
    const dates = entries.map((entry) => entry.date).sort();
    const minutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
    const draft = documentDraftSchema.parse({
      type: 'invoice',
      clientId: client.id,
      missionId: mission.id,
      issueDate: todayFrom(undefined),
      validUntil: null,
      language: client.language,
      currency: mission.currency,
      lines: [
        {
          description: `${mission.name} (${dates[0]} – ${dates.at(-1)})`,
          ...timeQuantity(minutes, mission.billing),
          unitPriceCents: mission.rateCents,
          discountBp: 0,
        },
      ],
      discountBp: 0,
      note: null,
      depositIds: [],
    });
    const prepared = await prepare(companyId, draft);
    if ('error' in prepared) return c.json({ error: prepared.error }, 422);
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(documents)
        .values({ ...(prepared.values as typeof documents.$inferInsert), companyId, state: 'draft' })
        .returning({ id: documents.id });
      const linked = await tx
        .update(timeEntries)
        .set({ documentId: row?.id })
        .where(
          and(
            eq(timeEntries.companyId, companyId),
            inArray(timeEntries.id, data.entryIds),
            isNull(timeEntries.documentId),
          ),
        )
        .returning({ id: timeEntries.id });
      // Another request billed some of this time meanwhile: undo everything.
      if (linked.length !== entries.length) tx.rollback();
      return row?.id;
    });
    return c.json({ id }, 201);
  });

  router.delete('/documents/:id', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    const removable =
      existing.state === 'draft' || (existing.type === 'quote' && existing.state !== 'accepted');
    if (!removable) return c.json({ error: 'not_draft' }, 409);
    // Time billed on a deleted draft becomes billable again.
    await db.update(timeEntries).set({ documentId: null }).where(eq(timeEntries.documentId, existing.id));
    await db.delete(documents).where(eq(documents.id, existing.id));
    return c.body(null, 204);
  });

  router.post('/documents/:id/issue', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    const result = await service.issue(c.var.company.id, existing.id);
    if ('ok' in result) {
      if (existing.type === 'quote') await onQuote?.(c.var.company.id, existing.id, 'sent');
      return c.body(null, 204);
    }
    return c.json(result, result.error === 'missing_fields' ? 422 : 409);
  });

  router.post('/documents/:id/sent', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (!existing || existing.state === 'draft') return c.json({ error: 'not_found' }, 404);
    await db.update(documents).set({ sentAt: new Date() }).where(eq(documents.id, existing.id));
    if (existing.type === 'quote') await onQuote?.(c.var.company.id, existing.id, 'sent');
    return c.body(null, 204);
  });

  router.post('/documents/:id/answer', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (existing?.type !== 'quote' || existing.state === 'draft') return c.json({ error: 'not_found' }, 404);
    const { data, response } = await parseBody(
      c,
      z.object({ answer: z.enum(['accepted', 'declined', 'sent']) }).strict(),
    );
    if (response) return response;
    await db
      .update(documents)
      .set({ state: data.answer, updatedAt: new Date() })
      .where(eq(documents.id, existing.id));
    await onQuote?.(c.var.company.id, existing.id, data.answer);
    return c.body(null, 204);
  });

  /** Copies a document into a new draft: duplicate, quote to invoice or deposit, or credit note. */
  router.post('/documents/:id/derive', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    const { data, response } = await parseBody(
      c,
      z
        .object({
          as: z.enum(['duplicate', 'invoice', 'deposit', 'credit_note']),
          depositBp: z.number().int().min(100).max(PERCENT_SCALE).optional(),
        })
        .strict(),
    );
    if (response) return response;
    if (
      data.as === 'credit_note' &&
      (existing.state !== 'issued' || existing.type === 'quote' || existing.type === 'credit_note')
    ) {
      return c.json({ error: 'not_creditable' }, 409);
    }
    if ((data.as === 'invoice' || data.as === 'deposit') && existing.type !== 'quote') {
      return c.json({ error: 'not_a_quote' }, 409);
    }

    let lines: Line[] = existing.lines;
    if (data.as === 'deposit') {
      const share = data.depositBp ?? 3000;
      const amount = Math.round((existing.totals.netCents * share) / PERCENT_SCALE);
      lines = [
        {
          description: `${share / 100} % — ${existing.number ?? ''}`.trim(),
          quantity: QUANTITY_SCALE,
          unit: 'flat',
          unitPriceCents: amount,
          discountBp: 0,
        },
      ];
    }
    const type = data.as === 'duplicate' ? existing.type : data.as;
    const today = new Date().toISOString().slice(0, 10);
    const draft = {
      type,
      clientId: existing.clientId,
      missionId: existing.missionId,
      issueDate: today,
      validUntil: type === 'quote' ? existing.validUntil : null,
      language: existing.language,
      currency: existing.currency,
      lines,
      discountBp: data.as === 'deposit' ? 0 : existing.discountBp,
      note: existing.note,
      depositIds: [],
      activityId: existing.activityId,
    } satisfies z.output<typeof documentDraftSchema>;
    const prepared = await prepare(c.var.company.id, draft);
    if ('error' in prepared) return c.json({ error: prepared.error }, 422);
    const related = data.as === 'duplicate' ? null : existing.id;
    const [row] = await db
      .insert(documents)
      .values({
        ...(prepared.values as typeof documents.$inferInsert),
        companyId: c.var.company.id,
        state: 'draft',
        relatedId: related,
      })
      .returning({ id: documents.id });
    if (data.as === 'invoice' || data.as === 'deposit') {
      await db.update(documents).set({ state: 'accepted' }).where(eq(documents.id, existing.id));
      if (existing.type === 'quote') await onQuote?.(c.var.company.id, existing.id, 'accepted');
    }
    return c.json({ id: row?.id }, 201);
  });

  router.get('/documents/:id/pdf', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    let { seller, buyer } = existing;
    if (!seller || !buyer) {
      const profile = await service.profile(c.var.company.id);
      const client = await service.client(c.var.company.id, existing.clientId);
      if (!profile || !client) return c.json({ error: 'not_found' }, 404);
      ({ seller, buyer } = service.snapshots(profile, client));
    }
    let relatedNumber: string | null = null;
    if (existing.relatedId)
      relatedNumber = (await owned(c.var.company.id, existing.relatedId))?.number ?? null;
    const bytes = await renderPdf({
      ...existing,
      draft: existing.state === 'draft',
      relatedNumber,
      seller,
      buyer,
      style: await styleFor(c.var.company.id),
    });
    const name = `${existing.number ?? `draft-${existing.id.slice(0, 8)}`}.pdf`;
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${c.req.query('download') ? 'attachment' : 'inline'}; filename="${name}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  // The activity is no legal mention: it may change after issue, e.g. to sort records made before it existed.
  router.put('/documents/:id/activity', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    const { data, response } = await parseBody(c, z.object({ activityId: idSchema.nullable() }).strict());
    if (response) return response;
    if (!(await ownsActivity(db, c.var.company.id, data.activityId)))
      return c.json({ error: 'unknown_activity' }, 422);
    await db.update(documents).set({ activityId: data.activityId }).where(eq(documents.id, existing.id));
    return c.body(null, 204);
  });

  router.post('/documents/:id/payments', async (c) => {
    const existing = await owned(c.var.company.id, c.req.param('id'));
    if (existing?.state !== 'issued' || existing.type === 'quote' || existing.type === 'credit_note') {
      return c.json({ error: 'not_payable' }, 409);
    }
    const { data, response } = await parseBody(c, paymentInputSchema);
    if (response) return response;
    if (data.date < existing.issueDate)
      return c.json({ error: 'validation_failed', issues: [{ path: 'date', message: 'before_issue' }] }, 422);
    if (!(await ownsActivity(db, c.var.company.id, data.activityId)))
      return c.json({ error: 'unknown_activity' }, 422);
    const [row] = await db
      .insert(payments)
      .values({ ...data, companyId: c.var.company.id, documentId: existing.id })
      .returning({ id: payments.id });
    await db
      .insert(auditLog)
      .values({ userId: c.var.user.id, action: 'payment.recorded', meta: { documentId: existing.id } });
    const reserveShareCents = row && reserveShare ? await reserveShare(c.var.company.id, row.id) : null;
    return c.json({ id: row?.id, reserveShareCents }, 201);
  });

  router.get('/payments', async (c) => {
    const rows = await db
      .select({
        payment: payments,
        documentNumber: documents.number,
        currency: documents.currency,
        clientName: clients.name,
      })
      .from(payments)
      .innerJoin(documents, eq(documents.id, payments.documentId))
      .innerJoin(clients, eq(clients.id, documents.clientId))
      .where(eq(payments.companyId, c.var.company.id))
      .orderBy(desc(payments.date));
    const list: PaymentView[] = rows.map(({ payment, documentNumber, currency, clientName }) => ({
      id: payment.id,
      documentId: payment.documentId,
      date: payment.date,
      amountCents: payment.amountCents,
      receivedCents: payment.receivedCents,
      feesCents: payment.feesCents,
      method: payment.method as PaymentView['method'],
      reference: payment.reference,
      activityId: payment.activityId,
      documentNumber,
      clientName,
      currency,
    }));
    return c.json({ payments: list });
  });

  router.delete('/payments/:id', async (c) => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success) return c.json({ error: 'not_found' }, 404);
    const deleted = await db
      .delete(payments)
      .where(and(eq(payments.id, id), eq(payments.companyId, c.var.company.id)))
      .returning({ id: payments.id });
    if (deleted.length === 0) return c.json({ error: 'not_found' }, 404);
    await db.insert(auditLog).values({ userId: c.var.user.id, action: 'payment.deleted', meta: { id } });
    return c.body(null, 204);
  });

  return router;
}
