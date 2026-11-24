import { createHash } from 'node:crypto';
import {
  addDays,
  CORE_VAULT_KINDS,
  daysBetween,
  idSchema,
  packFeatures,
  VAULT_FILE_MAX_BYTES,
  type VaultFileView,
  type VaultItemInput,
  type VaultItemView,
  type VaultKindView,
  vaultItemInputSchema,
  type WeeklyReview,
} from '@almanach/shared';
import { and, asc, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { auditLog, clients, missions, type notifications, vaultFiles, vaultItems } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import { decryptBytes, encryptBytes, vaultKey } from '../../security/secrets.ts';
import { ownsActivity } from '../activities/activities.ts';
import type { PlanningService } from '../planning/planning.service.ts';
import { dueOffset } from '../planning/reminders.ts';

/** A document is "expiring" within this many days. */
const EXPIRING_DAYS = 60;
/** A replaced file is kept this long before it is purged. */
const KEEP_OLD_VERSION_DAYS = 365;

type ItemRow = typeof vaultItems.$inferSelect;
type FileRow = Omit<typeof vaultFiles.$inferSelect, 'data'>;

/**
 * Recognises an accepted file by its first bytes, whatever its name or declared type
 *
 * @param bytes {Uint8Array} - file content
 * @returns {'application/pdf' | 'image/png' | 'image/jpeg' | null} - its type, null when refused
 */
export function detectMime(bytes: Uint8Array): 'application/pdf' | 'image/png' | 'image/jpeg' | null {
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  return null;
}

/**
 * Status of a document on a date
 *
 * @param expiresOn {string | null} - expiry date
 * @param today {string} - YYYY-MM-DD
 * @returns {VaultItemView['status']} - expired, expiring within 60 days, valid or undated
 */
export function vaultStatus(expiresOn: string | null, today: string): VaultItemView['status'] {
  if (!expiresOn) return 'undated';
  if (expiresOn < today) return 'expired';
  return expiresOn <= addDays(today, EXPIRING_DAYS) ? 'expiring' : 'valid';
}

const fileView = (row: FileRow): VaultFileView => ({
  id: row.id,
  fileName: row.fileName,
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes,
  sha256: row.sha256,
  createdAt: row.createdAt.toISOString(),
  supersededAt: row.supersededAt?.toISOString() ?? null,
});

const fileColumns = {
  id: vaultFiles.id,
  itemId: vaultFiles.itemId,
  fileName: vaultFiles.fileName,
  mimeType: vaultFiles.mimeType,
  sizeBytes: vaultFiles.sizeBytes,
  sha256: vaultFiles.sha256,
  createdAt: vaultFiles.createdAt,
  supersededAt: vaultFiles.supersededAt,
};

/** Document vault: metadata, encrypted files, kinds from the pack, quota and reminders. */
export class VaultService {
  /**
   * Creates the service
   *
   * @param db {Database} - Drizzle database
   * @param planning {PlanningService} - profile, activities and packs
   * @param secretsKey {Buffer | undefined} - SECRETS_KEY; without it files are refused
   * @param quotaBytes {number} - space of the vault on the whole instance
   */
  constructor(
    private readonly db: Database,
    private readonly planning: PlanningService,
    private readonly secretsKey: Buffer | undefined,
    readonly quotaBytes: number,
  ) {}

  /**
   * Kinds the vault proposes to a company: those of its pack that apply, then the core ones
   *
   * @param companyId {string} - company
   * @returns {Promise<VaultKindView[]>} - kinds
   */
  async kinds(companyId: string): Promise<VaultKindView[]> {
    const profile = await this.planning.profile(companyId);
    const pack = profile ? this.planning.packs.get(profile.country) : undefined;
    const statuses = profile ? [profile.status, ...(await this.planning.activities(companyId))] : [];
    const own = (pack && packFeatures(pack).vault_types ? (pack.vault?.kinds ?? []) : []).filter(
      (kind) =>
        (!kind.appliesTo?.statuses || kind.appliesTo.statuses.some((status) => statuses.includes(status))) &&
        (!kind.appliesTo?.options ||
          kind.appliesTo.options.some((option) => profile?.options.includes(option))),
    );
    return [
      ...own.map((kind) => ({
        id: kind.id,
        label: kind.label,
        expires: kind.expires,
        remindDays: kind.remindDays,
      })),
      { id: 'client_contract', label: null, expires: true, remindDays: [30] },
      { id: 'other', label: null, expires: false, remindDays: [30, 7] },
    ];
  }

  /**
   * Bytes stored by the vault on the instance, old versions included
   *
   * @returns {Promise<number>} - bytes
   */
  async usage(): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${vaultFiles.sizeBytes}), 0)` })
      .from(vaultFiles);
    return Number(row?.total ?? 0);
  }

  /** Removes the versions replaced more than a year ago. */
  async purge(): Promise<void> {
    await this.db
      .delete(vaultFiles)
      .where(
        and(
          isNotNull(vaultFiles.supersededAt),
          lt(vaultFiles.supersededAt, new Date(Date.now() - KEEP_OLD_VERSION_DAYS * 86_400_000)),
        ),
      );
  }

  /**
   * Documents of a company with their current file
   *
   * @param companyId {string} - company
   * @param today {string} - YYYY-MM-DD
   * @returns {Promise<VaultItemView[]>} - documents, the soonest to expire first
   */
  async list(companyId: string, today: string): Promise<VaultItemView[]> {
    const items = await this.db
      .select()
      .from(vaultItems)
      .where(eq(vaultItems.companyId, companyId))
      .orderBy(sql`${vaultItems.expiresOn} asc nulls last`, asc(vaultItems.title));
    const files = await this.db
      .select(fileColumns)
      .from(vaultFiles)
      .innerJoin(vaultItems, eq(vaultItems.id, vaultFiles.itemId))
      .where(and(eq(vaultItems.companyId, companyId), isNull(vaultFiles.supersededAt)));
    return items.map((item) => this.view(item, files.find((file) => file.itemId === item.id) ?? null, today));
  }

  /**
   * One document with every stored version
   *
   * @param companyId {string} - company
   * @param id {string} - document
   * @param today {string} - YYYY-MM-DD
   * @returns {Promise<VaultItemView | null>} - the document, null when not the company's
   */
  async get(companyId: string, id: string, today: string): Promise<VaultItemView | null> {
    const [item] = await this.db
      .select()
      .from(vaultItems)
      .where(and(eq(vaultItems.id, id), eq(vaultItems.companyId, companyId)));
    if (!item) return null;
    const versions = await this.db
      .select(fileColumns)
      .from(vaultFiles)
      .where(eq(vaultFiles.itemId, id))
      .orderBy(desc(vaultFiles.createdAt));
    return {
      ...this.view(item, versions.find((file) => !file.supersededAt) ?? null, today),
      versions: versions.map(fileView),
    };
  }

  /**
   * Shapes a row for the API
   *
   * @param item {ItemRow} - document
   * @param file {FileRow | null} - current file
   * @param today {string} - YYYY-MM-DD
   * @returns {VaultItemView} - view
   */
  private view(item: ItemRow, file: FileRow | null, today: string): VaultItemView {
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      activityId: item.activityId,
      clientId: item.clientId,
      missionId: item.missionId,
      issuedOn: item.issuedOn,
      expiresOn: item.expiresOn,
      remindDays: item.remindDays,
      notes: item.notes,
      file: file && fileView(file),
      status: vaultStatus(item.expiresOn, today),
    };
  }

  /**
   * Stores a new version of a document's file, encrypted; the previous one is kept a year
   *
   * @param companyId {string} - company
   * @param itemId {string} - document
   * @param name {string} - file name
   * @param bytes {Uint8Array} - content
   * @returns {Promise<{ file: VaultFileView; duplicate: boolean } | { error: string; status: 409 | 413 | 415 | 507 }>} - stored file or refusal
   */
  async store(
    companyId: string,
    itemId: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<{ file: VaultFileView; duplicate: boolean } | { error: string; status: 409 | 413 | 415 | 507 }> {
    if (!this.secretsKey) return { error: 'vault_key_missing', status: 409 };
    if (bytes.length > VAULT_FILE_MAX_BYTES) return { error: 'payload_too_large', status: 413 };
    const mimeType = detectMime(bytes);
    if (!mimeType) return { error: 'unsupported_file', status: 415 };
    await this.purge();
    if ((await this.usage()) + bytes.length > this.quotaBytes)
      return { error: 'vault_quota_exceeded', status: 507 };
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const [same] = await this.db
      .select({ id: vaultFiles.id })
      .from(vaultFiles)
      .innerJoin(vaultItems, eq(vaultItems.id, vaultFiles.itemId))
      .where(and(eq(vaultItems.companyId, companyId), eq(vaultFiles.sha256, sha256)))
      .limit(1);
    const data = encryptBytes(bytes, vaultKey(this.secretsKey));
    const fileName = name.replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120) || 'document';
    const stored = await this.db.transaction(async (tx) => {
      await tx
        .update(vaultFiles)
        .set({ supersededAt: new Date() })
        .where(and(eq(vaultFiles.itemId, itemId), isNull(vaultFiles.supersededAt)));
      const [row] = await tx
        .insert(vaultFiles)
        .values({ itemId, fileName, mimeType, sizeBytes: bytes.length, sha256, data })
        .returning(fileColumns);
      await tx.update(vaultItems).set({ updatedAt: new Date() }).where(eq(vaultItems.id, itemId));
      return row;
    });
    if (!stored) throw new Error('vault_file_not_stored');
    return { file: fileView(stored), duplicate: Boolean(same) };
  }

  /**
   * Reads a file of a document, the current one or an older version
   *
   * @param companyId {string} - company
   * @param itemId {string} - document
   * @param fileId {string | undefined} - version, the current one by default
   * @returns {Promise<{ name: string; mimeType: string; bytes: Buffer } | { error: string }>} - content or problem
   */
  async read(
    companyId: string,
    itemId: string,
    fileId?: string,
  ): Promise<{ name: string; mimeType: string; bytes: Buffer } | { error: string }> {
    const [row] = await this.db
      .select({ name: vaultFiles.fileName, mimeType: vaultFiles.mimeType, data: vaultFiles.data })
      .from(vaultFiles)
      .innerJoin(vaultItems, eq(vaultItems.id, vaultFiles.itemId))
      .where(
        and(
          eq(vaultItems.companyId, companyId),
          eq(vaultFiles.itemId, itemId),
          fileId ? eq(vaultFiles.id, fileId) : isNull(vaultFiles.supersededAt),
        ),
      );
    if (!row) return { error: 'not_found' };
    if (!this.secretsKey) return { error: 'vault_key_missing' };
    try {
      return {
        name: row.name,
        mimeType: row.mimeType,
        bytes: decryptBytes(row.data, vaultKey(this.secretsKey)),
      };
    } catch {
      return { error: 'vault_file_unreadable' };
    }
  }

  /**
   * Weekly review section: documents expired or expiring within 60 days
   *
   * @param companyId {string} - company
   * @param today {string} - YYYY-MM-DD
   * @returns {Promise<WeeklyReview['vault']>} - the section
   */
  async review(companyId: string, today: string): Promise<WeeklyReview['vault']> {
    const items = (await this.list(companyId, today)).filter((item) => item.expiresOn);
    const brief = (item: VaultItemView) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
      expiresOn: item.expiresOn ?? '',
    });
    return {
      expiringWithin60Days: items.filter((item) => item.status === 'expiring').map(brief),
      expired: items.filter((item) => item.status === 'expired').map(brief),
    };
  }

  /**
   * Notifications for documents about to expire (offsets of the document or its kind) and expired ones
   *
   * @param companyId {string} - company
   * @param today {string} - YYYY-MM-DD
   * @returns {Promise<(typeof notifications.$inferInsert)[]>} - rows to insert, deduplicated by key
   */
  async reminders(companyId: string, today: string): Promise<(typeof notifications.$inferInsert)[]> {
    const kinds = await this.kinds(companyId);
    const rows: (typeof notifications.$inferInsert)[] = [];
    const items = await this.db
      .select()
      .from(vaultItems)
      .where(and(eq(vaultItems.companyId, companyId), isNotNull(vaultItems.expiresOn)));
    for (const item of items) {
      const expiresOn = item.expiresOn as string;
      const left = daysBetween(today, expiresOn);
      const link = `/vault/${item.id}`;
      const params = { title: item.title, date: expiresOn, days: left };
      if (left < 0) {
        rows.push({
          companyId,
          kind: 'vault_expired',
          dedupeKey: `vault:${item.id}:${expiresOn}:expired`,
          params,
          link,
        });
        continue;
      }
      const offsets = item.remindDays ?? kinds.find((kind) => kind.id === item.kind)?.remindDays ?? [30, 7];
      const offset = dueOffset(left, offsets);
      if (offset !== null)
        rows.push({
          companyId,
          kind: 'vault_expiring',
          dedupeKey: `vault:${item.id}:${expiresOn}:${offset}`,
          params,
          link,
        });
    }
    return rows;
  }
}

/**
 * Builds /api/vault. Mount behind requireUser and requireCompany.
 *
 * @param db {Database} - Drizzle database
 * @param vault {VaultService} - the vault
 * @param today {() => Promise<string>} - today in the instance time zone
 * @returns {Hono<AppEnv>} - the router
 */
export function vaultRoutes(db: Database, vault: VaultService, today: () => Promise<string>): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const audit = (userId: string, action: string, meta: Record<string, unknown>) =>
    db.insert(auditLog).values({ userId, action, meta });

  router.get('/', async (c) =>
    c.json({
      items: await vault.list(c.var.company.id, await today()),
      kinds: await vault.kinds(c.var.company.id),
      usage: { bytes: await vault.usage(), quotaBytes: vault.quotaBytes },
    }),
  );

  router.get('/kinds', async (c) => c.json({ kinds: await vault.kinds(c.var.company.id) }));

  /**
   * Validates the metadata of a document and what it points to
   *
   * @param companyId {string} - company
   * @param data {VaultItemInput} - validated input
   * @returns {Promise<string | null>} - problem, null when fine
   */
  async function referenceProblem(companyId: string, data: VaultItemInput): Promise<string | null> {
    const kinds = await vault.kinds(companyId);
    if (
      !kinds.some((kind) => kind.id === data.kind) &&
      !(CORE_VAULT_KINDS as readonly string[]).includes(data.kind)
    )
      return 'unknown_kind';
    if (!(await ownsActivity(db, companyId, data.activityId))) return 'unknown_activity';
    if (data.clientId) {
      const [row] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, data.clientId), eq(clients.companyId, companyId)));
      if (!row) return 'unknown_client';
    }
    if (data.missionId) {
      const [row] = await db
        .select({ id: missions.id })
        .from(missions)
        .where(and(eq(missions.id, data.missionId), eq(missions.companyId, companyId)));
      if (!row) return 'unknown_mission';
    }
    return null;
  }

  router.post('/', async (c) => {
    const { data, response } = await parseBody(c, vaultItemInputSchema);
    if (response) return response;
    const problem = await referenceProblem(c.var.company.id, data);
    if (problem) return c.json({ error: problem }, 422);
    const [row] = await db
      .insert(vaultItems)
      .values({ ...data, companyId: c.var.company.id })
      .returning({ id: vaultItems.id });
    return c.json({ item: row && (await vault.get(c.var.company.id, row.id, await today())) }, 201);
  });

  router.get('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    const item = id.success ? await vault.get(c.var.company.id, id.data, await today()) : null;
    return item ? c.json({ item }) : c.json({ error: 'not_found' }, 404);
  });

  router.put('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const { data, response } = await parseBody(c, vaultItemInputSchema);
    if (response) return response;
    const problem = await referenceProblem(c.var.company.id, data);
    if (problem) return c.json({ error: problem }, 422);
    const updated = await db
      .update(vaultItems)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(vaultItems.id, id.data), eq(vaultItems.companyId, c.var.company.id)))
      .returning({ id: vaultItems.id });
    if (updated.length === 0) return c.json({ error: 'not_found' }, 404);
    return c.json({ item: await vault.get(c.var.company.id, id.data, await today()) });
  });

  router.delete('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const removed = await db
      .delete(vaultItems)
      .where(and(eq(vaultItems.id, id.data), eq(vaultItems.companyId, c.var.company.id)))
      .returning({ id: vaultItems.id });
    if (removed.length === 0) return c.json({ error: 'not_found' }, 404);
    await audit(c.var.user.id, 'vault.delete', { id: id.data, company: c.var.company.id });
    return c.body(null, 204);
  });

  router.put('/:id/file', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    const item = id.success ? await vault.get(c.var.company.id, id.data, await today()) : null;
    if (!item) return c.json({ error: 'not_found' }, 404);
    const body = await c.req.parseBody().catch(() => null);
    const file = body?.file;
    if (!(file instanceof File))
      return c.json({ error: 'validation_failed', issues: [{ path: 'file' }] }, 422);
    const result = await vault.store(
      c.var.company.id,
      item.id,
      file.name,
      new Uint8Array(await file.arrayBuffer()),
    );
    if ('error' in result) return c.json({ error: result.error }, result.status);
    await audit(c.var.user.id, 'vault.upload', {
      id: item.id,
      company: c.var.company.id,
      size: result.file.sizeBytes,
    });
    return c.json(result, 201);
  });

  router.get('/:id/file', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    const version = c.req.query('version');
    if (!id.success || (version !== undefined && !idSchema.safeParse(version).success))
      return c.json({ error: 'not_found' }, 404);
    const result = await vault.read(c.var.company.id, id.data, version);
    if ('error' in result) return c.json({ error: result.error }, result.error === 'not_found' ? 404 : 409);
    await audit(c.var.user.id, 'vault.download', { id: id.data, company: c.var.company.id });
    return c.body(new Uint8Array(result.bytes), 200, {
      'Content-Type': result.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`,
      'X-Content-Type-Options': 'nosniff',
    });
  });

  return router;
}
