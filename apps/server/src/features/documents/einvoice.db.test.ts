import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, type PDFRawStream } from 'pdf-lib';
import { createApp } from '../../app.ts';
import { loadConfig } from '../../config.ts';
import { createDatabase, type Database, runMigrations } from '../../db/client.ts';
import { companies, instance, profiles, users } from '../../db/schema.ts';
import { SessionStore } from '../auth/sessions.ts';
import { Federation } from '../federation/federation.ts';
import { DrizzleInstallRepository } from '../install/install.repository.ts';
import { InstallService } from '../install/install.service.ts';
import { InstallTokenStore } from '../install/install-token.ts';
import { PackRegistry } from '../packs/packs.ts';
import { PackUpdates } from '../packs/updates.ts';
import { PlanningService } from '../planning/planning.service.ts';
import { ReminderJob } from '../planning/reminders.ts';
import { StripeSync } from '../stripe/stripe.ts';
import { ReleaseCheck } from '../system/system.ts';
import { DocumentService } from './documents.service.ts';

// Database tests run against an empty PostgreSQL server: TEST_DATABASE_URL=postgres://… bun test einvoice.db
const url = process.env.TEST_DATABASE_URL;

// biome-ignore lint/suspicious/noExplicitAny: test answers are checked field by field.
type Body = any;

describe.skipIf(!url)('Factur-X from the API (database)', () => {
  const name = `almanach_einvoice_${process.pid}`;
  let admin: SQL;
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let cookie = '';

  const call = async (path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(path, {
      method: init.method ?? 'GET',
      headers: { cookie: `almanach_session=${cookie}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  beforeAll(async () => {
    admin = new SQL(url as string);
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const target = new URL(url as string);
    target.pathname = `/${name}`;
    db = createDatabase(target.toString());
    await runMigrations(db);
    await db.insert(instance).values({
      id: 1,
      name: 'Test',
      publicUrl: 'http://localhost',
      timezone: 'Europe/Paris',
      defaultLocale: 'fr',
    });
    const [user] = await db
      .insert(users)
      .values({ email: 'a@example.test', passwordHash: 'x', role: 'admin', locale: 'fr' })
      .returning({ id: users.id });
    const id = user?.id ?? '';
    await db.insert(companies).values({ id, userId: id, name: 'Studio' });
    await db.insert(profiles).values({
      companyId: id,
      country: 'FR',
      status: 'micro_bnc',
      activityStart: '2026-01-01',
      declarationPeriod: 'monthly',
      options: [],
      identifiers: { siret: '73282932000074', vat: 'FR40732829320' },
      currency: 'EUR',
      bank: { format: 'iban', iban: 'FR7630006000011234567890189', bic: '' },
      company: {
        name: 'Camille Martin',
        address: '12 rue des Lilas\n75011 Paris',
        email: 'a@example.test',
        phone: null,
        website: null,
      },
    });
    const sessions = new SessionStore(db);
    cookie = await sessions.create(id, { ip: null, userAgent: null });
    const config = { ...loadConfig({ DATABASE_URL: target.toString() }), cookieSecure: false };
    const packs = await PackRegistry.load();
    const planning = new PlanningService(db, packs);
    app = createApp({
      config,
      install: new InstallService(new DrizzleInstallRepository(db), new InstallTokenStore(), false),
      db,
      sessions,
      packs,
      documents: new DocumentService(db, packs),
      planning,
      reminders: new ReminderJob(db, planning, config),
      packUpdates: new PackUpdates(db, packs, [], undefined),
      releases: new ReleaseCheck(db, config.releaseCheckUrl),
      stripe: new StripeSync(db, undefined),
      federation: new Federation(db, planning, undefined),
    });
  });

  afterAll(async () => {
    await db?.$client.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.close();
  });

  test('structured client address, missing data reported, Factur-X embedded once complete', async () => {
    const client = {
      kind: 'company',
      name: 'Atelier Durand',
      email: 'compta@durand.example',
      phone: null,
      address: null,
      addressLines: ['3 avenue de la Gare'],
      postalCode: null,
      city: 'Lyon',
      country: 'FR',
      vatNumber: 'FR83404833048',
      currency: 'EUR',
      language: 'fr',
      paymentTermsDays: 30,
      contacts: [],
      notes: null,
      siret: '40483304800022',
    };
    const created = (await (await call('/api/clients', { method: 'POST', body: client })).json()) as Body;
    expect(created.client).toMatchObject({ address: '3 avenue de la Gare\nLyon', postalCode: null });
    const clientId = created.client.id;

    const draft = {
      type: 'invoice',
      clientId,
      missionId: null,
      issueDate: '2026-11-24',
      validUntil: null,
      language: 'fr',
      currency: 'EUR',
      lines: [{ description: 'Conseil', quantity: 2000, unit: 'day', unitPriceCents: 50_000, discountBp: 0 }],
      discountBp: 0,
      note: null,
      depositIds: [],
      activityId: null,
      einvoice: true,
    };
    const { id } = (await (await call('/api/documents', { method: 'POST', body: draft })).json()) as Body;
    const view = (await (await call(`/api/documents/${id}`)).json()) as Body;
    expect(view.document.einvoiceFormat).toBe('facturx');
    expect(view.einvoice).toEqual({ missing: ['client.postal_code'] });
    const refused = await call(`/api/documents/${id}/issue`, { method: 'POST' });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as Body).missing).toEqual(['einvoice.client.postal_code']);

    await call(`/api/clients/${clientId}`, { method: 'PUT', body: { ...client, postalCode: '69002' } });
    expect((await call(`/api/documents/${id}/issue`, { method: 'POST' })).status).toBe(204);

    const bytes = new Uint8Array(await (await call(`/api/documents/${id}/pdf`)).arrayBuffer());
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const [ref] = pdf.catalog.lookup(PDFName.of('AF'), PDFArray).asArray();
    const spec = pdf.context.lookup(ref, PDFDict);
    const file = spec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F')) as PDFRawStream;
    const xml = new TextDecoder().decode(decodePDFRawStream(file).decode());
    expect(xml).toContain('<ram:ID>F-2026-0001</ram:ID>');
    expect(xml).toContain('<ram:PostcodeCode>69002</ram:PostcodeCode>');
    expect(xml).toContain('<ram:ExemptionReasonCode>VATEX-FR-FRANCHISE</ram:ExemptionReasonCode>');
    // The issued file is rebuilt identically from the frozen snapshots.
    const again = new Uint8Array(await (await call(`/api/documents/${id}/pdf`)).arrayBuffer());
    expect(again).toEqual(bytes);
  });

  test('without the option the invoice issues with incomplete e-invoice data', async () => {
    const clients = ((await (await call('/api/clients')).json()) as Body).clients;
    const { id } = (await (
      await call('/api/documents', {
        method: 'POST',
        body: {
          type: 'invoice',
          clientId: clients[0].id,
          missionId: null,
          issueDate: '2026-11-25',
          validUntil: null,
          language: 'fr',
          currency: 'USD',
          lines: [
            { description: 'Audit', quantity: 1000, unit: 'flat', unitPriceCents: 10_000, discountBp: 0 },
          ],
          discountBp: 0,
          note: null,
          depositIds: [],
          activityId: null,
        },
      })
    ).json()) as Body;
    const view = (await (await call(`/api/documents/${id}`)).json()) as Body;
    expect(view.document.einvoiceFormat).toBeNull();
    expect(view.einvoice.missing).toEqual(['document.currency']);
    expect((await call(`/api/documents/${id}/issue`, { method: 'POST' })).status).toBe(204);
  });
});
