import type { Locale, VaultItemView, VaultKindView } from '@almanach/shared';
import type { MessageKey, MessageParams } from '../../i18n/messages.ts';
import { ApiError } from '../../lib/api.ts';

/** Answer of GET /api/vault. */
export interface VaultList {
  items: VaultItemView[];
  kinds: VaultKindView[];
  usage: { bytes: number; quotaBytes: number };
}

type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * Label of a kind: from the pack, or the interface's for the core kinds
 *
 * @param kinds {VaultKindView[]} - kinds offered
 * @param id {string} - kind id
 * @param locale {Locale} - interface language
 * @param t {Translate} - translator
 * @returns {string} - label
 */
export function kindLabel(kinds: VaultKindView[], id: string, locale: Locale, t: Translate): string {
  const kind = kinds.find((item) => item.id === id);
  if (kind?.label) return kind.label[locale];
  return id === 'client_contract' || id === 'other' ? t(`vault.kind.${id}`) : id;
}

/**
 * Sends a file to a vault document
 *
 * @param itemId {string} - document
 * @param file {File} - file chosen
 * @returns {Promise<{ duplicate: boolean }>} - whether the same file was already stored
 */
export async function uploadVaultFile(itemId: string, file: File): Promise<{ duplicate: boolean }> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`/api/vault/${itemId}/file`, {
    method: 'PUT',
    body,
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({ error: 'invalid_response' }));
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

/**
 * Message of a vault refusal, undefined for the generic ones
 *
 * @param problem {unknown} - error thrown
 * @param t {Translate} - translator
 * @returns {string | undefined} - message
 */
export function vaultError(problem: unknown, t: Translate): string | undefined {
  if (!(problem instanceof ApiError)) return undefined;
  const known = ['vault_key_missing', 'vault_quota_exceeded', 'unsupported_file', 'payload_too_large'];
  return known.includes(problem.body.error)
    ? t(`vault.error.${problem.body.error}` as MessageKey)
    : undefined;
}

/**
 * Size in a readable unit
 *
 * @param bytes {number} - size
 * @param locale {string} - interface language
 * @returns {string} - e.g. "1,2 Mo"
 */
export function formatSize(bytes: number, locale: string): string {
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[unit]}`;
}
