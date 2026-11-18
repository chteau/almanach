import {
  billingSettingsSchema,
  LOGO_MAX_BYTES,
  logoSchema,
  numberFormatSchema,
  situationSchema,
} from '@almanach/shared';
import { eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import {
  auditLog,
  billingSettings,
  clients,
  customDeadlines,
  deadlineMarks,
  documents,
  missions,
  numberSequences,
  payments,
  profiles,
  situationChanges,
  timeEntries,
  userSettings,
} from '../../db/schema.ts';
import { imageSize, isImage, LOGO_MAX_SIDE } from '../billing/billing.ts';

export const EXPORT_FORMAT = 'almanach-export/1';

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
  userSettings,
  billingSettings,
  situationChanges,
} as const satisfies Record<string, PgTable>;

type TableName = keyof typeof TABLES;
type Row = Record<string, unknown>;

/** Full export of one person's data (S-245). */
export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  data: Record<TableName, Row[]>;
}

/**
 * Collects every row of the person, without the user id column
 *
 * @param db {Database} - database
 * @param userId {string} - person exporting
 * @returns {Promise<ExportFile>} - export
 */
export async function exportData(db: Database, userId: string): Promise<ExportFile> {
  const data = {} as Record<TableName, Row[]>;
  for (const [name, table] of Object.entries(TABLES) as [TableName, (typeof TABLES)[TableName]][]) {
    const rows = (await db.select().from(table).where(eq(table.userId, userId))) as Row[];
    data[name] = rows.map(({ userId: _owner, ...row }) => {
      if (name === 'userSettings') return { ...row, icalTokenHash: null, ntfy: null };
      return row;
    });
  }
  return { format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), data };
}

/** Columns holding a timestamp; JSON turns them into strings, the database needs dates back. */
const TIMESTAMP = /At$/;

/**
 * Turns an exported row back into insertable values for a new owner
 *
 * @param row {Row} - exported row
 * @param userId {string} - new owner
 * @returns {Row} - values
 */
function revive(row: Row, userId: string): Row {
  const values: Row = { userId };
  for (const [key, value] of Object.entries(row)) {
    if (key === 'userId') continue;
    values[key] = TIMESTAMP.test(key) && typeof value === 'string' ? new Date(value) : value;
  }
  return values;
}

/**
 * Checks that every reference inside the export points to a row of the same export, so an import
 * can never attach data to someone else's clients, missions or documents
 *
 * @param data {Record<TableName, Row[]>} - export content
 * @returns {string | null} - first problem found, or null
 */
export function referenceProblem(data: Record<TableName, Row[]>): string | null {
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
 * @param data {Record<TableName, Row[]>} - export content
 * @returns {string | null} - first problem found, or null
 */
function contentProblem(data: Record<TableName, Row[]>): string | null {
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
 * Restores an export into an account that has no business data yet (S-246). Everything happens in one
 * transaction: on any error, nothing is kept.
 *
 * @param db {Database} - database
 * @param userId {string} - account receiving the data
 * @param input {unknown} - parsed export file
 * @returns {Promise<{ ok: true; counts: Record<string, number> } | { error: string; detail?: string }>} - outcome
 */
export async function importData(
  db: Database,
  userId: string,
  input: unknown,
): Promise<{ ok: true; counts: Record<string, number> } | { error: string; detail?: string }> {
  const file = input as Partial<ExportFile> | null;
  if (!file || file.format !== EXPORT_FORMAT || typeof file.data !== 'object' || file.data === null) {
    return { error: 'invalid_export' };
  }
  const data = {} as Record<TableName, Row[]>;
  for (const name of Object.keys(TABLES) as TableName[]) {
    const rows = (file.data as Record<string, unknown>)[name] ?? [];
    if (
      !Array.isArray(rows) ||
      !rows.every((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
    ) {
      return { error: 'invalid_export', detail: name };
    }
    data[name] = rows as Row[];
  }
  if (data.profiles.length > 1 || data.userSettings.length > 1 || data.billingSettings.length > 1)
    return { error: 'invalid_export', detail: 'profiles' };
  const problem = referenceProblem(data);
  if (problem) return { error: 'invalid_references', detail: problem };

  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.userId, userId))
    .limit(1);
  const [existingDoc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.userId, userId))
    .limit(1);
  if (existing || existingDoc) return { error: 'not_empty' };

  try {
    const counts: Record<string, number> = {};
    await db.transaction(async (tx) => {
      // Onboarding may already have created a profile and settings: the export replaces them.
      await tx.delete(profiles).where(eq(profiles.userId, userId));
      await tx.delete(userSettings).where(eq(userSettings.userId, userId));
      await tx.delete(billingSettings).where(eq(billingSettings.userId, userId));
      await tx.delete(situationChanges).where(eq(situationChanges.userId, userId));
      await tx.delete(numberSequences).where(eq(numberSequences.userId, userId));
      for (const name of Object.keys(TABLES) as TableName[]) {
        const rows = data[name].map((row) => revive(row, userId));
        counts[name] = rows.length;
        for (let start = 0; start < rows.length; start += 500) {
          await tx.insert(TABLES[name]).values(rows.slice(start, start + 500) as never);
        }
      }
      await tx.insert(auditLog).values({ userId, action: 'data.imported', meta: counts });
    });
    return { ok: true, counts };
  } catch (error) {
    console.warn('Import failed:', error);
    return { error: 'import_failed' };
  }
}
