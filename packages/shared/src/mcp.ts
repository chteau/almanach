import { z } from 'zod';

/**
 * What a personal access token may do on /mcp: read; or also create clients and drafts; or also write the
 * pipeline (deals and follow-ups), a separate scope never granted by the other two.
 */
export const TOKEN_SCOPES = ['read', 'read_drafts', 'read_pipeline'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** Creating a personal access token. */
export const apiTokenInputSchema = z
  .object({ name: z.string().trim().min(1).max(60), scope: z.enum(TOKEN_SCOPES) })
  .strict();

/** A personal access token as listed in the security settings; the token itself is shown once. */
export interface ApiToken {
  id: string;
  name: string;
  scope: TokenScope;
  createdAt: string;
  lastUsedAt: string | null;
}
