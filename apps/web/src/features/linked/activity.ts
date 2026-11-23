import type { LinkedRecords } from '@almanach/shared';

/** Value of the activity filter: '' for every activity, 'here' for this instance, or a link id. */
export type Activity = string;

/** Kinds of records received from a linked instance. */
export type LinkedKind = 'client' | 'document' | 'payment';

/**
 * Tells whether the records of this instance pass the activity filter
 *
 * @param activity {Activity} - filter value
 * @returns {boolean} - true for "all" and "this instance"
 */
export function showsLocal(activity: Activity): boolean {
  return activity === '' || activity === 'here';
}

/**
 * Tells whether the records received through a link pass the activity filter
 *
 * @param activity {Activity} - filter value
 * @param linkId {string} - link the record came through
 * @returns {boolean} - true for "all" and for that link
 */
export function showsLink(activity: Activity, linkId: string): boolean {
  return activity === '' || activity === linkId;
}

/**
 * Name of the activity of each link, for the badges
 *
 * @param linked {LinkedRecords | undefined} - records of the linked instances
 * @returns {Map<string, string>} - label by link id
 */
export function labelsOf(linked: LinkedRecords | undefined): Map<string, string> {
  return new Map((linked?.sources ?? []).map((source) => [source.id, source.label]));
}

/**
 * Path of the read-only record page of a linked record
 *
 * @param kind {LinkedKind} - record kind
 * @param linkId {string} - link
 * @param id {string} - id of the record on the other instance
 * @returns {string} - route path
 */
export function linkedPath(kind: LinkedKind, linkId: string, id: string): string {
  return `/linked/${kind}/${linkId}/${id}`;
}

/**
 * Address of a record on its instance of origin
 *
 * @param base {string | null} - address of the linked instance, when known
 * @param kind {LinkedKind} - record kind
 * @param record {{ id: string; documentId?: string | null }} - record
 * @returns {string | null} - absolute URL, or null when the address is unknown or not web
 */
export function originUrl(
  base: string | null,
  kind: LinkedKind,
  record: { id: string; documentId?: string | null },
): string | null {
  if (!base || !/^https?:\/\//.test(base)) return null;
  const root = base.replace(/\/+$/, '');
  if (kind === 'client') return `${root}/clients/${record.id}`;
  if (kind === 'document') return `${root}/documents/${record.id}`;
  return record.documentId ? `${root}/documents/${record.documentId}` : `${root}/payments`;
}
