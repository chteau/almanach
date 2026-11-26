import { describe, expect, test } from 'bun:test';
import { normalizeAddress, splitAddress } from './clients.ts';
import { computeTotals, type Line } from './documents.ts';
import {
  buildEinvoice,
  decimal,
  type EinvoiceContext,
  type EinvoiceSource,
  einvoiceMissing,
} from './einvoice.ts';

const context: EinvoiceContext = {
  currency: 'EUR',
  rules: {
    formats: [{ id: 'facturx', profile: 'EN16931', syntax: 'CII' }],
    default: 'facturx',
    mandates: [],
    requiredFields: [],
    legalId: { identifier: 'siret', scheme: '0002', length: 9 },
    exemptionCodes: { franchise: 'VATEX-FR-FRANCHISE', reverse_charge: 'VATEX-EU-AE', export: 'VATEX-EU-O' },
  },
};

const lines: Line[] = [
  { description: 'Conseil', quantity: 2500, unit: 'day', unitPriceCents: 50_000, discountBp: 0 },
  { description: 'Licence', quantity: 1000, unit: 'unit', unitPriceCents: 12_345, discountBp: 1250 },
];

const source = (overrides: Partial<EinvoiceSource> = {}): EinvoiceSource => ({
  type: 'invoice',
  number: 'F-2026-0001',
  issueDate: '2026-11-24',
  dueDate: '2026-12-24',
  currency: 'EUR',
  lines,
  totals: computeTotals(lines, 0, 0),
  vatMode: 'franchise',
  mentions: ['TVA non applicable, art. 293 B du CGI', 'Pénalités de retard…'],
  vatMention: 'TVA non applicable, art. 293 B du CGI',
  note: null,
  seller: {
    name: 'Camille EI',
    address: '1 rue A\n75001 Paris',
    country: 'FR',
    email: 'c@example.fr',
    vatNumber: 'FR40732829320',
    identifiers: { siret: '732 829 320 00074' },
    postal: { lines: ['1 rue A'], postalCode: '75001', city: 'Paris' },
    bank: { format: 'iban', iban: 'FR76 3000 6000 0112 3456 7890 189', bic: '' },
  },
  buyer: {
    name: 'Client SAS',
    address: '2 rue B\n69001 Lyon',
    country: 'FR',
    email: null,
    vatNumber: 'FR83404833048',
    identifiers: { siret: '40483304800022' },
    postal: { lines: ['2 rue B'], postalCode: '69001', city: 'Lyon' },
  },
  buyerKind: 'company',
  related: null,
  ...overrides,
});

describe('EN 16931 model', () => {
  test('maps a French franchise invoice: category E, VATEX code, SIREN, exact prices', () => {
    const { invoice } = buildEinvoice(source(), context);
    expect(invoice?.typeCode).toBe('380');
    expect(invoice?.vat).toEqual({
      category: 'E',
      rateBp: 0,
      basisCents: 135_802,
      taxCents: 0,
      exemptionReason: 'TVA non applicable, art. 293 B du CGI',
      exemptionCode: 'VATEX-FR-FRANCHISE',
    });
    expect(invoice?.notes).toEqual(['Pénalités de retard…']);
    expect(invoice?.seller.legalId).toEqual({ id: '732829320', scheme: '0002' });
    expect(invoice?.payment).toEqual({ meansCode: '58', iban: 'FR7630006000011234567890189', bic: null });
    expect(invoice?.lines[1]).toMatchObject({
      quantity: '1',
      unitCode: 'C62',
      grossPrice: '123.45',
      priceDiscount: '15.43125',
      netPrice: '108.01875',
      netCents: 10_802,
    });
    expect(invoice?.lines[0]).toMatchObject({ quantity: '2.5', unitCode: 'DAY', netCents: 125_000 });
  });

  test('standard rate with a global discount and a deposit deducted', () => {
    const totals = computeTotals(lines, 1000, 2000, 30_000);
    const { invoice } = buildEinvoice(source({ vatMode: 'standard', vatMention: null, totals }), context);
    expect(invoice?.vat).toMatchObject({
      category: 'S',
      rateBp: 2000,
      exemptionCode: null,
      exemptionReason: null,
    });
    expect(invoice?.allowance).toEqual({ amountCents: totals.discountCents, reasonCode: '95' });
    expect(invoice?.totals).toEqual({
      linesCents: totals.linesCents,
      allowanceCents: totals.discountCents,
      taxBasisCents: totals.netCents,
      taxCents: totals.vatCents,
      grandCents: totals.netCents + totals.vatCents,
      prepaidCents: 30_000,
      dueCents: totals.totalCents,
    });
  });

  test('credit note refers to its invoice and has no payment means', () => {
    const { invoice } = buildEinvoice(
      source({
        type: 'credit_note',
        dueDate: null,
        related: { number: 'F-2026-0001', issueDate: '2026-11-20' },
      }),
      context,
    );
    expect(invoice?.typeCode).toBe('381');
    expect(invoice?.precedingInvoice).toEqual({ number: 'F-2026-0001', issueDate: '2026-11-20' });
    expect(invoice?.payment).toBeNull();
    expect(invoice?.dueDate).toBe('2026-11-24');
  });

  test('export is outside the scope of VAT: no VAT identifiers (BR-O-02)', () => {
    const { invoice } = buildEinvoice(
      source({ vatMode: 'export', buyer: { ...source().buyer, country: 'US', vatNumber: null } }),
      context,
    );
    expect(invoice?.vat.category).toBe('O');
    expect(invoice?.vat.exemptionCode).toBe('VATEX-EU-O');
    expect(invoice?.seller.vatId).toBeNull();
    expect(invoice?.buyer.legalId).toBeNull();
  });

  test('lists what is missing instead of building an invalid invoice', () => {
    const incomplete = source({
      number: null,
      buyerKind: 'individual',
      vatMode: 'reverse_charge',
      seller: { ...source().seller, vatNumber: null, postal: null },
      buyer: {
        ...source().buyer,
        vatNumber: null,
        postal: { lines: ['2 rue B'], postalCode: null, city: null },
      },
    });
    expect(buildEinvoice(incomplete, context)).toEqual({
      invoice: null,
      missing: [
        'document.number',
        'client.kind',
        'seller.address',
        'seller.postal_code',
        'seller.city',
        'client.postal_code',
        'client.city',
        'seller.vat',
        'client.vat',
      ],
    });
    expect(einvoiceMissing({ ...source(), currency: 'USD', type: 'quote' }, context)).toEqual([
      'document.type',
      'document.currency',
    ]);
  });

  test('a German Steuernummer (BT-32) alone does not identify the seller (BR-CO-26)', () => {
    const german: EinvoiceContext = {
      currency: 'EUR',
      rules: { ...context.rules, legalId: undefined, taxId: 'steuernummer', exemptionCodes: {} },
    };
    const seller = {
      ...source().seller,
      country: 'DE',
      vatNumber: null,
      identifiers: { steuernummer: '21/815/08150' },
    };
    expect(einvoiceMissing(source({ seller }), german)).toEqual(['seller.vat']);
    expect(einvoiceMissing(source({ seller, vatMode: 'export' }), german)).toEqual(['seller.identifier']);
    const withVat = { ...seller, vatNumber: 'DE136695976' };
    expect(einvoiceMissing(source({ seller: withVat }), german)).toEqual([]);
    expect(buildEinvoice(source({ seller: withVat, number: 'R-1' }), german).invoice?.seller.taxId).toBe(
      '21/815/08150',
    );
  });

  test('formats scaled decimals exactly', () => {
    expect(decimal(1_234_500n, 6, 2)).toBe('1.2345');
    expect(decimal(120_000_000n, 6, 2)).toBe('120.00');
    expect(decimal(5n, 3)).toBe('0.005');
  });
});

describe('structured address', () => {
  test('splits only a recognised last line, keeps anything else as street lines', () => {
    expect(splitAddress('3 av. de la Gare\nBât. B\n69002  Lyon 2e', 'FR')).toEqual({
      lines: ['3 av. de la Gare', 'Bât. B'],
      postalCode: '69002',
      city: 'Lyon 2e',
    });
    expect(splitAddress('10 Downing St\nLondon SW1A 2AA', 'GB').postalCode).toBeNull();
    expect(splitAddress('75001 Paris', 'FR')).toEqual({
      lines: ['75001 Paris'],
      postalCode: null,
      city: null,
    });
  });

  test('structured parts compose the printed text; a text alone is split', () => {
    expect(
      normalizeAddress({
        address: 'old',
        addressLines: ['1 Main St'],
        postalCode: '94105',
        city: 'San Francisco',
        country: 'US',
      }),
    ).toEqual({
      address: '1 Main St\nSan Francisco 94105',
      addressLines: ['1 Main St'],
      postalCode: '94105',
      city: 'San Francisco',
    });
    expect(
      normalizeAddress({
        address: '5 Hauptstr.\nD-10115 Berlin',
        postalCode: null,
        city: null,
        country: 'DE',
      }),
    ).toEqual({
      address: '5 Hauptstr.\nD-10115 Berlin',
      addressLines: ['5 Hauptstr.'],
      postalCode: '10115',
      city: 'Berlin',
    });
  });
});
