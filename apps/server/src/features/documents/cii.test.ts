import { describe, expect, test } from 'bun:test';
import { facturxRules, packFeatures } from '@almanach/shared';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, type PDFRawStream } from 'pdf-lib';
import { PackRegistry } from '../packs/packs.ts';
import { frenchSamples, renderSample } from './einvoice.samples.ts';

const registry = await PackRegistry.load();
const fr = registry.get('FR');
if (!fr) throw new Error('French pack missing');
const samples = Object.fromEntries(frenchSamples(fr).map((sample) => [sample.name, sample]));

describe('Factur-X', () => {
  test('packs: France verified, Germany experimental, UK and US without e-invoicing', () => {
    expect(packFeatures(fr).einvoicing).toBe('verified');
    expect(facturxRules(fr)?.exemptionCodes.franchise).toBe('VATEX-FR-FRANCHISE');
    const de = registry.get('DE');
    expect(de && packFeatures(de).einvoicing).toBe('experimental');
    expect(facturxRules(registry.get('GB'))).toBeNull();
    expect(facturxRules(registry.get('US'))).toBeNull();
  });

  test('franchise invoice: CII EN16931 with exemption, SIREN and escaped text', async () => {
    const sample = samples['fr-franchise'];
    if (!sample) throw new Error('sample missing');
    const { xml } = await renderSample(sample, fr);
    expect(xml).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
    expect(xml).toContain('<ram:TypeCode>380</ram:TypeCode>');
    expect(xml).toContain('<ram:ID schemeID="0002">732829320</ram:ID>');
    expect(xml).toContain('<ram:ExemptionReason>TVA non applicable, art. 293 B du CGI</ram:ExemptionReason>');
    expect(xml).toContain(
      '<ram:CategoryCode>E</ram:CategoryCode><ram:ExemptionReasonCode>VATEX-FR-FRANCHISE</ram:ExemptionReasonCode>',
    );
    expect(xml).toContain('<ram:Name>Atelier Durand &amp; Fils SARL</ram:Name>');
    expect(xml).toContain('<ram:BilledQuantity unitCode="DAY">3.5</ram:BilledQuantity>');
  });

  test('credit note references the invoice; deposit deducted as prepaid amount', async () => {
    const credit = samples['fr-credit-note'];
    const vat = samples['fr-vat'];
    if (!credit || !vat) throw new Error('sample missing');
    expect((await renderSample(credit, fr)).xml).toMatch(
      /<ram:TypeCode>381<\/ram:TypeCode>.*<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>F-2026-0042<\/ram:IssuerAssignedID>/,
    );
    const { xml } = await renderSample(vat, fr);
    expect(xml).toContain('<ram:TotalPrepaidAmount>500.00</ram:TotalPrepaidAmount>');
    expect(xml).toContain('<ram:RateApplicablePercent>20.00</ram:RateApplicablePercent>');
  });

  test('PDF/A-3 embeds factur-x.xml as Data with the Factur-X XMP, and is reproducible', async () => {
    const sample = samples['fr-reverse-charge'];
    if (!sample) throw new Error('sample missing');
    const first = await renderSample(sample, fr);
    const pdf = await PDFDocument.load(first.pdf, { updateMetadata: false });
    const [spec] = pdf.catalog.lookup(PDFName.of('AF'), PDFArray).asArray();
    const fileSpec = pdf.context.lookup(spec, PDFDict);
    expect(fileSpec.get(PDFName.of('AFRelationship'))).toBe(PDFName.of('Data'));
    expect(fileSpec.lookup(PDFName.of('UF'), PDFHexString).decodeText()).toBe('factur-x.xml');
    const xmp = new TextDecoder().decode(
      (pdf.catalog.lookup(PDFName.of('Metadata')) as PDFRawStream).contents,
    );
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(xmp).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>');
    expect(pdf.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).size()).toBe(1);
    expect((await renderSample(sample, fr)).pdf).toEqual(first.pdf);
  });
});
