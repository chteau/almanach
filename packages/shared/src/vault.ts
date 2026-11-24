import { z } from 'zod';
import { activityRefSchema } from './activities.ts';
import { isoDateSchema } from './common.ts';
import type { Localized } from './rules.ts';

/** Kinds every country has: a contract with a client, and anything else. */
export const CORE_VAULT_KINDS = ['client_contract', 'other'] as const;

/** Files the vault accepts, recognised by their first bytes; no SVG or HTML (active content). */
export const VAULT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export const VAULT_FILE_MAX_BYTES = 8 * 1024 * 1024;

/** Metadata of a vault document as entered. */
export const vaultItemInputSchema = z
  .object({
    kind: z.string().regex(/^[a-z0-9_]{1,40}$/),
    title: z.string().trim().min(1).max(200),
    activityId: activityRefSchema,
    clientId: z.uuid().nullable().default(null),
    missionId: z.uuid().nullable().default(null),
    issuedOn: isoDateSchema.nullable().default(null),
    expiresOn: isoDateSchema.nullable().default(null),
    remindDays: z.array(z.number().int().min(0).max(365)).max(6).nullable().default(null),
    notes: z.string().trim().max(2000).default(''),
  })
  .strict();

export type VaultItemInput = z.infer<typeof vaultItemInputSchema>;

/** A stored file of a vault document. */
export interface VaultFileView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  /** Set on a replaced version, kept one year after. */
  supersededAt: string | null;
}

/** A vault document as the API returns it; files only on the detail. */
export interface VaultItemView extends VaultItemInput {
  id: string;
  file: VaultFileView | null;
  versions?: VaultFileView[];
  status: 'expired' | 'expiring' | 'valid' | 'undated';
}

/** A kind the vault proposes, from the pack or the core. */
export interface VaultKindView {
  id: string;
  label: Localized | null;
  expires: boolean;
  remindDays: number[];
}
