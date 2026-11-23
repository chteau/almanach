import {
  billingSettingsSchema,
  LOGO_MAX_BYTES,
  logoSchema,
  numberFormatSchema,
  situationSchema,
} from '@almanach/shared';
import { and, asc, eq, exists, or } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import {
  auditLog,
  billingSettings,
  clients,
  companies,
  customDeadlines,
  deadlineMarks,
  documents,
  externalRevenues,
  federationLinks,
  missions,
  numberSequences,
  payments,
  profiles,
  situationChanges,
  timeEntries,
  userSettings,
} from '../../db/schema.ts';
import { imageSize, isImage, LOGO_MAX_SIDE } from '../billing/billing.ts';

export const EXPORT_FORMAT = 'almanach-export/2';
/** Single-company exports made before companies existed; still accepted on import. */
const LEGACY_FORMAT = 'almanach-export/1';

/**
 * Tables exported, in insertion order so references always point to rows already restored.
 * Secrets (calendar feed token, ntfy token) are never exported.
 */
const TABLES = {
  profiles,
  clients,
  missions,
  documents,
  numberSequences,
  payments,
  timeEntries,
  customDeadlines,
  deadlineMarks,
  billingSettings,
  situationChanges,
  externalRevenues,
} as const satisfies Record<string, PgTable>;

type TableName = keyof typeof TABLES;
type Row = Record<string, unknown>;

/** Rows of one company, table by table, and the configuration of its links with other instances. */
type CompanyData = Record<TableName, Row[]> & { federationLinks?: Row[] };

/**
 * Configuration of a link kept by exports: never a key, secret or received total. Imported links stay
 * inactive and must be paired again.
 */
const linkExportSchema = z
  .object({
    peerUrl: z.string().max(500).nullable(),
    peerLabel: z.string().max(60).nullable(),
    share: z.boolean(),
    receive: z.boolean(),
    pulls: z.boolean(),
  })
  .strict();

/** Full export of one person's data: every company and the personal settings (S-245). */
export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  userSettings: Row[];
  companies: { name: string; data: CompanyData }[];
}

/**
 * Collects every row of the person's companies, without owner columns or secrets
 *
 * @param db {Database} - database
 * @param userId {string} - person exporting
 * @returns {Promise<ExportFile>} - export
 */
export async function exportData(db: Database, userId: string): Promise<ExportFile> {
  const owned = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.userId, userId))
    .orderBy(asc(companies.createdAt), asc(companies.id));
  const list: ExportFile['companies'] = [];
  for (const company of owned) {
    const data = {} as CompanyData;
    for (const [name, table] of Object.entries(TABLES) as [TableName, (typeof TABLES)[TableName]][]) {
      const rows = (await db.select().from(table).where(eq(table.companyId, company.id))) as Row[];
      data[name] = rows.map(({ companyId: _owner, ...row }) => row);
    }
    data.federationLinks = await db
      .select({
        peerUrl: federationLinks.peerUrl,
        peerLabel: federationLinks.peerLabel,
        share: federationLinks.share,
        receive: federationLinks.receive,
        pulls: federationLinks.pulls,
      })
      .from(federationLinks)
      .where(and(eq(federationLinks.companyId, company.id), eq(federationLinks.state, 'active')));
    list.push({ name: company.name, data });
  }
  const settings = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    userSettings: settings.map(({ userId: _owner, ...row }) => ({ ...row, icalTokenHash: null, ntfy: null })),
    companies: list,
  };
}

/** Columns holding a timestamp; JSON turns them into strings, the database needs dates back. */
const TIMESTAMP = /At$/;

/**
 * Turns an exported row back into insertable values for a new owner
 *
 * @param row {Row} - exported row
 * @param owner {Row} - owner column and value, `{ companyId }` or `{ userId }`
 * @returns {Row} - values
 */
function revive(row: Row, owner: Row): Row {
  const values: Row = { ...owner };
  for (const [key, value] of Object.entries(row)) {
    if (key === 'companyId' || key === 'userId') continue;
    values[key] = TIMESTAMP.test(key) && typeof value === 'string' ? new Date(value) : value;
  }
  return values;
}

/**
 * Checks that every reference inside the export points to a row of the same export, so an import
 * can never attach data to someone else's clients, missions or documents
 *
 * @param data {CompanyData} - content of one company
 * @returns {string | null} - first problem found, or null
 */
export function referenceProblem(data: CompanyData): string | null {
  const ids = (name: TableName) => new Set(data[name].map((row) => row.id));
  const clientIds = ids('clients');
  const missionIds = ids('missions');
  const documentIds = ids('documents');
  const optional = (value: unknown, known: Set<unknown>) =>
    value === null || value === undefined || known.has(value);
  for (const mission of data.missions) if (!clientIds.has(mission.clientId)) return 'missions.clientId';
  for (const doc of data.documents) {
    if (!clientIds.has(doc.clientId)) return 'documents.clientId';
    if (!optional(doc.missionId, missionIds) || !optional(doc.relatedId, documentIds))
      return 'documents.reference';
    if (!Array.isArray(doc.depositIds) || !doc.depositIds.every((id) => documentIds.has(id)))
      return 'documents.depositIds';
  }
  for (const payment of data.payments) if (!documentIds.has(payment.documentId)) return 'payments.documentId';
  for (const row of data.externalRevenues)
    if (!optional(row.clientId, clientIds)) return 'externalRevenues.clientId';
  for (const entry of data.timeEntries) {
    if (!missionIds.has(entry.missionId) || !optional(entry.documentId, documentIds))
      return 'timeEntries.reference';
  }
  return contentProblem(data);
}

const periodsSchema = z.array(
  z.intersection(numberFormatSchema, z.object({ fromYear: z.number().int().min(0).max(9999) })),
);
const pdfSchema = billingSettingsSchema.shape.pdf;

/**
 * Checks the JSON columns an import writes as they are, so a crafted file cannot store values the
 * application would choke on, or write back into the profile through the situation history
 *
 * @param data {CompanyData} - content of one company
 * @returns {string | null} - first problem found, or null
 */
function contentProblem(data: CompanyData): string | null {
  if (data.billingSettings.length > 1) return 'billingSettings.count';
  for (const row of data.billingSettings) {
    if (!periodsSchema.safeParse(row.numbering).success) return 'billingSettings.numbering';
    if (!pdfSchema.safeParse(row.pdf).success) return 'billingSettings.pdf';
    if (
      !Number.isInteger(row.defaultTermsDays) ||
      Number(row.defaultTermsDays) < 0 ||
      Number(row.defaultTermsDays) > 120
    )
      return 'billingSettings.defaultTermsDays';
    if (row.logo !== null && row.logo !== undefined) {
      const logo = logoSchema.safeParse({ mime: row.logoMime, data: row.logo });
      if (!logo.success) return 'billingSettings.logo';
      const bytes = new Uint8Array(Buffer.from(logo.data.data, 'base64'));
      const size = isImage(bytes, logo.data.mime) ? imageSize(bytes, logo.data.mime) : null;
      if (bytes.length > LOGO_MAX_BYTES || !size || size.width > LOGO_MAX_SIDE || size.height > LOGO_MAX_SIDE)
        return 'billingSettings.logo';
    }
  }
  const strict = situationSchema.strict();
  for (const row of data.situationChanges) {
    if (!strict.safeParse(row.before).success || !strict.safeParse(row.after).success)
      return 'situationChanges.content';
  }
  return null;
}

/**
 * Reads the companies of an export file, legacy single-company files included
 *
 * @param input {unknown} - parsed JSON body
 * @returns {{ userSettings: Row[]; companies: { name: string | null; data: CompanyData }[] } | { error: string; detail?: string }} - content or problem
 */
function readExport(
  input: unknown,
):
  | { userSettings: Row[]; companies: { name: string | null; data: CompanyData }[] }
  | { error: string; detail?: string } {
  const file = input as Record<string, unknown> | null;
  const rowsOf = (value: unknown) =>
    Array.isArray(value) &&
    value.every((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
      ? (value as Row[])
      : null;
  const companyData = (raw: unknown): CompanyData | string => {
    if (typeof raw !== 'object' || raw === null) return 'data';
    const data = {} as CompanyData;
    for (const name of Object.keys(TABLES) as TableName[]) {
      const rows = rowsOf((raw as Record<string, unknown>)[name] ?? []);
      if (!rows) return name;
      data[name] = rows;
    }
    const links = z
      .array(linkExportSchema)
      .max(20)
      .safeParse((raw as Record<string, unknown>).federationLinks ?? []);
    if (!links.success) return 'federationLinks';
    data.federationLinks = links.data;
    return data;
  };
  let settings: unknown;
  let raw: { name: string | null; data: unknown }[];
  if (file?.format === LEGACY_FORMAT && typeof file.data === 'object' && file.data !== null) {
    settings = (file.data as Record<string, unknown>).userSettings ?? [];
    raw = [{ name: null, data: file.data }];
  } else if (file?.format === EXPORT_FORMAT && Array.isArray(file.companies) && file.companies.length > 0) {
    settings = file.userSettings ?? [];
    raw = (file.companies as unknown[]).map((item) => {
      const company = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      const name = typeof company.name === 'string' ? company.name.trim().slice(0, 120) : '';
      return { name: name || null, data: company.data };
    });
  } else {
    return { error: 'invalid_export' };
  }
  const userRows = rowsOf(settings);
  if (!userRows || userRows.length > 1 || raw.length > 50)
    return { error: 'invalid_export', detail: 'userSettings' };
  const list: { name: string | null; data: CompanyData }[] = [];
  for (const item of raw) {
    const data = companyData(item.data);
    if (typeof data === 'string') return { error: 'invalid_export', detail: data };
    if (data.profiles.length > 1 || data.billingSettings.length > 1)
      return { error: 'invalid_export', detail: 'profiles' };
    const problem = referenceProblem(data);
    if (problem) return { error: 'invalid_references', detail: problem };
    list.push({ name: item.name, data });
  }
  return { userSettings: userRows, companies: list };
}

/**
 * Restores an export into an account without clients or documents: the first company goes into the active
 * one, the others become new companies
 *
 * @param db {Database} - database
 * @param owner {{ userId: string; companyId: string }} - person importing and their active company
 * @param input {unknown} - parsed JSON body
 * @returns {Promise<{ ok: true; counts: Record<string, number> } | { error: string; detail?: string }>} - counts or problem
 */
export async function importData(
  db: Database,
  owner: { userId: string; companyId: string },
  input: unknown,
): Promise<{ ok: true; counts: Record<string, number> } | { error: string; detail?: string }> {
  const content = readExport(input);
  if ('error' in content) return content;
  const { userId } = owner;
  const busy = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.userId, userId),
        or(
          exists(db.select().from(clients).where(eq(clients.companyId, companies.id))),
          exists(db.select().from(documents).where(eq(documents.companyId, companies.id))),
        ),
      ),
    )
    .limit(1);
  if (busy.length > 0) return { error: 'not_empty' };

  try {
    const counts: Record<string, number> = { companies: content.companies.length };
    await db.transaction(async (tx) => {
      await tx.delete(userSettings).where(eq(userSettings.userId, userId));
      if (content.userSettings.length > 0)
        await tx
          .insert(userSettings)
          .values(content.userSettings.map((row) => revive(row, { userId })) as never);
      for (const [index, company] of content.companies.entries()) {
        let companyId = owner.companyId;
        if (index > 0) {
          const [created] = await tx
            .insert(companies)
            .values({ userId, name: company.name ?? `${index + 1}` })
            .returning({ id: companies.id });
          if (!created) throw new Error('company_not_created');
          companyId = created.id;
        } else if (company.name) {
          await tx.update(companies).set({ name: company.name }).where(eq(companies.id, companyId));
        }
        // Onboarding may already have created a profile and settings: the export replaces them.
        await tx.delete(profiles).where(eq(profiles.companyId, companyId));
        await tx.delete(billingSettings).where(eq(billingSettings.companyId, companyId));
        await tx.delete(situationChanges).where(eq(situationChanges.companyId, companyId));
        await tx.delete(numberSequences).where(eq(numberSequences.companyId, companyId));
        for (const name of Object.keys(TABLES) as TableName[]) {
          const rows = company.data[name].map((row) => revive(row, { companyId }));
          counts[name] = (counts[name] ?? 0) + rows.length;
          for (let start = 0; start < rows.length; start += 500) {
            await tx.insert(TABLES[name]).values(rows.slice(start, start + 500) as never);
          }
        }
        const links = company.data.federationLinks ?? [];
        if (links.length > 0)
          await tx
            .insert(federationLinks)
            .values(links.map((link) => ({ ...(link as object), companyId, state: 'imported' as const })));
      }
      await tx.insert(auditLog).values({ userId, action: 'data.imported', meta: counts });
    });
    return { ok: true, counts };
  } catch (error) {
    console.warn('Import failed:', error);
    return { error: 'import_failed' };
  }
}
