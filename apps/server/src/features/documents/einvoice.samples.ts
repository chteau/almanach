import {
  buildEinvoice,
  computeTotals,
  type EinvoiceSource,
  facturxRules,
  type Line,
  type PackMeta,
  type VatMode,
  vatMentionIn,
} from '@almanach/shared';
import type { PartySnapshot } from '../../db/schema.ts';
import { toCii } from './cii.ts';
import { renderPdf } from './pdf.ts';
import { mentionsFor } from './vat.ts';

/** Fictitious French seller and clients; SIRET and VAT numbers have valid check digits, IBAN is the ECB example. */
const SELLER: PartySnapshot = {
  name: 'Camille Martin EI',
  address: '12 rue des Lilas\n75011 Paris',
  country: 'FR',
  email: 'camille@example.fr',
  vatNumber: 'FR40732829320',
  identifiers: { siret: '73282932000074', vat: 'FR40732829320' },
  postal: { lines: ['12 rue des Lilas'], postalCode: '75011', city: 'Paris' },
  bank: { format: 'iban', iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP' },
};
const BUYER: PartySnapshot = {
  name: 'Atelier Durand & Fils SARL',
  address: '3 avenue de la Gare\nBâtiment B\n69002 Lyon',
  country: 'FR',
  email: 'compta@durand.example',
  vatNumber: 'FR83404833048',
  identifiers: { siret: '40483304800022' },
  postal: { lines: ['3 avenue de la Gare', 'Bâtiment B'], postalCode: '69002', city: 'Lyon' },
};
const EU_BUYER: PartySnapshot = {
  name: 'Müller GmbH',
  address: 'Hauptstraße 5\n10115 Berlin',
  country: 'DE',
  email: 'rechnung@mueller.example',
  vatNumber: 'DE136695976',
  identifiers: {},
  postal: { lines: ['Hauptstraße 5'], postalCode: '10115', city: 'Berlin' },
};

const LINES: Line[] = [
  {
    description: 'Développement « tableau de bord »',
    quantity: 3500,
    unit: 'day',
    unitPriceCents: 45_000,
    discountBp: 0,
  },
  {
    description: 'Maintenance mensuelle',
    quantity: 1000,
    unit: 'month',
    unitPriceCents: 12_345,
    discountBp: 1000,
  },
  { description: 'Réunion de cadrage', quantity: 1500, unit: 'hour', unitPriceCents: 8_000, discountBp: 0 },
];

/** A sample document: the issued facts an e-invoice is built from. */
export interface EinvoiceSample {
  name: string;
  source: EinvoiceSource;
}

/**
 * Validation samples for a French seller: franchise, VAT with discounts and a deposit deducted, credit note,
 * reverse charge to an EU business
 *
 * @param pack {PackMeta} - French pack
 * @returns {EinvoiceSample[]} - samples
 */
export function frenchSamples(pack: PackMeta): EinvoiceSample[] {
  const sample = (
    name: string,
    type: EinvoiceSource['type'],
    vatMode: VatMode,
    extra: Partial<EinvoiceSource> & { discountBp?: number; depositsCents?: number } = {},
  ): EinvoiceSample => {
    const { discountBp = 0, depositsCents = 0, ...rest } = extra;
    const lines = rest.lines ?? LINES;
    const mentions = mentionsFor(pack, vatMode, 'company', 'fr');
    return {
      name,
      source: {
        type,
        number: 'F-2026-0042',
        issueDate: '2026-11-24',
        dueDate: '2026-12-24',
        currency: 'EUR',
        lines,
        totals: computeTotals(
          lines,
          discountBp,
          vatMode === 'standard' ? pack.invoice.vatRateBp : 0,
          depositsCents,
        ),
        vatMode,
        mentions,
        vatMention: vatMentionIn(pack, vatMode, mentions),
        note: 'Merci pour votre confiance.',
        seller: SELLER,
        buyer: BUYER,
        buyerKind: 'company',
        related: null,
        ...rest,
      },
    };
  };
  return [
    sample('fr-franchise', 'invoice', 'franchise'),
    sample('fr-vat', 'invoice', 'standard', { discountBp: 500, depositsCents: 50_000 }),
    sample('fr-credit-note', 'credit_note', 'standard', {
      number: 'A-2026-0003',
      dueDate: null,
      lines: [LINES[1] as Line],
      related: { number: 'F-2026-0042', issueDate: '2026-11-24' },
    }),
    sample('fr-reverse-charge', 'invoice', 'reverse_charge', { buyer: EU_BUYER }),
  ];
}

/**
 * Builds the Factur-X XML and PDF of a sample
 *
 * @param sample {EinvoiceSample} - sample
 * @param pack {PackMeta} - seller's pack
 * @returns {Promise<{ xml: string; pdf: Uint8Array }>} - CII XML and the PDF/A-3 embedding it
 */
export async function renderSample(
  sample: EinvoiceSample,
  pack: PackMeta,
): Promise<{ xml: string; pdf: Uint8Array }> {
  const rules = facturxRules(pack);
  if (!rules) throw new Error(`${pack.country} offers no Factur-X`);
  const built = buildEinvoice(sample.source, { rules, currency: pack.currency });
  if (!built.invoice) throw new Error(`${sample.name}: missing ${built.missing.join(', ')}`);
  const xml = toCii(built.invoice);
  const { source } = sample;
  const pdf = await renderPdf({
    ...source,
    draft: false,
    validUntil: null,
    language: 'fr',
    relatedNumber: source.related?.number ?? null,
    createdAt: new Date('2026-11-24T10:00:00Z'),
    facturx: { xml, conformance: 'EN 16931' },
  });
  return { xml, pdf };
}
