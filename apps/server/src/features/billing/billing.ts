import {
  billingSettingsSchema,
  defaultNumberFormat,
  formatForYear,
  formatNumber,
  LOGO_MAX_BYTES,
  logoSchema,
  type NumberFormat,
  type NumberFormatPeriod,
  numberFormatSchema,
} from '@almanach/shared';
import { and, eq, inArray, max, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Database } from '../../db/client.ts';
import { auditLog, billingSettings, documents, profiles } from '../../db/schema.ts';
import { parseBody } from '../../http/errors.ts';
import type { AppEnv } from '../../http/request.ts';
import { ownerOf } from '../companies/companies.ts';
import { type PdfStyle, renderPdf } from '../documents/pdf.ts';
import { instanceToday } from '../planning/planning.routes.ts';

/** Billing preferences once defaults are filled in. */
export interface BillingView {
  numbering: NumberFormatPeriod[];
  pdf: Omit<PdfStyle, 'logo'>;
  defaultTermsDays: number;
  defaultNote: string | null;
  hasLogo: boolean;
}

/** Classic look, close to the original documents. */
const DEFAULT_PDF: BillingView['pdf'] = { accent: '#c2410c', layout: 'classic', font: 'sans' };

/**
 * Loads the billing preferences of a person, with defaults for anything never chosen
 *
 * @param db {Database} - database or transaction
 * @param companyId {string} - owner
 * @param country {string} - country of the profile, for default prefixes
 * @returns {Promise<BillingView & { logo: PdfStyle['logo'] }>} - preferences and decoded logo
 */
export async function loadBilling(
  db: Pick<Database, 'select'>,
  companyId: string,
  country: string,
): Promise<BillingView & { logo: PdfStyle['logo'] }> {
  const [row] = await db
    .select()
    .from(billingSettings)
    .where(eq(billingSettings.companyId, companyId))
    .limit(1);
  const mime = row?.logoMime === 'image/png' || row?.logoMime === 'image/jpeg' ? row.logoMime : null;
  const logo: PdfStyle['logo'] =
    row?.logo && mime ? { mime, bytes: new Uint8Array(Buffer.from(row.logo, 'base64')) } : null;
  return {
    numbering: row?.numbering ?? [{ ...defaultNumberFormat(country), fromYear: 0 }],
    pdf: row?.pdf ?? DEFAULT_PDF,
    defaultTermsDays: row?.defaultTermsDays ?? 30,
    defaultNote: row?.defaultNote ?? null,
    hasLogo: Boolean(logo),
    logo,
  };
}

/**
 * Numbering format in force for a year, falling back to the country default
 *
 * @param periods {NumberFormatPeriod[]} - stored formats
 * @param year {number} - year of the document
 * @param country {string} - country of the profile
 * @returns {NumberFormat} - format to use
 */
export function numberingFor(periods: NumberFormatPeriod[], year: number, country: string): NumberFormat {
  const found = formatForYear(periods, year);
  if (!found) return defaultNumberFormat(country);
  const { fromYear: _fromYear, ...format } = found as NumberFormatPeriod;
  return format;
}

/**
 * Checks the magic bytes of an uploaded image, so only real PNG and JPEG files are stored
 *
 * @param bytes {Uint8Array} - decoded file
 * @param mime {'image/png' | 'image/jpeg'} - declared type
 * @returns {boolean} - true when the content matches the type
 */
export function isImage(bytes: Uint8Array, mime: 'image/png' | 'image/jpeg'): boolean {
  if (mime === 'image/png')
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte);
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Largest logo side, in pixels: a small file can still decode into a huge bitmap on every PDF. */
export const LOGO_MAX_SIDE = 2000;

/**
 * Reads the pixel size of a PNG or JPEG from its header
 *
 * @param bytes {Uint8Array} - decoded file
 * @param mime {'image/png' | 'image/jpeg'} - type, already checked with isImage
 * @returns {{ width: number; height: number } | null} - size, or null when the header cannot be read
 */
export function imageSize(
  bytes: Uint8Array,
  mime: 'image/png' | 'image/jpeg',
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png')
    return bytes.length >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : null;
  // JPEG: walk the segments up to a start-of-frame marker, which holds the size.
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

/**
 * Stores the current numbering explicitly when the account still relies on the country default, so a
 * later change of country never changes the numbers of a series already started
 *
 * @param db {Pick<Database, 'insert'>} - database or transaction
 * @param companyId {string} - owner
 * @param country {string} - country the numbers were given under
 * @returns {Promise<void>} - resolves when saved
 */
export async function pinNumbering(
  db: Pick<Database, 'insert'>,
  companyId: string,
  country: string,
): Promise<void> {
  await db
    .insert(billingSettings)
    .values({
      companyId,
      numbering: [{ ...defaultNumberFormat(country), fromYear: 0 }],
      pdf: DEFAULT_PDF,
      defaultTermsDays: 30,
      defaultNote: null,
    })
    .onConflictDoNothing({ target: billingSettings.companyId });
}

/**
 * Billing settings routes (S-234 to S-236), mounted behind requireUser on /api/billing
 *
 * @param db {Database} - database
 * @returns {Hono<AppEnv>} - router
 */
export function billingRoutes(db: Database): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * Country of the profile, or undefined before onboarding
   *
   * @param companyId {string} - owner
   * @returns {Promise<string | undefined>} - country code
   */
  const countryOf = async (companyId: string): Promise<string | undefined> =>
    (
      await db
        .select({ country: profiles.country })
        .from(profiles)
        .where(eq(profiles.companyId, companyId))
        .limit(1)
    )[0]?.country;

  /**
   * Latest year an invoice, deposit or credit note was numbered in: the numbering then only changes after it
   *
   * @param companyId {string} - owner
   * @returns {Promise<number | null>} - year, or null when no number was given yet
   */
  const numberedUntil = async (companyId: string): Promise<number | null> => {
    const [row] = await db
      .select({ last: max(documents.issueDate) })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          inArray(documents.type, ['invoice', 'deposit', 'credit_note']),
          ne(documents.state, 'draft'),
        ),
      );
    return row?.last ? Number(row.last.slice(0, 4)) : null;
  };

  router.get('/', async (c) => {
    const country = await countryOf(c.var.company.id);
    if (!country) return c.json({ error: 'no_profile' }, 409);
    const { logo: _logo, ...settings } = await loadBilling(db, c.var.company.id, country);
    const year = Number((await instanceToday(db)).slice(0, 4));
    return c.json({
      settings,
      year,
      locked: (await numberedUntil(c.var.company.id)) !== null,
      current: numberingFor(settings.numbering, year, country),
      next: numberingFor(settings.numbering, year + 1, country),
    });
  });

  router.put('/', async (c) => {
    const companyId = c.var.company.id;
    const country = await countryOf(companyId);
    if (!country) return c.json({ error: 'no_profile' }, 409);
    const { data, response } = await parseBody(c, billingSettingsSchema);
    if (response) return response;
    const year = Number((await instanceToday(db)).slice(0, 4));
    const existing = await loadBilling(db, companyId, country);
    let numbering: NumberFormatPeriod[];
    let appliesFrom: number | null = null;
    const until = await numberedUntil(companyId);
    if (until === null) numbering = [{ ...data.numbering, fromYear: 0 }];
    else {
      // A year that already has numbers must stay one unbroken sequence, documents dated ahead included.
      const last = Math.max(year, until);
      const kept = existing.numbering.filter((period) => period.fromYear <= last);
      const current = numberingFor(kept, last, country);
      const same = JSON.stringify(numberFormatSchema.parse(current)) === JSON.stringify(data.numbering);
      numbering = same ? kept : [...kept, { ...data.numbering, fromYear: last + 1 }];
      if (!same) appliesFrom = last + 1;
    }
    const values = {
      numbering,
      pdf: data.pdf,
      defaultTermsDays: data.defaultTermsDays,
      defaultNote: data.defaultNote ?? null,
      updatedAt: new Date(),
    };
    await db
      .insert(billingSettings)
      .values({ companyId, ...values })
      .onConflictDoUpdate({ target: billingSettings.companyId, set: values });
    await db
      .insert(auditLog)
      .values({ userId: ownerOf(companyId), action: 'billing.updated', meta: { appliesFrom } });
    return c.json({ ok: true, appliesFrom });
  });

  router.put('/logo', async (c) => {
    const companyId = c.var.company.id;
    const country = await countryOf(companyId);
    if (!country) return c.json({ error: 'no_profile' }, 409);
    const { data, response } = await parseBody(c, logoSchema);
    if (response) return response;
    const bytes = new Uint8Array(Buffer.from(data.data, 'base64'));
    if (bytes.length > LOGO_MAX_BYTES) return c.json({ error: 'logo_too_large' }, 413);
    const size = isImage(bytes, data.mime) ? imageSize(bytes, data.mime) : null;
    if (!size || size.width > LOGO_MAX_SIDE || size.height > LOGO_MAX_SIDE)
      return c.json({ error: 'invalid_image' }, 422);
    const existing = await loadBilling(db, companyId, country);
    const { hasLogo: _has, logo: _old, ...rest } = existing;
    await db
      .insert(billingSettings)
      .values({ companyId, ...rest, logo: data.data, logoMime: data.mime })
      .onConflictDoUpdate({
        target: billingSettings.companyId,
        set: { logo: data.data, logoMime: data.mime, updatedAt: new Date() },
      });
    return c.body(null, 204);
  });

  router.delete('/logo', async (c) => {
    await db
      .update(billingSettings)
      .set({ logo: null, logoMime: null, updatedAt: new Date() })
      .where(eq(billingSettings.companyId, c.var.company.id));
    return c.body(null, 204);
  });

  router.get('/logo', async (c) => {
    const country = await countryOf(c.var.company.id);
    const logo = country ? (await loadBilling(db, c.var.company.id, country)).logo : null;
    if (!logo) return c.json({ error: 'not_found' }, 404);
    return new Response(logo.bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        'Content-Type': logo.mime,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  router.get('/preview.pdf', async (c) => {
    const companyId = c.var.company.id;
    const [profile] = await db.select().from(profiles).where(eq(profiles.companyId, companyId)).limit(1);
    if (!profile) return c.json({ error: 'no_profile' }, 409);
    const { pdf, logo, numbering, defaultNote } = await loadBilling(db, companyId, profile.country);
    const today = await instanceToday(db);
    const year = Number(today.slice(0, 4));
    const language = c.var.user.locale === 'de' || c.var.user.locale === 'en' ? c.var.user.locale : 'fr';
    const bytes = await renderPdf({
      type: 'invoice',
      draft: false,
      number: formatNumber(numberingFor(numbering, year, profile.country), 'invoice', year, 1),
      relatedNumber: null,
      issueDate: today,
      dueDate: today,
      validUntil: null,
      language,
      currency: profile.currency,
      lines: [
        {
          description: 'Exemple · Example · Beispiel',
          quantity: 3000,
          unit: 'day',
          unitPriceCents: 50_000,
          discountBp: 0,
        },
      ],
      totals: {
        linesCents: 150_000,
        discountCents: 0,
        netCents: 150_000,
        vatRateBp: 0,
        vatCents: 0,
        depositsCents: 0,
        totalCents: 150_000,
      },
      mentions: [],
      note: defaultNote,
      seller: {
        name: profile.company.name,
        address: profile.company.address,
        country: profile.country,
        email: profile.company.email,
        vatNumber: null,
        identifiers: profile.identifiers,
        bank: profile.bank,
      },
      buyer: {
        name: 'Client',
        address: '1 rue Exemple\n75000 Paris',
        country: 'FR',
        email: null,
        vatNumber: null,
        identifiers: {},
      },
      style: { ...pdf, logo },
    });
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="preview.pdf"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  return router;
}
