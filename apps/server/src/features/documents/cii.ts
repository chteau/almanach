import { amount, decimal, type EnInvoice, type EnParty, type EnVatBreakdown } from '@almanach/shared';
import { xmlEscape } from './pdfa.ts';

/**
 * Element with escaped text content, omitted when the value is empty
 *
 * @param name {string} - qualified element name
 * @param value {string | null | undefined} - text
 * @param attributes {string} - raw attributes, already safe
 * @returns {string} - XML, or an empty string
 */
function el(name: string, value: string | null | undefined, attributes = ''): string {
  return value ? `<${name}${attributes}>${xmlEscape(value)}</${name}>` : '';
}

/**
 * CII date (format 102: YYYYMMDD)
 *
 * @param name {string} - wrapping element
 * @param iso {string} - YYYY-MM-DD
 * @param type {'udt' | 'qdt'} - data type namespace
 * @returns {string} - XML
 */
function date(name: string, iso: string, type: 'udt' | 'qdt' = 'udt'): string {
  return `<${name}><${type}:DateTimeString format="102">${iso.replaceAll('-', '')}</${type}:DateTimeString></${name}>`;
}

/**
 * VAT percentage of a category: none outside the scope of VAT (BR-O-05), 0 for exemptions (BR-E-05, BR-AE-05)
 *
 * @param vat {EnVatBreakdown} - VAT breakdown
 * @returns {string} - RateApplicablePercent element or nothing
 */
function rate(vat: EnVatBreakdown): string {
  return vat.category === 'O' ? '' : el('ram:RateApplicablePercent', decimal(BigInt(vat.rateBp), 2, 2));
}

/**
 * Seller or buyer trade party, in the element order of the CII D16B schema
 *
 * @param name {string} - SellerTradeParty or BuyerTradeParty
 * @param party {EnParty} - party
 * @returns {string} - XML
 */
function party(name: string, party: EnParty): string {
  const [one, two, three] = party.address.lines;
  return `<ram:${name}>${el('ram:Name', party.name)}${
    party.legalId
      ? `<ram:SpecifiedLegalOrganization>${el('ram:ID', party.legalId.id, ` schemeID="${xmlEscape(party.legalId.scheme)}"`)}</ram:SpecifiedLegalOrganization>`
      : ''
  }<ram:PostalTradeAddress>${el('ram:PostcodeCode', party.address.postalCode)}${el('ram:LineOne', one)}${el('ram:LineTwo', two)}${el('ram:LineThree', three)}${el('ram:CityName', party.address.city)}${el('ram:CountryID', party.address.country)}</ram:PostalTradeAddress>${
    party.electronicAddress
      ? `<ram:URIUniversalCommunication>${el('ram:URIID', party.electronicAddress.id, ` schemeID="${xmlEscape(party.electronicAddress.scheme)}"`)}</ram:URIUniversalCommunication>`
      : ''
  }${party.vatId ? `<ram:SpecifiedTaxRegistration>${el('ram:ID', party.vatId, ' schemeID="VA"')}</ram:SpecifiedTaxRegistration>` : ''}${
    party.taxId
      ? `<ram:SpecifiedTaxRegistration>${el('ram:ID', party.taxId, ' schemeID="FC"')}</ram:SpecifiedTaxRegistration>`
      : ''
  }</ram:${name}>`;
}

/**
 * Serialises an EN 16931 invoice as UN/CEFACT CII D16B, Factur-X profile EN16931 (`factur-x.xml`)
 *
 * @param invoice {EnInvoice} - semantic invoice
 * @returns {string} - XML document
 */
export function toCii(invoice: EnInvoice): string {
  const { vat, totals, currency } = invoice;
  const money = (name: string, cents: number, withCurrency = false) =>
    `<${name}${withCurrency ? ` currencyID="${xmlEscape(currency)}"` : ''}>${amount(cents)}</${name}>`;
  const tax = `<ram:TypeCode>VAT</ram:TypeCode>${el('ram:CategoryCode', vat.category)}`;

  const lines = invoice.lines
    .map(
      (line) =>
        `<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument>${el('ram:LineID', line.id)}</ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct>${el('ram:Name', line.name)}</ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement><ram:GrossPriceProductTradePrice>${el('ram:ChargeAmount', line.grossPrice)}${
          line.priceDiscount
            ? `<ram:AppliedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>${el('ram:ActualAmount', line.priceDiscount)}</ram:AppliedTradeAllowanceCharge>`
            : ''
        }</ram:GrossPriceProductTradePrice><ram:NetPriceProductTradePrice>${el('ram:ChargeAmount', line.netPrice)}</ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery>${el('ram:BilledQuantity', line.quantity, ` unitCode="${line.unitCode}"`)}</ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax>${tax}${rate(vat)}</ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation>${money('ram:LineTotalAmount', line.netCents)}</ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`,
    )
    .join('');

  const payment = invoice.payment
    ? `<ram:SpecifiedTradeSettlementPaymentMeans>${el('ram:TypeCode', invoice.payment.meansCode)}<ram:PayeePartyCreditorFinancialAccount>${el('ram:IBANID', invoice.payment.iban)}</ram:PayeePartyCreditorFinancialAccount>${
        invoice.payment.bic
          ? `<ram:PayeeSpecifiedCreditorFinancialInstitution>${el('ram:BICID', invoice.payment.bic)}</ram:PayeeSpecifiedCreditorFinancialInstitution>`
          : ''
      }</ram:SpecifiedTradeSettlementPaymentMeans>`
    : '';
  const allowance = invoice.allowance
    ? `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>${money('ram:ActualAmount', invoice.allowance.amountCents)}${el('ram:ReasonCode', invoice.allowance.reasonCode)}<ram:CategoryTradeTax>${tax}${rate(vat)}</ram:CategoryTradeTax></ram:SpecifiedTradeAllowanceCharge>`
    : '';
  const preceding = invoice.precedingInvoice
    ? `<ram:InvoiceReferencedDocument>${el('ram:IssuerAssignedID', invoice.precedingInvoice.number)}${
        invoice.precedingInvoice.issueDate
          ? date('ram:FormattedIssueDateTime', invoice.precedingInvoice.issueDate, 'qdt')
          : ''
      }</ram:InvoiceReferencedDocument>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"><rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter>${el('ram:ID', invoice.specification)}</ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext><rsm:ExchangedDocument>${el('ram:ID', invoice.number)}${el('ram:TypeCode', invoice.typeCode)}${date('ram:IssueDateTime', invoice.issueDate)}${invoice.notes
    .map((note) => `<ram:IncludedNote>${el('ram:Content', note)}</ram:IncludedNote>`)
    .join(
      '',
    )}</rsm:ExchangedDocument><rsm:SupplyChainTradeTransaction>${lines}<ram:ApplicableHeaderTradeAgreement>${el('ram:BuyerReference', invoice.buyerReference)}${party('SellerTradeParty', invoice.seller)}${party('BuyerTradeParty', invoice.buyer)}</ram:ApplicableHeaderTradeAgreement><ram:ApplicableHeaderTradeDelivery/><ram:ApplicableHeaderTradeSettlement>${el('ram:InvoiceCurrencyCode', currency)}${payment}<ram:ApplicableTradeTax>${money('ram:CalculatedAmount', vat.taxCents)}<ram:TypeCode>VAT</ram:TypeCode>${el('ram:ExemptionReason', vat.exemptionReason)}${money('ram:BasisAmount', vat.basisCents)}${el('ram:CategoryCode', vat.category)}${el('ram:ExemptionReasonCode', vat.exemptionCode)}${rate(vat)}</ram:ApplicableTradeTax>${allowance}${
    invoice.dueDate
      ? `<ram:SpecifiedTradePaymentTerms>${date('ram:DueDateDateTime', invoice.dueDate)}</ram:SpecifiedTradePaymentTerms>`
      : ''
  }<ram:SpecifiedTradeSettlementHeaderMonetarySummation>${money('ram:LineTotalAmount', totals.linesCents)}${
    totals.allowanceCents > 0 ? money('ram:AllowanceTotalAmount', totals.allowanceCents) : ''
  }${money('ram:TaxBasisTotalAmount', totals.taxBasisCents)}${money('ram:TaxTotalAmount', totals.taxCents, true)}${money('ram:GrandTotalAmount', totals.grandCents)}${
    totals.prepaidCents > 0 ? money('ram:TotalPrepaidAmount', totals.prepaidCents) : ''
  }${money('ram:DuePayableAmount', totals.dueCents)}</ram:SpecifiedTradeSettlementHeaderMonetarySummation>${preceding}</ram:ApplicableHeaderTradeSettlement></rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>
`;
}
