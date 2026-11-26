import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { computeTotals, type Line } from '@almanach/shared';
import { SQL } from 'bun';
import { createDatabase, type Database, runMigrations } from '../../db/client.ts';
import { clients, companies, documents, payments, users } from '../../db/schema.ts';
import { PackRegistry } from '../packs/packs.ts';
import { PlanningService } from './planning.service.ts';

// VAT on money collected (German Ist-Versteuerung) read from payments: TEST_DATABASE_URL=postgres://… bun test collected
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('VAT figures of payments received (database)', () => {
  const name = `almanach_collected_${process.pid}`;
  let admin: SQL;
  let db: Database;
  let planning: PlanningService;
  let companyId = '';

  beforeAll(async () => {
    admin = new SQL(url as string);
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const target = new URL(url as string);
    target.pathname = `/${name}`;
    db = createDatabase(target.toString());
    await runMigrations(db);
    planning = new PlanningService(db, await PackRegistry.load());
    const [user] = await db
      .insert(users)
      .values({ email: 'jonas@example.de', passwordHash: 'x', role: 'admin', locale: 'de' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ userId: user?.id as string, name: 'Jonas Becker' })
      .returning();
    companyId = company?.id as string;
    const [client] = await db
      .insert(clients)
      .values({
        companyId,
        kind: 'company',
        name: 'Schmidt GmbH',
        country: 'DE',
        currency: 'EUR',
        language: 'de',
        paymentTermsDays: 30,
        contacts: [],
      })
      .returning();
    const line = (cents: number): Line[] => [
      { description: 'Beratung', quantity: 1000, unit: 'day', unitPriceCents: cents, discountBp: 0 },
    ];
    const document = async (
      type: 'invoice' | 'deposit',
      cents: number,
      depositsCents = 0,
      currency = 'EUR',
    ) => {
      const [row] = await db
        .insert(documents)
        .values({
          companyId,
          type,
          state: 'issued',
          number: `R-${Math.random()}`,
          clientId: client?.id as string,
          issueDate: '2026-06-01',
          language: 'de',
          currency,
          lines: line(cents),
          discountBp: 0,
          depositIds: [],
          vatMode: 'standard',
          mentions: [],
          totals: computeTotals(line(cents), 0, 1900, depositsCents),
        })
        .returning();
      return row?.id as string;
    };
    const pay = (documentId: string, date: string, amountCents: number) =>
      db
        .insert(payments)
        .values({ companyId, documentId, date, amountCents, feesCents: 0, method: 'transfer' });
    // Deposit of 1,190 € gross, final invoice of 10,000 € net less that deposit, paid in two parts.
    await pay(await document('deposit', 100_000), '2026-06-15', 119_000);
    const final = await document('invoice', 1_000_000, 119_000);
    await pay(final, '2026-07-10', 476_000);
    await pay(final, '2026-10-05', 595_000);
    await pay(await document('invoice', 50_000, 0, 'USD'), '2026-07-20', 59_500);
  });

  afterAll(async () => {
    await db?.$client.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.close();
  });

  test('each payment carries its share of net and VAT, dated by payment, other currencies left out', async () => {
    const items = await planning.collected(companyId, 'EUR', '2026-01-01', '2026-12-31');
    const rows = items
      .map((item) => [item.date, item.netCents, item.vatCents])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    // 1,190 € = 1,000 + 190; 4,760 € = 4,000 + 760; 5,950 € = 5,000 + 950: 10,000 € net and 1,900 € VAT in all.
    expect(rows).toEqual([
      ['2026-06-15', 100_000, 19_000],
      ['2026-07-10', 400_000, 76_000],
      ['2026-10-05', 500_000, 95_000],
    ]);
    expect(await planning.collected(companyId, 'EUR', '2026-07-01', '2026-09-30')).toHaveLength(1);
  });
});
