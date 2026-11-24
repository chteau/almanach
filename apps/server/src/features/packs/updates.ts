import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { auditLog, instance, packBundles } from '../../db/schema.ts';
import { diffRules, type RuleChange } from './diff.ts';
import { type PackRegistry, PackTooNewError, parseCountryFiles } from './packs.ts';
import { type BundlePayload, type SignedBundle, signedBundleSchema, verifyBundle } from './signing.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DOWNLOAD = 2_500_000;

/** Outcome of an import attempt; `app_too_old` comes with the version the bundle needs and a readable message. */
export type ImportResult =
  | { id: string; country: string; sequence: number }
  | { error: string; minAppVersion?: string; message?: string };

/**
 * Installs, rolls back and periodically fetches signed country pack updates (S-300 to S-304).
 * Only bundles signed by a configured key are accepted, and a bundle never replaces a newer one.
 */
export class PackUpdates {
  private timer: ReturnType<typeof setInterval> | undefined;

  /**
   * @param db {Database} - database
   * @param packs {PackRegistry} - registry updated in place
   * @param trustedKeys {string[]} - Ed25519 public keys allowed to sign packs
   * @param updateUrl {string | undefined} - HTTPS folder to fetch bundles from, if any
   * @param appVersion {string | undefined} - version compared with a bundle's minAppVersion; this server's by default
   */
  constructor(
    private readonly db: Database,
    private readonly packs: PackRegistry,
    private readonly trustedKeys: string[],
    private readonly updateUrl: string | undefined,
    private readonly appVersion?: string,
  ) {}

  /** True when at least one signing key is trusted, so imports are possible. */
  get enabled(): boolean {
    return this.trustedKeys.length > 0;
  }

  /** True when bundles are fetched automatically. */
  get automatic(): boolean {
    return this.enabled && this.updateUrl !== undefined;
  }

  /**
   * Re-applies the active bundles at start-up, checking each signature again
   *
   * @returns {Promise<void>} - resolves when applied
   */
  async restore(): Promise<void> {
    const rows = await this.db.select().from(packBundles).where(eq(packBundles.active, true));
    for (const row of rows) {
      const parsed = this.parse({ payload: row.payload, signature: row.signature, keyId: row.keyId });
      if ('error' in parsed) {
        const reason = parsed.message ?? parsed.error;
        console.warn(`Pack update ${row.country} #${row.sequence} ignored, shipped pack kept: ${reason}`);
        continue;
      }
      this.packs.apply(parsed.meta, parsed.years);
    }
  }

  /**
   * Starts the daily check when an update URL is configured
   *
   * @returns {void} - nothing
   */
  start(): void {
    if (!this.automatic) return;
    // The timer always runs, but nothing is fetched unless an administrator turned the check on (S-244a).
    const run = () =>
      void this.autoCheck()
        .then((on) => (on ? this.check() : undefined))
        .catch((error) => console.warn('Pack update check failed:', error));
    setTimeout(run, 60_000);
    this.timer = setInterval(run, DAY_MS);
  }

  /**
   * Stops the daily check
   *
   * @returns {void} - nothing
   */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Verifies a bundle and validates its YAML with the same schemas as shipped packs
   *
   * @param bundle {SignedBundle} - signed bundle
   * @returns {{ payload: BundlePayload; meta: ReturnType<typeof parseCountryFiles>['meta']; years: ReturnType<typeof parseCountryFiles>['years'] } | { error: string }} - parsed content or error
   */
  private parse(
    bundle: SignedBundle,
  ):
    | ({ payload: BundlePayload } & ReturnType<typeof parseCountryFiles>)
    | { error: string; minAppVersion?: string; message?: string } {
    const verified = verifyBundle(bundle, this.trustedKeys);
    if ('error' in verified) return verified;
    try {
      const parsed = parseCountryFiles(verified.payload.country, verified.payload.files, this.appVersion);
      if (parsed.meta.country !== verified.payload.country) return { error: 'country_mismatch' };
      return { payload: verified.payload, ...parsed };
    } catch (error) {
      if (error instanceof PackTooNewError)
        return { error: 'app_too_old', minAppVersion: error.required, message: error.message };
      return { error: 'invalid_rules' };
    }
  }

  /**
   * Verifies and stores a signed bundle as pending; it is applied only by `activate`
   *
   * @param input {unknown} - bundle as received
   * @param userId {string | null} - administrator, or null for the automatic check
   * @returns {Promise<ImportResult>} - installed bundle or why it was refused
   */
  async import(input: unknown, userId: string | null): Promise<ImportResult> {
    if (!this.enabled) return { error: 'no_trusted_keys' };
    const bundle = signedBundleSchema.safeParse(input);
    if (!bundle.success) return { error: 'invalid_bundle' };
    const parsed = this.parse(bundle.data);
    if ('error' in parsed) return parsed;
    const { country, sequence } = parsed.payload;
    const [latest] = await this.db
      .select({ sequence: packBundles.sequence })
      .from(packBundles)
      .where(eq(packBundles.country, country))
      .orderBy(desc(packBundles.sequence))
      .limit(1);
    // Refusing older sequences stops a replayed, outdated bundle from downgrading the rules.
    if (latest && latest.sequence >= sequence) return { error: 'not_newer' };
    // Stored as pending: nothing changes until someone reads the summary and applies it (S-244b).
    const [row] = await this.db
      .insert(packBundles)
      .values({ country, sequence, ...bundle.data, active: false, installedBy: userId })
      .returning({ id: packBundles.id });
    await this.db.insert(auditLog).values({ userId, action: 'pack.imported', meta: { country, sequence } });
    return { id: row?.id ?? '', country, sequence };
  }

  /**
   * Makes a stored bundle the active one again, e.g. to roll back a faulty update
   *
   * @param id {string} - bundle id
   * @param userId {string} - administrator
   * @returns {Promise<boolean>} - false when unknown or no longer valid
   */
  async activate(id: string, userId: string): Promise<boolean> {
    const [row] = await this.db.select().from(packBundles).where(eq(packBundles.id, id)).limit(1);
    if (!row) return false;
    const parsed = this.parse({ payload: row.payload, signature: row.signature, keyId: row.keyId });
    if ('error' in parsed) return false;
    await this.db.transaction(async (tx) => {
      await tx.update(packBundles).set({ active: false }).where(eq(packBundles.country, row.country));
      await tx
        .update(packBundles)
        .set({ active: true, appliedAt: row.appliedAt ?? new Date() })
        .where(eq(packBundles.id, row.id));
      await tx
        .insert(auditLog)
        .values({ userId, action: 'pack.activated', meta: { country: row.country, sequence: row.sequence } });
    });
    this.packs.apply(parsed.meta, parsed.years);
    return true;
  }

  /**
   * Goes back to the pack shipped with the application
   *
   * @param country {string} - ISO country code
   * @param userId {string} - administrator
   * @returns {Promise<boolean>} - false when no pack of that country is shipped
   */
  async revert(country: string, userId: string): Promise<boolean> {
    if (!this.packs.restoreBuiltin(country)) return false;
    await this.db.update(packBundles).set({ active: false }).where(eq(packBundles.country, country));
    await this.db.insert(auditLog).values({ userId, action: 'pack.reverted', meta: { country } });
    return true;
  }

  /**
   * Lists stored bundles, newest first, without their content. Pending ones come with a plain-language
   * summary of what applying them would change (S-244b, S-244d)
   *
   * @returns {Promise<object[]>} - bundles
   */
  async list() {
    const rows = await this.db
      .select()
      .from(packBundles)
      .orderBy(packBundles.country, desc(packBundles.sequence));
    return rows.map((row) => {
      const payload = JSON.parse(Buffer.from(row.payload, 'base64url').toString('utf8')) as BundlePayload;
      let changes: RuleChange[] | null = null;
      // Why a stored bundle cannot be applied on this instance, e.g. "app_too_old".
      let refused: string | null = null;
      let refusedMinAppVersion: string | null = null;
      if (!row.appliedAt) {
        const parsed = this.parse({ payload: row.payload, signature: row.signature, keyId: row.keyId });
        if ('error' in parsed) {
          refused = parsed.error;
          refusedMinAppVersion = parsed.minAppVersion ?? null;
        } else changes = diffRules(this.packs.yearsOf(row.country), parsed.years);
      }
      return {
        id: row.id,
        country: row.country,
        sequence: row.sequence,
        keyId: row.keyId,
        active: row.active,
        pending: row.appliedAt === null,
        changes,
        refused,
        refusedMinAppVersion,
        installedAt: row.installedAt.toISOString(),
        appliedAt: row.appliedAt?.toISOString() ?? null,
        notes: payload.notes ?? null,
        years: Object.keys(payload.files)
          .map((name) => Number.parseInt(name, 10))
          .filter((year) => !Number.isNaN(year))
          .sort(),
      };
    });
  }

  /**
   * Fetches index.json from the update URL and imports every newer bundle it lists
   *
   * @returns {Promise<{ installed: ImportResult[]; skipped: number }>} - what happened
   */
  async check(): Promise<{ installed: ImportResult[]; skipped: number }> {
    if (!this.automatic || !this.updateUrl) return { installed: [], skipped: 0 };
    const base = this.updateUrl.endsWith('/') ? this.updateUrl : `${this.updateUrl}/`;
    const index = (await this.download(new URL('index.json', base))) as { bundles?: unknown };
    const names = Array.isArray(index.bundles)
      ? index.bundles.filter(
          (name): name is string => typeof name === 'string' && /^[A-Za-z0-9._-]{1,80}\.json$/.test(name),
        )
      : [];
    const installed: ImportResult[] = [];
    let skipped = 0;
    for (const name of names.slice(0, 50)) {
      const result = await this.import(await this.download(new URL(name, base)).catch(() => null), null);
      if ('error' in result) skipped += 1;
      else installed.push(result);
    }
    return { installed, skipped };
  }

  /**
   * Downloads a small JSON file over HTTPS, refusing redirects to other hosts and oversized bodies
   *
   * @param url {URL} - file to fetch
   * @returns {Promise<unknown>} - parsed JSON
   */
  private async download(url: URL): Promise<unknown> {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_DOWNLOAD) throw new Error('too_large');
    return JSON.parse(text);
  }

  /**
   * Tells whether a country currently uses a signed update
   *
   * @param country {string} - ISO country code
   * @returns {Promise<number | null>} - active sequence, or null for the shipped pack
   */
  /**
   * Whether an administrator turned the daily check on
   *
   * @returns {Promise<boolean>} - stored choice, off by default
   */
  async autoCheck(): Promise<boolean> {
    const [row] = await this.db.select({ on: instance.packAutoCheck }).from(instance).limit(1);
    return row?.on ?? false;
  }

  /**
   * Turns the daily update check on or off (S-244a)
   *
   * @param enabled {boolean} - new state
   * @param userId {string} - administrator
   * @returns {Promise<void>} - resolves when saved
   */
  async setAutoCheck(enabled: boolean, userId: string): Promise<void> {
    await this.db.update(instance).set({ packAutoCheck: enabled });
    await this.db.insert(auditLog).values({ userId, action: 'pack.auto_check', meta: { enabled } });
  }

  /**
   * Bundle of a country currently in use
   *
   * @param country {string} - ISO code
   * @returns {Promise<number | null>} - its sequence, or null for the shipped pack
   */
  async activeSequence(country: string): Promise<number | null> {
    const [row] = await this.db
      .select({ sequence: packBundles.sequence })
      .from(packBundles)
      .where(and(eq(packBundles.country, country), eq(packBundles.active, true)))
      .limit(1);
    return row?.sequence ?? null;
  }
}
