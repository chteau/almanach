import type { PostalAddress } from './clients.ts';
import {
  type DocumentType,
  type Line,
  lineAmount,
  PERCENT_SCALE,
  QUANTITY_SCALE,
  type Totals,
  type VatMode,
} from './documents.ts';
import { type EinvoiceRules, type PackMeta, packFeatures } from './packs.ts';
import type { Bank } from './profile.ts';

/**
 * Semantic model of EN 16931-1 (business terms BT-x, groups BG-x), shared by every syntax: CII for Factur-X today,
 * UBL / XRechnung later. Amounts are integer cents, quantities and prices exact decimal strings.
 */
export interface EnParty {
  /** BT-27 / BT-44 */
  name: string;
  /** BG-5 / BG-8; country is BT-40 / BT-55. */
  address: PostalAddress & { country: string };
  /** BT-31 / BT-48 */
  vatId: string | null;
  /** BT-32, seller only (tax registration, scheme FC). */
  taxId: string | null;
  /** BT-30 / BT-47 with its ISO 6523 scheme (0002 = SIREN). */
  legalId: { id: string; scheme: string } | null;
  /** BT-34 / BT-49, scheme EM (e-mail) from the EAS list. */
  electronicAddress: { id: string; scheme: string } | null;
}

/** BG-25 */
export interface EnLine {
  /** BT-126 */
  id: string;
  /** BT-153 */
  name: string;
  /** BT-129 and BT-130 (UN/ECE Rec. 20). */
  quantity: string;
  unitCode: string;
  /** BT-148 gross price, BT-147 price discount, BT-146 net price. */
  grossPrice: string;
  priceDiscount: string | null;
  netPrice: string;
  /** BT-131 */
  netCents: number;
}

/** EN 16931 VAT category codes (UNTDID 5305 subset). */
export type VatCategory = 'S' | 'E' | 'AE' | 'O';

/** BG-23, one per category and rate; Almanach documents have a single treatment. */
export interface EnVatBreakdown {
  category: VatCategory;
  rateBp: number;
  basisCents: number;
  taxCents: number;
  /** BT-120 and BT-121 */
  exemptionReason: string | null;
  exemptionCode: string | null;
}

export interface EnInvoice {
  /** BT-24 */
  specification: 'urn:cen.eu:en16931:2017';
  /** BT-1, BT-2, BT-3 (380 invoice, 381 credit note, 386 prepayment invoice), BT-5 */
  number: string;
  issueDate: string;
  typeCode: '380' | '381' | '386';
  currency: string;
  /** BT-9 */
  dueDate: string | null;
  /** BT-10, needed by XRechnung (Leitweg-ID); not filled yet. */
  buyerReference: string | null;
  /** BT-22 */
  notes: string[];
  /** BG-3: invoice a credit note corrects. */
  precedingInvoice: { number: string; issueDate: string | null } | null;
  seller: EnParty;
  buyer: EnParty;
  /** BG-16: 58 = SEPA credit transfer. */
  payment: { meansCode: '58'; iban: string; bic: string | null } | null;
  lines: EnLine[];
  /** BG-20 document level allowance (global discount), reason code 95 = discount. */
  allowance: { amountCents: number; reasonCode: '95' } | null;
  vat: EnVatBreakdown;
  /** BG-22: BT-106, BT-107, BT-109, BT-110, BT-112, BT-113, BT-115 */
  totals: {
    linesCents: number;
    allowanceCents: number;
    taxBasisCents: number;
    taxCents: number;
    grandCents: number;
    prepaidCents: number;
    dueCents: number;
  };
}

/** A party as frozen on an issued document. */
export interface EinvoiceParty {
  name: string;
  address: string | null;
  country: string;
  email: string | null;
  vatNumber: string | null;
  identifiers: Record<string, string>;
  postal?: PostalAddress | null;
  bank?: Bank;
}

/** What an e-invoice is built from: an issued document and its snapshots. */
export interface EinvoiceSource {
  type: DocumentType;
  number: string | null;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  lines: Line[];
  totals: Totals;
  vatMode: VatMode;
  mentions: string[];
  /** The printed VAT exemption mention among `mentions` (BT-120), null under the standard rate. */
  vatMention: string | null;
  note: string | null;
  seller: EinvoiceParty;
  buyer: EinvoiceParty;
  buyerKind: 'company' | 'individual';
  related: { number: string; issueDate: string | null } | null;
}

/** Country facts used for the e-invoice: the pack's rules and its currency. */
export interface EinvoiceContext {
  rules: EinvoiceRules;
  currency: string;
}

/**
 * E-invoice rules of a country when its pack offers Factur-X (feature `einvoicing` listed, format declared)
 *
 * @param pack {PackMeta | undefined} - seller's country pack
 * @returns {EinvoiceRules | null} - rules, or null when Factur-X is not offered
 */
export function facturxRules(pack: PackMeta | undefined): EinvoiceRules | null {
  const rules = pack?.invoice.einvoice;
  if (!pack || !rules || !packFeatures(pack).einvoicing) return null;
  return rules.formats.some((format) => format.id === 'facturx') ? rules : null;
}

/**
 * Finds the VAT exemption mention among a document's frozen mentions, whatever their language
 *
 * @param pack {PackMeta | undefined} - seller's country pack
 * @param mode {VatMode} - VAT treatment of the document
 * @param mentions {string[]} - printed mentions
 * @returns {string | null} - the VAT mention, or null
 */
export function vatMentionIn(pack: PackMeta | undefined, mode: VatMode, mentions: string[]): string | null {
  const texts =
    mode === 'franchise' || mode === 'reverse_charge' || mode === 'export'
      ? Object.values(pack?.invoice.mentions[mode] ?? {})
      : [];
  return mentions.find((mention) => texts.includes(mention)) ?? null;
}

const UNIT_CODES: Record<Line['unit'], string> = {
  hour: 'HUR',
  day: 'DAY',
  month: 'MON',
  unit: 'C62',
  flat: 'LS',
};
const CATEGORY: Partial<Record<VatMode, VatCategory>> = {
  standard: 'S',
  franchise: 'E',
  reverse_charge: 'AE',
  export: 'O',
};
const TYPE_CODES: Partial<Record<DocumentType, EnInvoice['typeCode']>> = {
  invoice: '380',
  credit_note: '381',
  deposit: '386',
};

/**
 * Formats a non-negative integer scaled by 10^decimals as a decimal string, keeping at least `keep` decimals
 *
 * @param value {bigint} - scaled integer
 * @param decimals {number} - scale
 * @param keep {number} - minimum decimals shown
 * @returns {string} - e.g. "12.5" or "1200.00"
 */
export function decimal(value: bigint, decimals: number, keep = 0): string {
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  let fraction = digits.slice(digits.length - decimals);
  while (fraction.length > keep && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Cents as an EN 16931 amount with two decimals
 *
 * @param cents {number} - amount in cents
 * @returns {string} - e.g. "1200.00"
 */
export function amount(cents: number): string {
  return decimal(BigInt(cents), 2, 2);
}

/**
 * Legal registration identifier of a party from the pack rule (SIRET → SIREN, scheme 0002 in France)
 *
 * @param identifiers {Record<string, string>} - party identifiers
 * @param rule {EinvoiceRules['legalId']} - pack rule
 * @returns {EnParty['legalId']} - identifier and scheme, or null
 */
function legalIdOf(identifiers: Record<string, string>, rule: EinvoiceRules['legalId']): EnParty['legalId'] {
  const raw = rule ? identifiers[rule.identifier]?.replace(/\s/g, '') : undefined;
  return rule && raw ? { id: raw.slice(0, rule.length), scheme: rule.scheme } : null;
}

/**
 * Lists what an e-invoice still needs, as stable codes shared with the issue checks ("client.postal_code"…)
 *
 * @param source {Pick<EinvoiceSource, …>} - document facts, before or after issue
 * @param context {EinvoiceContext} - country rules
 * @returns {string[]} - missing items, empty when an EN 16931 invoice can be produced
 */
export function einvoiceMissing(
  source: Pick<
    EinvoiceSource,
    'type' | 'currency' | 'vatMode' | 'vatMention' | 'seller' | 'buyer' | 'buyerKind' | 'lines'
  >,
  context: EinvoiceContext,
): string[] {
  const missing: string[] = [];
  const { rules } = context;
  if (!TYPE_CODES[source.type]) missing.push('document.type');
  if (source.lines.length === 0) missing.push('lines');
  if (source.currency !== context.currency) missing.push('document.currency');
  const category = CATEGORY[source.vatMode];
  if (!category) missing.push('document.vat_mode');
  if (source.buyerKind === 'individual') missing.push('client.kind');
  const party = (prefix: 'seller' | 'client', value: EinvoiceParty) => {
    const postal = value.postal;
    if (!postal?.lines.length) missing.push(`${prefix}.address`);
    if (!postal?.postalCode) missing.push(`${prefix}.postal_code`);
    if (!postal?.city) missing.push(`${prefix}.city`);
  };
  party('seller', source.seller);
  party('client', source.buyer);
  if (rules.legalId && !legalIdOf(source.seller.identifiers, rules.legalId))
    missing.push(`seller.${rules.legalId.identifier}`);
  // BR-S-02, BR-E-02, BR-AE-02: the seller VAT identifier (or, for BR-E-02 and BR-S-02, BT-32) is required.
  const taxId = rules.taxId ? source.seller.identifiers[rules.taxId] : undefined;
  if (category && category !== 'O' && !source.seller.vatNumber && (category === 'AE' || !taxId))
    missing.push('seller.vat');
  // BR-AE-02: reverse charge also needs the buyer's VAT identifier.
  if (category === 'AE' && !source.buyer.vatNumber) missing.push('client.vat');
  // BR-E-10, BR-AE-10, BR-O-10: an exemption needs its reason, as text (the mention) or VATEX code.
  const code =
    source.vatMode === 'franchise' || source.vatMode === 'reverse_charge' || source.vatMode === 'export'
      ? rules.exemptionCodes[source.vatMode]
      : undefined;
  if (category && category !== 'S' && !source.vatMention && !code) missing.push('document.vat_exemption');
  const domestic = source.buyer.country === source.seller.country;
  if (
    rules.requiredFields.includes('buyer_legal_id') &&
    domestic &&
    rules.legalId &&
    !legalIdOf(source.buyer.identifiers, rules.legalId)
  )
    missing.push(`client.${rules.legalId.identifier}`);
  return [...new Set(missing)];
}

/**
 * Builds the EN 16931 semantic invoice of an issued document; returns what is missing instead when it cannot
 *
 * @param source {EinvoiceSource} - issued document and its snapshots
 * @param context {EinvoiceContext} - country rules
 * @returns {{ invoice: EnInvoice; missing: [] } | { invoice: null; missing: string[] }} - model or missing items
 */
export function buildEinvoice(
  source: EinvoiceSource,
  context: EinvoiceContext,
): { invoice: EnInvoice; missing: [] } | { invoice: null; missing: string[] } {
  const missing = einvoiceMissing(source, context);
  if (!source.number) missing.unshift('document.number');
  const typeCode = TYPE_CODES[source.type];
  const category = CATEGORY[source.vatMode];
  if (missing.length > 0 || !typeCode || !category || !source.number) return { invoice: null, missing };
  const { rules } = context;
  const outOfScope = category === 'O';

  const party = (value: EinvoiceParty, domestic: boolean): EnParty => ({
    name: value.name,
    address: {
      lines: value.postal?.lines.slice(0, 3) ?? [],
      postalCode: value.postal?.postalCode ?? null,
      city: value.postal?.city ?? null,
      country: value.country,
    },
    // BR-O-02 and BR-O-04: no VAT identifiers on an invoice outside the scope of VAT.
    vatId: outOfScope ? null : value.vatNumber,
    taxId: null,
    legalId: domestic ? legalIdOf(value.identifiers, rules.legalId) : null,
    electronicAddress: value.email ? { id: value.email, scheme: 'EM' } : null,
  });

  const lines = source.lines.map((line, index): EnLine => {
    // Prices keep six decimals of the currency unit, so cents × basis points stays exact.
    const scaledGross = BigInt(line.unitPriceCents) * BigInt(PERCENT_SCALE);
    const discount = BigInt(line.unitPriceCents) * BigInt(line.discountBp);
    return {
      id: String(index + 1),
      name: line.description,
      quantity: decimal(BigInt(line.quantity), Math.log10(QUANTITY_SCALE)),
      unitCode: UNIT_CODES[line.unit],
      grossPrice: decimal(scaledGross, 6, 2),
      priceDiscount: line.discountBp > 0 ? decimal(discount, 6, 2) : null,
      netPrice: decimal(scaledGross - discount, 6, 2),
      netCents: lineAmount(line),
    };
  });

  const vatMention = category === 'S' ? null : source.vatMention;
  const exemptionCode =
    source.vatMode === 'franchise' || source.vatMode === 'reverse_charge' || source.vatMode === 'export'
      ? (rules.exemptionCodes[source.vatMode] ?? null)
      : null;
  const { totals } = source;
  const bank = source.seller.bank;
  return {
    missing: [],
    invoice: {
      specification: 'urn:cen.eu:en16931:2017',
      number: source.number,
      issueDate: source.issueDate,
      typeCode,
      currency: source.currency,
      // BR-CO-25: an amount due needs a due date; a credit note is settled on its date.
      dueDate: source.dueDate ?? source.issueDate,
      buyerReference: null,
      notes: [...source.mentions.filter((mention) => mention !== vatMention), source.note ?? ''].filter(
        Boolean,
      ),
      precedingInvoice: source.related,
      seller: {
        ...party(source.seller, true),
        taxId: (!outOfScope && rules.taxId && source.seller.identifiers[rules.taxId]) || null,
      },
      buyer: party(source.buyer, source.buyer.country === source.seller.country),
      payment:
        bank?.format === 'iban' && source.type !== 'credit_note'
          ? { meansCode: '58', iban: bank.iban.replace(/\s/g, ''), bic: bank.bic || null }
          : null,
      lines,
      allowance: totals.discountCents > 0 ? { amountCents: totals.discountCents, reasonCode: '95' } : null,
      vat: {
        category,
        rateBp: category === 'S' ? totals.vatRateBp : 0,
        basisCents: totals.netCents,
        taxCents: totals.vatCents,
        exemptionReason: vatMention,
        exemptionCode,
      },
      totals: {
        linesCents: totals.linesCents,
        allowanceCents: totals.discountCents,
        taxBasisCents: totals.netCents,
        taxCents: totals.vatCents,
        grandCents: totals.netCents + totals.vatCents,
        prepaidCents: totals.depositsCents,
        dueCents: totals.totalCents,
      },
    },
  };
}
