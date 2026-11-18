import type { Locale, PackMeta, VatMode, VatSituation } from '@almanach/shared';

/**
 * Picks the VAT treatment of a document from the pack, the seller's options and the client's
 * situation (S-164): franchise, national rate, reverse charge within the EU, or export
 *
 * @param pack {PackMeta | undefined} - seller's country pack, undefined in generic mode
 * @param options {string[]} - options chosen in the seller's profile
 * @param situation {VatSituation} - client's situation relative to the seller
 * @param clientKind {'company' | 'individual'} - business or private client
 * @returns {VatMode} - VAT treatment
 */
export function vatModeFor(
  pack: PackMeta | undefined,
  options: string[],
  situation: VatSituation,
  clientKind: 'company' | 'individual',
): VatMode {
  if (!pack) return 'none';
  const { toggle, defaultMode } = pack.invoice;
  const base = toggle && options.includes(toggle.option) ? toggle.mode : defaultMode;
  if (base === 'franchise') return 'franchise';
  if (situation === 'eu_b2b') return base === 'standard' ? 'reverse_charge' : base;
  if (situation === 'non_eu' && clientKind === 'company')
    return pack.invoice.mentions.export ? 'export' : base;
  return base;
}

/**
 * VAT rate applied for a treatment
 *
 * @param pack {PackMeta | undefined} - seller's country pack
 * @param mode {VatMode} - VAT treatment
 * @returns {number} - rate in basis points, 0 unless the national rate applies
 */
export function vatRateFor(pack: PackMeta | undefined, mode: VatMode): number {
  return mode === 'standard' && pack ? pack.invoice.vatRateBp : 0;
}

/**
 * Legal mentions printed on the document, in the document's language (S-145, S-168)
 *
 * @param pack {PackMeta | undefined} - seller's country pack
 * @param mode {VatMode} - VAT treatment
 * @param clientKind {'company' | 'individual'} - business clients also get late-payment terms
 * @param language {Locale} - document language
 * @returns {string[]} - mentions, possibly empty
 */
export function mentionsFor(
  pack: PackMeta | undefined,
  mode: VatMode,
  clientKind: 'company' | 'individual',
  language: Locale,
): string[] {
  if (!pack) return [];
  const { mentions } = pack.invoice;
  const vat =
    mode === 'franchise' || mode === 'reverse_charge' || mode === 'export' ? mentions[mode] : undefined;
  const late = clientKind === 'company' ? mentions.b2b_late : undefined;
  return [vat, late].filter((mention) => mention !== undefined).map((mention) => mention[language]);
}
