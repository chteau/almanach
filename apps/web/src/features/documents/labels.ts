import type { BadgeTone } from '../../components/Badge/Badge.tsx';

/** Badge tone for each document status; the text always states the status too. */
export const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  issued: 'accent',
  sent: 'accent',
  partially_paid: 'warn',
  paid: 'ok',
  overdue: 'err',
  cancelled: 'neutral',
  accepted: 'ok',
  declined: 'neutral',
  expired: 'warn',
};

/**
 * Route segment listing a document type
 *
 * @param type {string} - document type
 * @returns {string} - list path
 */
export function listPath(type: string): string {
  return type === 'quote' ? '/quotes' : type === 'credit_note' ? '/credit-notes' : '/invoices';
}

/**
 * Parses a quantity typed with comma or dot decimals into thousandths
 *
 * @param input {string} - quantity as typed, e.g. "1,5"
 * @returns {number | null} - quantity × 1000, or null when invalid or zero
 */
export function parseQuantity(input: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(input.replace(/\s/g, ''));
  if (!match?.[1]) return null;
  const value = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  return value > 0 && value <= 1_000_000_000 ? value : null;
}

/**
 * Parses a percentage typed by a person into basis points
 *
 * @param input {string} - e.g. "10" or "12,5"
 * @returns {number | null} - basis points between 0 and 10000, or null when invalid
 */
export function parsePercent(input: string): number | null {
  if (!input.trim()) return 0;
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match?.[1]) return null;
  const value = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return value <= 10_000 ? value : null;
}

/**
 * Builds a CSV file content with quoting safe against spreadsheet formula injection
 *
 * @param rows {(string | number)[][]} - header row first
 * @returns {string} - CSV text
 */
export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          let text = String(cell);
          if (/^[=+\-@\t\r]/.test(text) && typeof cell === 'string') text = `'${text}`;
          return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(','),
    )
    .join('\n');
}
