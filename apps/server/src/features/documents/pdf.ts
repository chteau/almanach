import {
  type DocumentType,
  formatMoney,
  type Line,
  type Locale,
  lineAmount,
  type PDF_FONTS,
  type PDF_LAYOUTS,
  QUANTITY_SCALE,
  type Totals,
} from '@almanach/shared';
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';
import type { PartySnapshot } from '../../db/schema.ts';

const LABELS = {
  fr: {
    quote: 'Devis',
    invoice: 'Facture',
    deposit: 'Facture d’acompte',
    credit_note: 'Avoir',
    draft: 'BROUILLON',
    number: 'N°',
    issueDate: 'Date d’émission',
    dueDate: 'Échéance',
    validUntil: 'Valable jusqu’au',
    billTo: 'Facturé à',
    description: 'Description',
    quantity: 'Qté',
    unit: 'Unité',
    unitPrice: 'Prix unitaire',
    amount: 'Montant',
    subtotal: 'Sous-total',
    discount: 'Remise',
    net: 'Total HT',
    vat: 'TVA',
    deposits: 'Acomptes déjà facturés',
    total: 'Total à payer',
    totalQuote: 'Total',
    bank: 'Coordonnées bancaires',
    related: 'Réf.',
    page: 'Page',
    vatNumber: 'N° TVA',
    hour: 'heure',
    day: 'jour',
    month: 'mois',
    flat: 'forfait',
    unitName: 'unité',
  },
  en: {
    quote: 'Quote',
    invoice: 'Invoice',
    deposit: 'Deposit invoice',
    credit_note: 'Credit note',
    draft: 'DRAFT',
    number: 'No.',
    issueDate: 'Issue date',
    dueDate: 'Due date',
    validUntil: 'Valid until',
    billTo: 'Bill to',
    description: 'Description',
    quantity: 'Qty',
    unit: 'Unit',
    unitPrice: 'Unit price',
    amount: 'Amount',
    subtotal: 'Subtotal',
    discount: 'Discount',
    net: 'Net total',
    vat: 'VAT',
    deposits: 'Deposits already invoiced',
    total: 'Total due',
    totalQuote: 'Total',
    bank: 'Bank details',
    related: 'Ref.',
    page: 'Page',
    vatNumber: 'VAT no.',
    hour: 'hour',
    day: 'day',
    month: 'month',
    flat: 'flat fee',
    unitName: 'unit',
  },
  de: {
    quote: 'Angebot',
    invoice: 'Rechnung',
    deposit: 'Anzahlungsrechnung',
    credit_note: 'Gutschrift',
    draft: 'ENTWURF',
    number: 'Nr.',
    issueDate: 'Rechnungsdatum',
    dueDate: 'Fällig am',
    validUntil: 'Gültig bis',
    billTo: 'Rechnung an',
    description: 'Beschreibung',
    quantity: 'Menge',
    unit: 'Einheit',
    unitPrice: 'Einzelpreis',
    amount: 'Betrag',
    subtotal: 'Zwischensumme',
    discount: 'Rabatt',
    net: 'Nettobetrag',
    vat: 'USt.',
    deposits: 'Bereits berechnete Anzahlungen',
    total: 'Zu zahlender Betrag',
    totalQuote: 'Gesamt',
    bank: 'Bankverbindung',
    related: 'Bezug',
    page: 'Seite',
    vatNumber: 'USt-IdNr.',
    hour: 'Stunde',
    day: 'Tag',
    month: 'Monat',
    flat: 'Pauschale',
    unitName: 'Stück',
  },
} as const;

const LOCALE_TAGS: Record<Locale, string> = { fr: 'fr-FR', en: 'en-GB', de: 'de-DE' };
const INK = rgb(0.08, 0.09, 0.11);
const MUTED = rgb(0.37, 0.38, 0.42);
const LINE = rgb(0.85, 0.85, 0.82);
const ACCENT = rgb(0.76, 0.25, 0.05);
const MARGIN = 48;
const WIDTH = 595.28;
const HEIGHT = 841.89;

/** Everything printed on a document. */
export interface PdfInput {
  type: DocumentType;
  draft: boolean;
  number: string | null;
  relatedNumber: string | null;
  issueDate: string;
  dueDate: string | null;
  validUntil: string | null;
  language: Locale;
  currency: string;
  lines: Line[];
  totals: Totals;
  mentions: string[];
  note: string | null;
  seller: PartySnapshot;
  buyer: PartySnapshot;
  /** Look chosen in the billing settings; the classic look is used when absent (S-235). */
  style?: PdfStyle;
}

/** Accent colour, layout, font family and optional logo of a document. */
export interface PdfStyle {
  accent: string;
  layout: (typeof PDF_LAYOUTS)[number];
  font: (typeof PDF_FONTS)[number];
  logo?: { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array } | null;
}

/**
 * Converts "#rrggbb" into a pdf-lib colour
 *
 * @param hex {string} - colour in hexadecimal
 * @returns {ReturnType<typeof rgb>} - colour
 */
function hexColor(hex: string): ReturnType<typeof rgb> {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/**
 * Replaces characters the standard PDF fonts cannot encode, so user text can never break rendering
 *
 * @param font {PDFFont} - font used to draw
 * @param text {string} - text to sanitize
 * @returns {string} - printable text
 */
function printable(font: PDFFont, text: string): string {
  const normalized = text.replace(/[   ]/g, ' ');
  let out = '';
  for (const char of normalized) {
    try {
      font.encodeText(char);
      out += char;
    } catch {
      out += '?';
    }
  }
  return out;
}

/**
 * Splits text into lines that fit a width
 *
 * @param font {PDFFont} - font used to draw
 * @param text {string} - text to wrap, newlines kept
 * @param size {number} - font size
 * @param width {number} - available width in points
 * @returns {string[]} - wrapped lines
 */
function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of printable(font, text).split('\n')) {
    let current = '';
    for (const word of paragraph.split(' ')) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !current) current = candidate;
      else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

/**
 * Renders a quote, invoice or credit note as an A4 PDF using only built-in fonts; no user content is
 * ever interpreted, it is only drawn as text
 *
 * @param input {PdfInput} - document content
 * @returns {Promise<Uint8Array>} - PDF bytes
 */
export async function renderPdf(input: PdfInput): Promise<Uint8Array> {
  const label = LABELS[input.language];
  const money = (cents: number) => formatMoney(cents, input.currency, LOCALE_TAGS[input.language]);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(LOCALE_TAGS[input.language], { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(`${iso}T00:00:00Z`),
    );

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${label[input.type]} ${input.number ?? label.draft}`);
  pdf.setProducer('Almanach');
  pdf.setCreator('Almanach');
  const serif = input.style?.font === 'serif';
  const regular = await pdf.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const bold = await pdf.embedFont(serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const layout = input.style?.layout ?? 'classic';
  const accent = input.style ? hexColor(input.style.accent) : ACCENT;
  const titleColor = layout === 'minimal' ? INK : accent;
  const pages: PDFPage[] = [];
  let page = pdf.addPage([WIDTH, HEIGHT]);
  pages.push(page);
  let y = HEIGHT - MARGIN;

  const text = (value: string, x: number, size = 9.5, font = regular, color = INK) =>
    page.drawText(printable(font, value), { x, y, size, font, color });
  const right = (value: string, xRight: number, size = 9.5, font = regular, color = INK) => {
    const safe = printable(font, value);
    page.drawText(safe, { x: xRight - font.widthOfTextAtSize(safe, size), y, size, font, color });
  };
  const ensure = (needed: number) => {
    if (y - needed > MARGIN + 30) return;
    page = pdf.addPage([WIDTH, HEIGHT]);
    pages.push(page);
    y = HEIGHT - MARGIN;
  };

  if (input.draft) {
    page.drawText(label.draft, {
      x: 150,
      y: 380,
      size: 72,
      font: bold,
      color: rgb(0.93, 0.93, 0.9),
      opacity: 0.7,
    });
  }

  if (layout === 'band') {
    page.drawRectangle({ x: 0, y: HEIGHT - 14, width: WIDTH, height: 14, color: accent });
  }

  // Seller block (left) and document title (right).
  const top = y;
  const logo = input.style?.logo;
  if (logo) {
    // A logo that cannot be decoded is skipped rather than failing the whole document.
    const image = await (logo.mime === 'image/png'
      ? pdf.embedPng(logo.bytes)
      : pdf.embedJpg(logo.bytes)
    ).catch(() => null);
    if (image) {
      const scale = Math.min(48 / image.height, 160 / image.width, 1);
      page.drawImage(image, {
        x: MARGIN,
        y: y - image.height * scale + 10,
        width: image.width * scale,
        height: image.height * scale,
      });
      y -= image.height * scale + 8;
    }
  }
  text(input.seller.name, MARGIN, 15, bold);
  y -= 18;
  const sellerLines = [
    ...(input.seller.address ?? '').split('\n'),
    input.seller.email ?? '',
    ...Object.entries(input.seller.identifiers).map(
      ([key, value]) => `${key === 'vat' ? label.vatNumber : key.toUpperCase()} ${value}`,
    ),
  ].filter(Boolean);
  for (const line of sellerLines) {
    text(line, MARGIN, 9, regular, MUTED);
    y -= 12;
  }
  const afterSeller = y;
  y = top;
  right(label[input.type].toUpperCase(), WIDTH - MARGIN, 18, bold, titleColor);
  y -= 20;
  right(`${label.number} ${input.number ?? label.draft}`, WIDTH - MARGIN, 10, bold);
  y -= 14;
  right(`${label.issueDate} : ${date(input.issueDate)}`, WIDTH - MARGIN, 9, regular, MUTED);
  y -= 12;
  if (input.dueDate) {
    right(`${label.dueDate} : ${date(input.dueDate)}`, WIDTH - MARGIN, 9, regular, MUTED);
    y -= 12;
  }
  if (input.validUntil) {
    right(`${label.validUntil} : ${date(input.validUntil)}`, WIDTH - MARGIN, 9, regular, MUTED);
    y -= 12;
  }
  if (input.relatedNumber) {
    right(`${label.related} ${input.relatedNumber}`, WIDTH - MARGIN, 9, regular, MUTED);
    y -= 12;
  }

  // Buyer block.
  y = Math.min(y, afterSeller) - 18;
  text(label.billTo.toUpperCase(), MARGIN, 8, bold, MUTED);
  y -= 14;
  text(input.buyer.name, MARGIN, 11, bold);
  y -= 14;
  for (const line of [
    ...(input.buyer.address ?? '').split('\n'),
    input.buyer.vatNumber ? `${label.vatNumber} ${input.buyer.vatNumber}` : '',
  ].filter(Boolean)) {
    text(line, MARGIN, 9, regular, MUTED);
    y -= 12;
  }

  // Lines table.
  const columns = { quantity: 330, unit: 375, unitPrice: 470, amount: WIDTH - MARGIN };
  y -= 16;
  page.drawLine({
    start: { x: MARGIN, y: y + 12 },
    end: { x: WIDTH - MARGIN, y: y + 12 },
    color: layout === 'classic' ? LINE : accent,
    thickness: layout === 'classic' ? 1 : 1.5,
  });
  text(label.description, MARGIN, 8, bold, MUTED);
  right(label.quantity, columns.quantity, 8, bold, MUTED);
  text(label.unit, columns.unit, 8, bold, MUTED);
  right(label.unitPrice, columns.unitPrice, 8, bold, MUTED);
  right(label.amount, columns.amount, 8, bold, MUTED);
  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, color: LINE, thickness: 1 });
  y -= 14;
  const unitLabel = {
    hour: label.hour,
    day: label.day,
    month: label.month,
    flat: label.flat,
    unit: label.unitName,
  };
  for (const line of input.lines) {
    const wrapped = wrap(regular, line.description, 9.5, columns.quantity - MARGIN - 40);
    ensure(wrapped.length * 12 + 6);
    const quantity = new Intl.NumberFormat(LOCALE_TAGS[input.language], { maximumFractionDigits: 3 }).format(
      line.quantity / QUANTITY_SCALE,
    );
    right(quantity, columns.quantity);
    text(unitLabel[line.unit], columns.unit, 9.5, regular, MUTED);
    right(money(line.unitPriceCents), columns.unitPrice);
    right(money(lineAmount(line)), columns.amount, 9.5, bold);
    for (const [index, part] of wrapped.entries()) {
      text(part, MARGIN);
      if (index < wrapped.length - 1) y -= 12;
    }
    if (line.discountBp > 0) {
      y -= 11;
      text(`${label.discount} ${line.discountBp / 100} %`, MARGIN, 8, regular, MUTED);
    }
    y -= 18;
  }
  page.drawLine({
    start: { x: MARGIN, y: y + 8 },
    end: { x: WIDTH - MARGIN, y: y + 8 },
    color: LINE,
    thickness: 1,
  });

  // Totals.
  const totals = input.totals;
  const rows: [string, string, boolean][] = [];
  if (totals.discountCents > 0) {
    rows.push([label.subtotal, money(totals.linesCents), false]);
    rows.push([label.discount, `- ${money(totals.discountCents)}`, false]);
  }
  rows.push([label.net, money(totals.netCents), false]);
  if (totals.vatRateBp > 0)
    rows.push([`${label.vat} ${totals.vatRateBp / 100} %`, money(totals.vatCents), false]);
  if (totals.depositsCents > 0) rows.push([label.deposits, `- ${money(totals.depositsCents)}`, false]);
  rows.push([input.type === 'quote' ? label.totalQuote : label.total, money(totals.totalCents), true]);
  ensure(rows.length * 16 + 20);
  y -= 10;
  for (const [name, value, strong] of rows) {
    right(name, columns.unitPrice, strong ? 11 : 9.5, strong ? bold : regular, strong ? INK : MUTED);
    right(value, columns.amount, strong ? 11 : 9.5, strong ? bold : regular);
    y -= strong ? 20 : 15;
  }

  // Mentions, note and bank details.
  const footer: [string, PDFFont, number][] = [];
  for (const mention of input.mentions) footer.push([mention, regular, 8.5]);
  if (input.note) footer.push([input.note, regular, 9]);
  const bank = input.seller.bank;
  if (bank && bank.format !== 'none' && input.type !== 'quote') {
    const details =
      bank.format === 'iban'
        ? `IBAN ${bank.iban.replace(/(.{4})/g, '$1 ').trim()}${bank.bic ? `   BIC ${bank.bic}` : ''}`
        : bank.format === 'uk'
          ? `Sort code ${bank.sortCode}   Account ${bank.account}`
          : `Routing ${bank.routing}   Account ${bank.account}`;
    footer.push([`${label.bank}${input.language === 'fr' ? ' :' : ':'} ${details}`, bold, 9]);
  }
  y -= 10;
  for (const [content, font, size] of footer) {
    const wrapped = wrap(font, content, size, WIDTH - 2 * MARGIN);
    ensure(wrapped.length * (size + 3) + 8);
    for (const part of wrapped) {
      text(part, MARGIN, size, font, font === bold ? INK : MUTED);
      y -= size + 3;
    }
    y -= 6;
  }

  for (const [index, current] of pages.entries()) {
    const footerText = printable(
      regular,
      `${input.seller.name} · ${label.page} ${index + 1}/${pages.length}`,
    );
    current.drawText(footerText, { x: MARGIN, y: MARGIN - 20, size: 7.5, font: regular, color: MUTED });
  }
  return pdf.save();
}
