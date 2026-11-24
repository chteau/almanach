import { createHash } from 'node:crypto';
import * as fontkit from '@pdf-lib/fontkit';
import { AFRelationship, type PDFDocument, type PDFFont, PDFHexString, PDFName, PDFString } from 'pdf-lib';

const ASSETS = new URL('../../../assets/', import.meta.url);

/** Embedded font families: Geist (SIL OFL 1.1) and Liberation Serif (SIL OFL 1.1, Times metrics). */
const FONT_FILES = {
  sans: { regular: 'Geist-Regular.ttf', bold: 'Geist-Bold.ttf' },
  serif: { regular: 'LiberationSerif-Regular.ttf', bold: 'LiberationSerif-Bold.ttf' },
} as const;

const cache = new Map<string, Promise<Uint8Array>>();

/**
 * Reads a bundled asset once
 *
 * @param path {string} - path under apps/server/assets
 * @returns {Promise<Uint8Array>} - file bytes
 */
function asset(path: string): Promise<Uint8Array> {
  let bytes = cache.get(path);
  if (!bytes) {
    bytes = Bun.file(new URL(path, ASSETS)).bytes();
    cache.set(path, bytes);
  }
  return bytes;
}

/** A font embedded in the document, with the means to know which characters it can draw. */
export interface EmbeddedFont {
  pdf: PDFFont;
  has: (codePoint: number) => boolean;
}

/**
 * Embeds the regular and bold faces of a family, subset to the characters used (PDF/A requires embedded fonts)
 *
 * @param pdf {PDFDocument} - document
 * @param family {'sans' | 'serif'} - family chosen in the billing settings
 * @returns {Promise<{ regular: EmbeddedFont; bold: EmbeddedFont }>} - both faces
 */
export async function embedFonts(
  pdf: PDFDocument,
  family: 'sans' | 'serif',
): Promise<{ regular: EmbeddedFont; bold: EmbeddedFont }> {
  pdf.registerFontkit(fontkit);
  const face = async (file: string): Promise<EmbeddedFont> => {
    const bytes = await asset(`fonts/${file}`);
    const metrics = fontkit.create(bytes);
    return {
      pdf: await pdf.embedFont(bytes, { subset: true }),
      has: (codePoint) => metrics.hasGlyphForCodePoint(codePoint),
    };
  };
  const files = FONT_FILES[family];
  return { regular: await face(files.regular), bold: await face(files.bold) };
}

/**
 * Escapes text for XML content and attributes
 *
 * @param value {string} - raw text
 * @returns {string} - escaped text
 */
export function xmlEscape(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char] ?? char,
  );
}

/** Factur-X XMP extension schema (Factur-X 1.07 specification, § 6.2.2). */
const FACTURX_SCHEMA = `<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">
<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
<pdfaSchema:prefix>fx</pdfaSchema:prefix>
<pdfaSchema:property><rdf:Seq>
${[
  ['DocumentFileName', 'The name of the embedded XML document'],
  ['DocumentType', 'The type of the hybrid document in capital letters, e.g. INVOICE or ORDER'],
  ['Version', 'The actual version of the standard applying to the embedded XML document'],
  ['ConformanceLevel', 'The conformance level of the embedded XML document'],
]
  .map(
    ([name, description]) =>
      `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${name}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${description}</pdfaProperty:description></rdf:li>`,
  )
  .join('\n')}
</rdf:Seq></pdfaSchema:property>
</rdf:li></rdf:Bag></pdfaExtension:schemas>
</rdf:Description>`;

/** Embedded EN 16931 XML that turns the PDF into a Factur-X. */
export interface FacturxAttachment {
  xml: string;
  /** Factur-X conformance level written in the XMP, e.g. "EN 16931". */
  conformance: 'EN 16931';
}

/**
 * Makes the document PDF/A-3B: sRGB output intent, XMP metadata matching the document information, a file
 * identifier, and for a Factur-X the `factur-x.xml` attachment (AFRelationship Data) with its XMP extension
 *
 * @param pdf {PDFDocument} - document created with updateMetadata: false
 * @param meta {{ title: string; date: Date; facturx?: FacturxAttachment }} - title, creation date, optional XML
 * @returns {Promise<void>} - resolves when done
 */
export async function finishPdfA(
  pdf: PDFDocument,
  meta: { title: string; date: Date; facturx?: FacturxAttachment | undefined },
): Promise<void> {
  const { context, catalog } = pdf;
  const date = new Date(Math.floor(meta.date.getTime() / 1000) * 1000);
  pdf.setTitle(meta.title);
  pdf.setProducer('Almanach');
  pdf.setCreator('Almanach');
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);

  const icc = context.flateStream(await asset('icc/sRGB.icc'), { N: 3 });
  const intent = context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: context.register(icc),
  });
  catalog.set(PDFName.of('OutputIntents'), context.obj([context.register(intent)]));

  if (meta.facturx) {
    await pdf.attach(new TextEncoder().encode(meta.facturx.xml), 'factur-x.xml', {
      mimeType: 'text/xml',
      description: 'Factur-X invoice',
      creationDate: date,
      modificationDate: date,
      afRelationship: AFRelationship.Data,
    });
  }

  const iso = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:format>application/pdf</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(meta.title)}</rdf:li></rdf:Alt></dc:title></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>Almanach</pdf:Producer></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>Almanach</xmp:CreatorTool><xmp:CreateDate>${iso}</xmp:CreateDate><xmp:ModifyDate>${iso}</xmp:ModifyDate></rdf:Description>
${
  meta.facturx
    ? `<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>${meta.facturx.conformance}</fx:ConformanceLevel></rdf:Description>
${FACTURX_SCHEMA}`
    : ''
}
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const metadata = context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  catalog.set(PDFName.of('Metadata'), context.register(metadata));

  const id = createHash('md5')
    .update(`${meta.title}|${iso}|${meta.facturx?.xml ?? ''}`)
    .digest('hex');
  context.trailerInfo.ID = context.obj([PDFHexString.of(id), PDFHexString.of(id)]);
}
