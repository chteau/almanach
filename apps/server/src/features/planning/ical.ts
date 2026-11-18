import { addDays, type Locale } from '@almanach/shared';
import type { CalendarItem } from './planning.service.ts';

/**
 * Escapes text for an iCalendar property value (RFC 5545 §3.3.11)
 *
 * @param text {string} - raw text
 * @returns {string} - escaped text
 */
function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/**
 * Folds a content line to at most 75 octets per physical line (RFC 5545 §3.1)
 *
 * @param line {string} - unfolded line
 * @returns {string} - folded line with CRLF and a leading space on continuation lines
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  for (const char of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (encoder.encode(current + char).length > limit) {
      parts.push(current);
      current = char;
    } else current += char;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/**
 * Formats a UTC timestamp as an iCalendar DATE-TIME
 *
 * @param date {Date} - instant
 * @returns {string} - e.g. 20261118T101500Z
 */
function stamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * Renders calendar entries as an iCalendar feed of all-day events, compatible with Google Calendar,
 * Apple Calendar and Thunderbird (P05 S-068)
 *
 * @param items {CalendarItem[]} - entries to publish
 * @param now {Date} - generation time, used for DTSTAMP
 * @param locale {Locale} - language of pack labels
 * @returns {string} - text/calendar content with CRLF line endings
 */
export function renderIcal(items: CalendarItem[], now: Date, locale: Locale): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Almanach//Deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Almanach',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
  ];
  for (const item of items) {
    const title = typeof item.title === 'string' ? item.title : item.title[locale];
    lines.push(
      'BEGIN:VEVENT',
      `UID:${item.key.replace(/[^A-Za-z0-9:_-]/g, '')}@almanach`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${item.date.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${addDays(item.date, 1).replace(/-/g, '')}`,
      `SUMMARY:${escapeText(item.done ? `✓ ${title}` : title)}`,
      `CATEGORIES:${item.type.toUpperCase()}`,
      'TRANSP:TRANSPARENT',
    );
    if (item.link?.startsWith('https://')) lines.push(`URL:${item.link}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
