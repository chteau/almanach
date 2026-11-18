import { z } from 'zod';
import { clientInputSchema } from './clients.ts';
import { LOCALES, type Locale } from './install.ts';

/** Most rows accepted in one client import (S-092). */
export const CSV_MAX_ROWS = 1000;

/** Columns understood by the client import, documented in docs/import-csv.md (S-247). */
export const CLIENT_CSV_FIELDS = [
  'name',
  'kind',
  'email',
  'phone',
  'address',
  'country',
  'vat_number',
  'currency',
  'language',
  'payment_terms_days',
  'notes',
] as const;

export type ClientCsvField = (typeof CLIENT_CSV_FIELDS)[number];

/** Header names recognised for each field, lower case and without accents, in the three languages. */
const ALIASES: Record<ClientCsvField, string[]> = {
  name: ['name', 'nom', 'client', 'company', 'societe', 'raison sociale', 'firma', 'kunde', 'organisation'],
  kind: ['kind', 'type', 'typ'],
  email: ['email', 'e-mail', 'mail', 'courriel'],
  phone: ['phone', 'telephone', 'tel', 'telefon'],
  address: ['address', 'adresse', 'anschrift'],
  country: ['country', 'pays', 'land', 'country code'],
  vat_number: [
    'vat_number',
    'vat',
    'vat number',
    'tva',
    'numero de tva',
    'tva intracommunautaire',
    'ust-idnr',
    'ustid',
  ],
  currency: ['currency', 'devise', 'monnaie', 'wahrung'],
  language: ['language', 'langue', 'sprache'],
  payment_terms_days: ['payment_terms_days', 'payment terms', 'delai de paiement', 'zahlungsziel'],
  notes: ['notes', 'note', 'commentaire', 'comments', 'bemerkung', 'notizen'],
};

/**
 * Lower-cases a header and removes accents, so "Délai de paiement" matches "delai de paiement"
 *
 * @param header {string} - column title
 * @returns {string} - comparable form
 */
function normalize(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

/**
 * Suggests the field a column holds, from its title
 *
 * @param header {string} - column title
 * @returns {ClientCsvField | null} - field, or null when unknown
 */
export function guessField(header: string): ClientCsvField | null {
  const key = normalize(header);
  for (const field of CLIENT_CSV_FIELDS) {
    if (ALIASES[field].some((alias) => normalize(alias) === key)) return field;
  }
  return null;
}

/**
 * Parses CSV text (RFC 4180 quoting) and detects the delimiter among comma, semicolon and tab
 *
 * @param text {string} - file content
 * @returns {string[][]} - rows of cells, blank lines removed
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', '\t', ','].reduce(
    (best, candidate) =>
      firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best,
    ',',
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

/** One mapped row sent to the server: field name to raw text. */
export const clientCsvRowSchema = z.partialRecord(z.enum(CLIENT_CSV_FIELDS), z.string().max(5000));

export const clientImportSchema = z
  .object({ rows: z.array(clientCsvRowSchema).min(1).max(CSV_MAX_ROWS), dryRun: z.boolean() })
  .strict();

/** Values used when a row leaves a column empty. */
export interface ClientCsvDefaults {
  country: string;
  currency: string;
  language: Locale;
  paymentTermsDays: number;
}

/**
 * Turns a mapped row into a client, or lists what is wrong with it
 *
 * @param row {Partial<Record<ClientCsvField, string>>} - raw values
 * @param defaults {ClientCsvDefaults} - values for empty columns
 * @returns {{ client: z.output<typeof clientInputSchema> } | { issues: { field: string; message: string }[] }} - client or problems
 */
export function clientFromCsv(
  row: Partial<Record<ClientCsvField, string>>,
  defaults: ClientCsvDefaults,
): { client: z.output<typeof clientInputSchema> } | { issues: { field: string; message: string }[] } {
  const text = (field: ClientCsvField) => row[field]?.trim() ?? '';
  const kind = normalize(text('kind'));
  const language = text('language').toLowerCase().slice(0, 2);
  const terms = text('payment_terms_days');
  const kinds: Record<string, 'individual' | 'company'> = {
    '': 'company',
    company: 'company',
    entreprise: 'company',
    societe: 'company',
    firma: 'company',
    unternehmen: 'company',
    business: 'company',
    individual: 'individual',
    particulier: 'individual',
    person: 'individual',
    privat: 'individual',
    privatperson: 'individual',
  };
  const candidate = {
    kind: kinds[kind] ?? 'unknown',
    name: text('name'),
    email: text('email').toLowerCase() || null,
    phone: text('phone') || null,
    address: text('address') || null,
    country: (text('country') || defaults.country).toUpperCase(),
    vatNumber:
      text('vat_number')
        .replace(/[\s.-]/g, '')
        .toUpperCase() || null,
    currency: (text('currency') || defaults.currency).toUpperCase(),
    language: (LOCALES as readonly string[]).includes(language) ? language : defaults.language,
    paymentTermsDays:
      terms === '' ? defaults.paymentTermsDays : /^\d{1,3}$/.test(terms) ? Number(terms) : Number.NaN,
    contacts: [],
    notes: text('notes') || null,
  };
  const parsed = clientInputSchema.safeParse(candidate);
  if (parsed.success) return { client: parsed.data };
  const fields: Record<string, ClientCsvField> = {
    vatNumber: 'vat_number',
    paymentTermsDays: 'payment_terms_days',
  };
  return {
    issues: parsed.error.issues.map((issue) => {
      const key = String(issue.path[0] ?? 'name');
      return { field: fields[key] ?? key, message: issue.message };
    }),
  };
}
