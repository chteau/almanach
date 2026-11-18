import { describe, expect, test } from 'bun:test';
import { computeTotals } from '@almanach/shared';
import { renderPdf } from './pdf.ts';

/** 1×1 transparent PNG. */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0),
);

describe('renderPdf', () => {
  test('applies the chosen layout, font and logo, and skips a broken logo (S-235)', async () => {
    const base = {
      type: 'quote' as const,
      draft: true,
      number: null,
      relatedNumber: null,
      issueDate: '2026-11-18',
      dueDate: null,
      validUntil: '2026-12-18',
      language: 'de' as const,
      currency: 'EUR',
      lines: [
        {
          description: 'Beratung',
          quantity: 1000,
          unit: 'hour' as const,
          unitPriceCents: 9000,
          discountBp: 0,
        },
      ],
      totals: computeTotals(
        [{ description: 'Beratung', quantity: 1000, unit: 'hour', unitPriceCents: 9000, discountBp: 0 }],
        0,
        1900,
      ),
      mentions: [],
      note: null,
      seller: { name: 'Lea', address: null, country: 'DE', email: null, vatNumber: null, identifiers: {} },
      buyer: { name: 'Kunde', address: null, country: 'DE', email: null, vatNumber: null, identifiers: {} },
    };
    for (const layout of ['classic', 'band', 'minimal'] as const) {
      const bytes = await renderPdf({
        ...base,
        style: { accent: '#1d4ed8', layout, font: 'serif', logo: { mime: 'image/png', bytes: PNG } },
      });
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    }
    const broken = await renderPdf({
      ...base,
      style: { accent: '#000000', layout: 'band', font: 'sans', logo: { mime: 'image/jpeg', bytes: PNG } },
    });
    expect(broken.length).toBeGreaterThan(1000);
  });

  test('draws a multi-page invoice with characters outside the PDF font', async () => {
    const lines = Array.from({ length: 60 }, (_, index) => ({
      description: `Développement « ${index} » — étape ✓ 東京 with a long description that needs wrapping across lines`,
      quantity: 1500,
      unit: 'day' as const,
      unitPriceCents: 55_000,
      discountBp: index % 2 ? 1000 : 0,
    }));
    const bytes = await renderPdf({
      type: 'invoice',
      draft: false,
      number: 'F-2026-0001',
      relatedNumber: null,
      issueDate: '2026-11-18',
      dueDate: '2026-12-18',
      validUntil: null,
      language: 'fr',
      currency: 'EUR',
      lines,
      totals: computeTotals(lines, 0, 2000),
      mentions: ['TVA non applicable, art. 293 B du CGI'],
      note: 'Merci !',
      seller: {
        name: 'Léa Martin EI',
        address: '12 rue des Lilas\n35000 Rennes',
        country: 'FR',
        email: 'lea@example.com',
        vatNumber: null,
        identifiers: { siret: '73282932000074' },
        bank: { format: 'iban', iban: 'FR7630006000011234567890189', bic: '' },
      },
      buyer: {
        name: 'Nordwind GmbH',
        address: 'Hafenstraße 1\n20457 Hamburg',
        country: 'DE',
        email: null,
        vatNumber: 'DE123456789',
        identifiers: {},
      },
    });
    const head = new TextDecoder().decode(bytes.slice(0, 5));
    expect(head).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(3000);
  });
});
