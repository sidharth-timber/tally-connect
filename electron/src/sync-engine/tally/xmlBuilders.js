const { create } = require('xmlbuilder2');

// Creates a ledger under an arbitrary name/parent — used for the Phase 2b
// create-fallback: when a Timber account has no Tally ledger mapped to it
// yet, we create one under the SAME name the account has in Timber (instead
// of posting to an unrelated default/category-derived ledger). Matching the
// name is deliberate: the next COA re-import's auto_match (exact-name tier)
// will map this ledger straight back to the Timber account with no CA action.
function buildCustomLedgerXML(name, parentName, fallbackParent) {
  return create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER').ele('TALLYREQUEST').txt('Import Data').up().up()
      .ele('BODY').ele('IMPORTDATA')
        .ele('REQUESTDESC').ele('REPORTNAME').txt('All Masters').up().up()
        .ele('REQUESTDATA').ele('TALLYMESSAGE')
          .ele('LEDGER', { NAME: name, RESERVEDNAME: '' })
            .ele('NAME').txt(name).up()
            .ele('PARENT').txt(parentName || fallbackParent).up()
          .up()
        .up().up()
      .up()
    .end({ prettyPrint: true });
}

// 🧱 Unit "PIECES"
function buildUnitXML() {
  return create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER')
        .ele('TALLYREQUEST').txt('Import Data').up()
      .up()
      .ele('BODY')
        .ele('IMPORTDATA')
          .ele('REQUESTDESC')
            .ele('REPORTNAME').txt('All Masters').up()
          .up()
          .ele('REQUESTDATA')
            .ele('TALLYMESSAGE', { xmlns: 'TallyUDF' })
              .ele('UNIT', { NAME: 'PIECES', ACTION: 'Create' })
                .ele('NAME').txt('PIECES').up()
                .ele('ISSIMPLEUNIT').txt('Yes').up()
                .ele('DECIMALPLACES').txt('0').up()
              .up()
            .up()
          .up()
        .up()
      .up()
    .end({ prettyPrint: true });
}

// `party` ({ gstin, state }, optional): when the backend knows the party's GSTIN
// / state, register them on the new ledger so Tally's GST reports classify it.
// Only applied on creation — an existing ledger returns "already exists" and
// is left untouched.
function buildLedgerXML(customerName, party = {}) {
  const gstin = (party.gstin || '').trim();
  const state = (party.state || '').trim();
  const ledger = create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER').ele('TALLYREQUEST').txt('Import Data').up().up()
      .ele('BODY').ele('IMPORTDATA')
        .ele('REQUESTDESC').ele('REPORTNAME').txt('All Masters').up().up()
        .ele('REQUESTDATA').ele('TALLYMESSAGE')
          .ele('LEDGER', { NAME: customerName, RESERVEDNAME: '' });
  ledger.ele('NAME').txt(customerName);
  ledger.ele('PARENT').txt('Sundry Debtors');
  ledger.ele('ISBILLWISEON').txt('Yes');
  if (gstin || state) {
    ledger.ele('COUNTRYOFRESIDENCE').txt('India');
    if (state) {
      ledger.ele('LEDMAILINGDETAILS.LIST')
        .ele('APPLICABLEFROM').txt('20010401').up()
        .ele('MAILINGNAME').txt(customerName).up()
        .ele('STATE').txt(state).up()
        .ele('COUNTRY').txt('India');
    }
    if (gstin) {
      ledger.ele('PARTYGSTIN').txt(gstin);
      ledger.ele('LEDGSTREGDETAILS.LIST')
        .ele('APPLICABLEFROM').txt('20170701').up()
        .ele('GSTREGISTRATIONTYPE').txt('Regular').up()
        .ele('GSTIN').txt(gstin);
    }
  }
  return ledger.doc().end({ prettyPrint: true });
}

function buildSalesLedgerXML() {
  return create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER')
        .ele('TALLYREQUEST').txt('Import Data').up()
      .up()
      .ele('BODY')
        .ele('IMPORTDATA')
          .ele('REQUESTDESC')
            .ele('REPORTNAME').txt('All Masters').up()
          .up()
          .ele('REQUESTDATA')
            .ele('TALLYMESSAGE')
              .ele('LEDGER', { NAME: 'Sales Account', RESERVEDNAME: '' })
                .ele('NAME').txt('Sales Account').up()
                .ele('PARENT').txt('Sales Accounts').up()
                .ele('ISREVENUE').txt('Yes').up()
                .ele('AFFECTSGST').txt('No').up()
                .ele('ISDEEMEDPOSITIVE').txt('No').up()
                .ele('USEFORVAT').txt('No').up()
                .ele('ISPARTYLEDGER').txt('No').up()
                .ele('ISBILLWISEON').txt('No').up()
                .ele('ISINACTIVE').txt('No').up()
              .up()
            .up()
          .up()
        .up()
      .up()
    .end({ prettyPrint: true });
}

function buildItemXML(itemName, gstRate, hsnCode) {
  const centralRate = (gstRate || 0) / 2;
  const stateRate = (gstRate || 0) / 2;

  return create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER')
        .ele('TALLYREQUEST').txt('Import Data').up()
      .up()
      .ele('BODY')
        .ele('IMPORTDATA')
          .ele('REQUESTDESC')
            .ele('REPORTNAME').txt('All Masters').up()
          .up()
          .ele('REQUESTDATA')
            .ele('TALLYMESSAGE')
              .ele('STOCKITEM', { NAME: itemName, RESERVEDNAME: '' })
                .ele('NAME').txt(itemName).up()
                .ele('PARENT').txt('Primary').up()
                .ele('BASEUNITS').txt('PIECES').up()
                .ele('ISSTOCKITEM').txt('Yes').up()
                .ele('HSNDETAILS.LIST')
                  .ele('APPLICABLEFROM').txt('20010401').up()
                  .ele('HSNCODE').txt(hsnCode || '').up()
                  .ele('TAXABILITY').txt('Taxable').up()
                  .ele('GSTRATE').txt((gstRate || 0).toString()).up()
                  .ele('INTEGRATEDTAXRATE').txt((gstRate || 0).toString()).up()
                  .ele('CENTRALTAXRATE').txt(centralRate.toString()).up()
                  .ele('STATETAXRATE').txt(stateRate.toString()).up()
                .up()
              .up()
            .up()
          .up()
        .up()
      .up()
    .end({ prettyPrint: true });
}

function buildGSTLedgerXML(name, gstHead) {
  return create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER')
        .ele('TALLYREQUEST').txt('Import Data').up()
      .up()
      .ele('BODY')
        .ele('IMPORTDATA')
          .ele('REQUESTDESC')
            .ele('REPORTNAME').txt('All Masters').up()
          .up()
          .ele('REQUESTDATA')
            .ele('TALLYMESSAGE')
              .ele('LEDGER', { NAME: name, RESERVEDNAME: '' })
                .ele('NAME').txt(name).up()
                .ele('PARENT').txt('Duties & Taxes').up()
                .ele('TAXTYPE').txt('GST').up()
                .ele('GSTDUTYHEAD').txt(gstHead).up()
              .up()
            .up()
          .up()
        .up()
      .up()
    .end({ prettyPrint: true });
}

function buildStockGroupXML() {
  return create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER')
        .ele('TALLYREQUEST').txt('Import Data').up()
      .up()
      .ele('BODY')
        .ele('IMPORTDATA')
          .ele('REQUESTDESC')
            .ele('REPORTNAME').txt('All Masters').up()
          .up()
          .ele('REQUESTDATA')
            .ele('TALLYMESSAGE')
              .ele('STOCKGROUP', { NAME: 'Primary', ACTION: 'Create' })
                .ele('NAME').txt('Primary').up()
              .up()
            .up()
          .up()
        .up()
      .up()
    .end({ prettyPrint: true });
}

// 🏗️ Sales invoice XML matching Tally Prime's own export structure exactly
function buildInvoiceXML_FULL(invoice) {
  const rawDate = invoice.invoice_date || invoice.issue_date || new Date().toISOString();
  const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
    .split('T')[0].replace(/-/g, '');
  const customerName = invoice.customer?.name || invoice.customerName || 'Unknown Customer';

  const subtotal = invoice.subtotal || invoice.items.reduce((sum, item) => {
    return sum + (item.quantity || item.qty || 1) * (item.unit_price || item.rate || 0);
  }, 0);
  const cgst = invoice.cgst || 0;
  const sgst = invoice.sgst || 0;
  const igst = invoice.igst || 0;
  const total = invoice.total || (subtotal + cgst + sgst + igst);

  const doc = create({ version: '1.0' });
  const envelope = doc.ele('ENVELOPE');
  envelope.ele('HEADER').ele('TALLYREQUEST').txt('Import Data');

  const importData = envelope.ele('BODY').ele('IMPORTDATA');
  importData.ele('REQUESTDESC').ele('REPORTNAME').txt('Vouchers');

  const voucher = importData.ele('REQUESTDATA')
    .ele('TALLYMESSAGE', { 'xmlns:UDF': 'TallyUDF' })
    .ele('VOUCHER', { VCHTYPE: 'Sales', ACTION: 'Create', OBJVIEW: 'Invoice Voucher View' });

  voucher.ele('DATE').txt(dateStr);
  voucher.ele('EFFECTIVEDATE').txt(dateStr);
  voucher.ele('VOUCHERTYPENAME').txt('Sales');
  voucher.ele('VOUCHERNUMBER').txt(invoice.invoice_number || '');
  voucher.ele('PARTYLEDGERNAME').txt(customerName);
  voucher.ele('PERSISTEDVIEW').txt('Invoice Voucher View');
  voucher.ele('VCHENTRYMMODE').txt('Item Invoice');
  voucher.ele('ISGSTOVERRIDDEN').txt('No');
  voucher.ele('ISINVOICE').txt('Yes');
  voucher.ele('NARRATION').txt(invoice.notes || '');

  for (const item of invoice.items) {
    const quantity = item.quantity || item.qty || 1;
    const rate = item.unit_price || item.rate || 0;
    const itemAmount = quantity * rate;
    const itemName = item.title || item.name || item.desc || 'Unknown Item';

    const inv = voucher.ele('ALLINVENTORYENTRIES.LIST');
    inv.ele('STOCKITEMNAME').txt(itemName);
    inv.ele('ISDEEMEDPOSITIVE').txt('No');
    inv.ele('RATE').txt(`${rate}/PIECES`);
    inv.ele('AMOUNT').txt(itemAmount.toString());
    inv.ele('ACTUALQTY').txt(`${quantity} PIECES`);
    inv.ele('BILLEDQTY').txt(`${quantity} PIECES`);

    const batch = inv.ele('BATCHALLOCATIONS.LIST');
    batch.ele('GODOWNNAME').txt('Main Location');
    batch.ele('BATCHNAME').txt('Primary Batch');
    batch.ele('AMOUNT').txt(itemAmount.toString());
    batch.ele('ACTUALQTY').txt(`${quantity} PIECES`);
    batch.ele('BILLEDQTY').txt(`${quantity} PIECES`);

    const salesAlloc = inv.ele('ACCOUNTINGALLOCATIONS.LIST');
    salesAlloc.ele('LEDGERNAME').txt('Sales Account');
    salesAlloc.ele('ISDEEMEDPOSITIVE').txt('No');
    salesAlloc.ele('ISPARTYLEDGER').txt('No');
    salesAlloc.ele('AMOUNT').txt(itemAmount.toString());

    if (cgst > 0) {
      const e = inv.ele('ACCOUNTINGALLOCATIONS.LIST');
      e.ele('LEDGERNAME').txt('CGST');
      e.ele('ISDEEMEDPOSITIVE').txt('No');
      e.ele('ISPARTYLEDGER').txt('No');
      e.ele('AMOUNT').txt(cgst.toString());
    }
    if (sgst > 0) {
      const e = inv.ele('ACCOUNTINGALLOCATIONS.LIST');
      e.ele('LEDGERNAME').txt('SGST');
      e.ele('ISDEEMEDPOSITIVE').txt('No');
      e.ele('ISPARTYLEDGER').txt('No');
      e.ele('AMOUNT').txt(sgst.toString());
    }
    if (igst > 0) {
      const e = inv.ele('ACCOUNTINGALLOCATIONS.LIST');
      e.ele('LEDGERNAME').txt('IGST');
      e.ele('ISDEEMEDPOSITIVE').txt('No');
      e.ele('ISPARTYLEDGER').txt('No');
      e.ele('AMOUNT').txt(igst.toString());
    }
  }

  const custEntry = voucher.ele('LEDGERENTRIES.LIST');
  custEntry.ele('LEDGERNAME').txt(customerName);
  custEntry.ele('ISDEEMEDPOSITIVE').txt('Yes');
  custEntry.ele('ISPARTYLEDGER').txt('Yes');
  custEntry.ele('AMOUNT').txt('-' + total.toString());

  const bill = custEntry.ele('BILLALLOCATIONS.LIST');
  bill.ele('NAME').txt(invoice.invoice_number || '');
  bill.ele('BILLTYPE').txt('New Ref');
  bill.ele('AMOUNT').txt('-' + total.toString());

  return doc.end({ prettyPrint: true });
}

// 🏗️ Sales invoice XML matching Tally's "GST Invoice" voucher type export exactly
// `gstin`/`state` are the syncing company's own registration details (used to be module-level
// TALLY_GSTIN/TALLY_STATE in agent.js — now passed explicitly per call).
// `ledgerNames` (Phase 2, optional) overrides the hardcoded default ledger
// names with the CA-confirmed Tally ledger the corresponding Timber account
// maps to — so the voucher posts against a ledger that actually exists in the
// client's Tally file rather than always the generic default. Any role not
// present in `ledgerNames` falls back to today's hardcoded name unchanged.
// `invoice.account_ledger_name` (Phase 2b, optional) — when THIS specific
// invoice was posted to a particular revenue account, that per-transaction
// mapping wins over the company-wide "sales" role, which only reflects one
// well-known account and would be wrong for any other income account.
// `invoice.account_create_name`/`account_create_parent` (Phase 2c, optional):
// when that account has no Tally mapping at all, use its own Timber name
// instead of the company-wide/hardcoded default — the caller (invoiceLoop.js)
// creates this ledger in Tally before the voucher posts.
function buildInvoiceXML(invoice, { gstin, state, ledgerNames = {} } = {}) {
  const salesLedger = invoice.account_ledger_name
    || invoice.account_create_name
    || ledgerNames.sales
    || 'Sales Account';
  const cgstLedger = ledgerNames.output_cgst || 'CGST';
  const sgstLedger = ledgerNames.output_sgst || 'SGST';
  const igstLedger = ledgerNames.output_igst || 'IGST';
  const rawDate = invoice.invoice_date || invoice.issue_date || new Date().toISOString();
  const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
    .split('T')[0].replace(/-/g, '');
  const customerName = invoice.customer?.name || invoice.customerName || 'Unknown Customer';
  const voucherNumber = invoice.invoice_number || '';

  const subtotal = invoice.subtotal || (invoice.items || []).reduce((sum, item) => {
    return sum + (item.quantity || item.qty || 1) * (item.unit_price || item.rate || 0);
  }, 0);
  const cgst = invoice.cgst || 0;
  const sgst = invoice.sgst || 0;
  const igst = invoice.igst || 0;
  const cess = invoice.cess || 0;
  const discount = invoice.discount_amount || 0;
  const roundOff = invoice.round_off || 0;
  const total = invoice.total || (subtotal - discount + cgst + sgst + igst + cess + roundOff);
  const cessLedger = ledgerNames.output_cess || 'Cess';
  const discountLedger = ledgerNames.discount || 'Discount Allowed';
  const roundOffLedger = ledgerNames.round_off || 'Round Off';

  // Item amounts (net of line discounts) must sum to `subtotal` for the
  // voucher to balance; fold any paise drift into the last row.
  const itemRows = invoice.items || [];
  const rowAmount = item => item.amount ?? (item.quantity || item.qty || 1) * (item.unit_price || item.rate || 0);
  const drift = itemRows.length
    ? Math.round((subtotal - itemRows.reduce((sum, item) => sum + rowAmount(item), 0)) * 100) / 100
    : 0;

  const doc = create({ version: '1.0' });
  const envelope = doc.ele('ENVELOPE');
  envelope.ele('HEADER').ele('TALLYREQUEST').txt('Import Data');
  const importData = envelope.ele('BODY').ele('IMPORTDATA');
  importData.ele('REQUESTDESC').ele('REPORTNAME').txt('Vouchers');

  const voucher = importData.ele('REQUESTDATA')
    .ele('TALLYMESSAGE', { 'xmlns:UDF': 'TallyUDF' })
    .ele('VOUCHER', { VCHTYPE: 'Sales', ACTION: 'Create', OBJVIEW: 'Invoice Voucher View' });

  voucher.ele('DATE').txt(dateStr);
  voucher.ele('EFFECTIVEDATE').txt(dateStr);
  voucher.ele('GSTREGISTRATIONTYPE').txt('Regular');
  voucher.ele('STATENAME').txt(state || '');
  voucher.ele('COUNTRYOFRESIDENCE').txt('India');
  voucher.ele('PLACEOFSUPPLY').txt(state || '');
  voucher.ele('VOUCHERTYPENAME').txt('Sales');
  voucher.ele('PARTYNAME').txt(customerName);
  voucher.ele('CMPGSTIN').txt(gstin || '');
  voucher.ele('PARTYLEDGERNAME').txt(customerName);
  voucher.ele('VOUCHERNUMBER').txt(voucherNumber);
  voucher.ele('BASICBUYERNAME').txt(customerName);
  voucher.ele('CMPGSTREGISTRATIONTYPE').txt('Regular');
  voucher.ele('PARTYMAILINGNAME').txt(customerName);
  voucher.ele('CONSIGNEEMAILINGNAME').txt(customerName);
  voucher.ele('CONSIGNEESTATENAME').txt(state || '');
  voucher.ele('CMPGSTSTATE').txt(state || '');
  voucher.ele('CONSIGNEECOUNTRYNAME').txt('India');
  voucher.ele('BASICBASEPARTYNAME').txt(customerName);
  voucher.ele('PERSISTEDVIEW').txt('Invoice Voucher View');
  voucher.ele('VCHENTRYMODE').txt('Item Invoice');
  voucher.ele('ISGSTOVERRIDDEN').txt('No');
  voucher.ele('ISINVOICE').txt('Yes');
  voucher.ele('VCHGSTSTATUSISUNCERTAIN').txt('Yes');
  voucher.ele('VCHGSTSTATUSISAPPLICABLE').txt('Yes');
  voucher.ele('NARRATION').txt(invoice.notes || '');

  itemRows.forEach((item, idx) => {
    const quantity = item.quantity || item.qty || 1;
    const baseAmount = rowAmount(item);
    const itemAmount = idx === itemRows.length - 1 ? Math.round((baseAmount + drift) * 100) / 100 : baseAmount;
    const rate = itemAmount !== baseAmount ? itemAmount / quantity : (item.unit_price || item.rate || 0);
    const itemName = item.title || item.name || item.desc || 'Unknown Item';
    const gstRate = item.gst_rate || 0;

    const inv = voucher.ele('ALLINVENTORYENTRIES.LIST');
    inv.ele('STOCKITEMNAME').txt(itemName);
    inv.ele('ISDEEMEDPOSITIVE').txt('No');
    inv.ele('RATE').txt(`${rate}/PIECES`);
    inv.ele('AMOUNT').txt(itemAmount.toString());
    inv.ele('ACTUALQTY').txt(`${quantity} PIECES`);
    inv.ele('BILLEDQTY').txt(`${quantity} PIECES`);

    const batch = inv.ele('BATCHALLOCATIONS.LIST');
    batch.ele('GODOWNNAME').txt('Main Location');
    batch.ele('BATCHNAME').txt('Primary Batch');
    batch.ele('AMOUNT').txt(itemAmount.toString());
    batch.ele('ACTUALQTY').txt(`${quantity} PIECES`);
    batch.ele('BILLEDQTY').txt(`${quantity} PIECES`);

    const salesAlloc = inv.ele('ACCOUNTINGALLOCATIONS.LIST');
    salesAlloc.ele('LEDGERNAME').txt(salesLedger);
    salesAlloc.ele('ISDEEMEDPOSITIVE').txt('No');
    salesAlloc.ele('ISPARTYLEDGER').txt('No');
    salesAlloc.ele('AMOUNT').txt(itemAmount.toString());

    const cgstRateEntry = inv.ele('RATEDETAILS.LIST');
    cgstRateEntry.ele('GSTRATEDUTYHEAD').txt('CGST');
    cgstRateEntry.ele('GSTRATEVALUATIONTYPE').txt('Based on Value');
    cgstRateEntry.ele('GSTRATE').txt((gstRate / 2).toString());

    const sgstRateEntry = inv.ele('RATEDETAILS.LIST');
    sgstRateEntry.ele('GSTRATEDUTYHEAD').txt('SGST/UTGST');
    sgstRateEntry.ele('GSTRATEVALUATIONTYPE').txt('Based on Value');
    sgstRateEntry.ele('GSTRATE').txt((gstRate / 2).toString());

    const igstRateEntry = inv.ele('RATEDETAILS.LIST');
    igstRateEntry.ele('GSTRATEDUTYHEAD').txt('IGST');
    igstRateEntry.ele('GSTRATEVALUATIONTYPE').txt('Based on Value');
    igstRateEntry.ele('GSTRATE').txt(gstRate.toString());
  });

  const custEntry = voucher.ele('LEDGERENTRIES.LIST');
  custEntry.ele('LEDGERNAME').txt(customerName);
  custEntry.ele('ISDEEMEDPOSITIVE').txt('Yes');
  custEntry.ele('ISPARTYLEDGER').txt('Yes');
  custEntry.ele('AMOUNT').txt('-' + total.toString());
  const bill = custEntry.ele('BILLALLOCATIONS.LIST');
  bill.ele('NAME').txt(voucherNumber);
  bill.ele('BILLTYPE').txt('New Ref');
  bill.ele('AMOUNT').txt('-' + total.toString());

  if (cgst > 0) {
    const e = voucher.ele('LEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt(cgstLedger);
    e.ele('ISDEEMEDPOSITIVE').txt('No');
    e.ele('ISPARTYLEDGER').txt('No');
    e.ele('REMOVEZEROENTRIES').txt('No');
    e.ele('AMOUNT').txt(cgst.toString());
    e.ele('VATEXPAMOUNT').txt(cgst.toString());
  }
  if (sgst > 0) {
    const e = voucher.ele('LEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt(sgstLedger);
    e.ele('ISDEEMEDPOSITIVE').txt('No');
    e.ele('ISPARTYLEDGER').txt('No');
    e.ele('REMOVEZEROENTRIES').txt('No');
    e.ele('AMOUNT').txt(sgst.toString());
    e.ele('VATEXPAMOUNT').txt(sgst.toString());
  }
  if (igst > 0) {
    const e = voucher.ele('LEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt(igstLedger);
    e.ele('ISDEEMEDPOSITIVE').txt('No');
    e.ele('ISPARTYLEDGER').txt('No');
    e.ele('REMOVEZEROENTRIES').txt('No');
    e.ele('AMOUNT').txt(igst.toString());
    e.ele('VATEXPAMOUNT').txt(igst.toString());
  }
  if (cess > 0) {
    const e = voucher.ele('LEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt(cessLedger);
    e.ele('ISDEEMEDPOSITIVE').txt('No');
    e.ele('ISPARTYLEDGER').txt('No');
    e.ele('AMOUNT').txt(cess.toString());
  }
  // Invoice-level discount is a debit (reduces what the customer owes).
  if (discount > 0) {
    const e = voucher.ele('LEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt(discountLedger);
    e.ele('ISDEEMEDPOSITIVE').txt('Yes');
    e.ele('ISPARTYLEDGER').txt('No');
    e.ele('AMOUNT').txt('-' + discount);
  }
  // Round-off: positive raises the customer's bill (credit), negative lowers it (debit).
  if (roundOff !== 0) {
    const e = voucher.ele('LEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt(roundOffLedger);
    e.ele('ISDEEMEDPOSITIVE').txt(roundOff < 0 ? 'Yes' : 'No');
    e.ele('ISPARTYLEDGER').txt('No');
    e.ele('AMOUNT').txt(String(roundOff));
  }

  return doc.end({ prettyPrint: true });
}

// 🧾 Receipt voucher XML (Timber → Tally customer payment)
// `ledgerNames.cash`/`ledgerNames.bank` (Phase 2, optional) override the
// hardcoded "Cash" ledger — Timber doesn't currently record which account a
// receipt was received into, so this always prefers the mapped cash ledger,
// falling back to the mapped bank ledger, then the hardcoded default.
// `p.account_ledger_name` (Phase 2b, optional): when this specific receipt
// was recorded against a chosen bank/cash account, that wins over the
// company-wide cash/bank role — Timber tracks a "Received In Account" per
// payment, so this is exact rather than a guess.
// `p.account_create_name`/`account_create_parent` (Phase 2c, optional):
// create-fallback when that account has no Tally mapping — see buildInvoiceXML.
function buildReceiptXML(p, ledgerNames = {}) {
  const cashLedger = p.account_ledger_name
    || p.account_create_name
    || ledgerNames.cash
    || ledgerNames.bank
    || 'Cash';
  const rawDate = p.date || new Date().toISOString();
  const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
    .split('T')[0].replace(/-/g, '');
  const customerName = p.customer_name || 'Unknown Customer';
  const amount = p.amount || 0;

  const doc = create({ version: '1.0' });
  const envelope = doc.ele('ENVELOPE');
  envelope.ele('HEADER').ele('TALLYREQUEST').txt('Import Data');
  const importData = envelope.ele('BODY').ele('IMPORTDATA');
  importData.ele('REQUESTDESC').ele('REPORTNAME').txt('Vouchers');

  const voucher = importData.ele('REQUESTDATA')
    .ele('TALLYMESSAGE', { 'xmlns:UDF': 'TallyUDF' })
    .ele('VOUCHER', { VCHTYPE: 'Receipt', ACTION: 'Create' });

  voucher.ele('DATE').txt(dateStr);
  voucher.ele('EFFECTIVEDATE').txt(dateStr);
  voucher.ele('VOUCHERTYPENAME').txt('Receipt');
  voucher.ele('PERSISTEDVIEW').txt('Accounting Voucher View');
  voucher.ele('NARRATION').txt(p.notes || '');

  const cashEntry = voucher.ele('ALLLEDGERENTRIES.LIST');
  cashEntry.ele('LEDGERNAME').txt(cashLedger);
  cashEntry.ele('ISDEEMEDPOSITIVE').txt('No');
  cashEntry.ele('AMOUNT').txt(String(amount));

  const custEntry = voucher.ele('ALLLEDGERENTRIES.LIST');
  custEntry.ele('LEDGERNAME').txt(customerName);
  custEntry.ele('ISDEEMEDPOSITIVE').txt('Yes');
  custEntry.ele('AMOUNT').txt('-' + amount);
  const bill = custEntry.ele('BILLALLOCATIONS.LIST');
  bill.ele('NAME').txt(p.bill_ref || p.tally_voucher_number || '');
  bill.ele('BILLTYPE').txt('Agst Ref');
  bill.ele('AMOUNT').txt('-' + amount);

  return doc.end({ prettyPrint: true });
}

function buildVendorLedgerXML(vendorName) {
  return create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER').ele('TALLYREQUEST').txt('Import Data').up().up()
      .ele('BODY').ele('IMPORTDATA')
        .ele('REQUESTDESC').ele('REPORTNAME').txt('All Masters').up().up()
        .ele('REQUESTDATA').ele('TALLYMESSAGE')
          .ele('LEDGER', { NAME: vendorName, RESERVEDNAME: '' })
            .ele('NAME').txt(vendorName).up()
            .ele('PARENT').txt('Sundry Creditors').up()
            .ele('ISBILLWISEON').txt('Yes').up()
          .up()
        .up().up()
      .up()
    .end({ prettyPrint: true });
}

function buildPurchaseAccountXML() {
  return create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER').ele('TALLYREQUEST').txt('Import Data').up().up()
      .ele('BODY').ele('IMPORTDATA')
        .ele('REQUESTDESC').ele('REPORTNAME').txt('All Masters').up().up()
        .ele('REQUESTDATA').ele('TALLYMESSAGE')
          .ele('LEDGER', { NAME: 'Purchase Account', RESERVEDNAME: '' })
            .ele('NAME').txt('Purchase Account').up()
            .ele('PARENT').txt('Purchase Accounts').up()
            .ele('ISREVENUE').txt('Yes').up()
            .ele('AFFECTSGST').txt('No').up()
            .ele('ISDEEMEDPOSITIVE').txt('Yes').up()
            .ele('USEFORVAT').txt('No').up()
            .ele('ISPARTYLEDGER').txt('No').up()
            .ele('ISBILLWISEON').txt('No').up()
            .ele('ISINACTIVE').txt('No').up()
          .up()
        .up().up()
      .up()
    .end({ prettyPrint: true });
}

function buildGSTInputLedgerXML(name, head) {
  return create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER').ele('TALLYREQUEST').txt('Import Data').up().up()
      .ele('BODY').ele('IMPORTDATA')
        .ele('REQUESTDESC').ele('REPORTNAME').txt('All Masters').up().up()
        .ele('REQUESTDATA').ele('TALLYMESSAGE')
          .ele('LEDGER', { NAME: name, RESERVEDNAME: '' })
            .ele('NAME').txt(name).up()
            .ele('PARENT').txt('Duties & Taxes').up()
            .ele('TAXTYPE').txt('GST').up()
            .ele('GSTDUTYHEAD').txt(head).up()
          .up()
        .up().up()
      .up()
    .end({ prettyPrint: true });
}

// `ledgerNames` (Phase 2, optional) — see buildInvoiceXML for the pattern.
// `bill.account_ledger_name` (Phase 2b, optional): when this specific bill
// was posted to a particular expense/COGS account, that per-transaction
// mapping wins — there is no company-wide "purchase" role (see
// get_push_ledger_names), so this is the only source of substitution here.
// `bill.account_create_name`/`account_create_parent` (Phase 2c, optional):
// create-fallback when that account has no Tally mapping — see buildInvoiceXML.
// `bill.itc_eligible` (Phase 2d, optional): mirrors journal_entry.js's
// build_bill_je_lines — when GST isn't creditable, Timber's own books fold it
// into the purchase cost rather than a separate Input CGST/SGST/IGST line, so
// the pushed voucher does the same instead of always claiming a credit that
// Timber's books never recorded. Defaults to creditable (today's behavior)
// when the flag is absent, so older/unrelated callers are unaffected.
// `bill.rcm` (Phase 2e, optional): under reverse charge the vendor is owed
// only the taxable amount (GST is self-assessed and paid straight to the
// government), so the vendor credit drops to `taxable`, the tax posts as a
// liability to RCM CGST/SGST/IGST Payable, and — only when also
// itc_eligible — a matching debit to "Reverse Charge Tax Input but not due"
// records the not-yet-claimable credit. Exactly mirrors build_bill_je_lines'
// `if (bill.rcm) {...} else if (bill.itc_eligible) {...}` branch.
function buildPurchaseXML(bill, ledgerNames = {}) {
  const purchaseLedger = bill.account_ledger_name
    || bill.account_create_name
    || ledgerNames.purchase
    || 'Purchase Account';
  const cgstInputLedger = ledgerNames.input_cgst || 'CGST Input';
  const sgstInputLedger = ledgerNames.input_sgst || 'SGST Input';
  const igstInputLedger = ledgerNames.input_igst || 'IGST Input';
  const rcmCgstPayableLedger = ledgerNames.rcm_cgst_payable || 'RCM CGST Payable';
  const rcmSgstPayableLedger = ledgerNames.rcm_sgst_payable || 'RCM SGST Payable';
  const rcmIgstPayableLedger = ledgerNames.rcm_igst_payable || 'RCM IGST Payable';
  const rcmNotDueLedger = ledgerNames.rcm_itc_not_due || 'Reverse Charge Tax Input but not due';
  const itcEligible = bill.itc_eligible !== false;
  const isRcm = bill.rcm === true;
  const rawDate = bill.bill_date || new Date().toISOString();
  const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
    .split('T')[0].replace(/-/g, '');
  const vendorName = bill.vendor_name || 'Unknown Vendor';
  const taxable = bill.taxable || 0;
  const cgst = bill.cgst || 0;
  const sgst = bill.sgst || 0;
  const igst = bill.igst || 0;
  // Non-creditable GST folds into the purchase cost regardless of RCM —
  // build_bill_je_lines applies this the same way whether or not bill.rcm is
  // set, since it's genuinely non-recoverable either way.
  const nonCreditableGst = itcEligible ? 0 : cgst + sgst + igst;
  const total = bill.total_amount || (taxable + cgst + sgst + igst);
  // Under RCM the vendor invoice is settled for the taxable amount only.
  const vendorAmount = isRcm ? taxable : total;
  const billNo = bill.bill_no || '';
  const lineItems = (bill.line_items || []).filter(i => i.qty > 0 || i.amount > 0);

  const invRows = lineItems.length > 0 ? lineItems : [{
    name: bill.description || billNo || 'Purchase',
    qty: 1,
    rate: taxable,
    amount: taxable
  }];

  const doc = create({ version: '1.0' });
  const envelope = doc.ele('ENVELOPE');
  envelope.ele('HEADER').ele('TALLYREQUEST').txt('Import Data');
  const importData = envelope.ele('BODY').ele('IMPORTDATA');
  importData.ele('REQUESTDESC').ele('REPORTNAME').txt('Vouchers');

  const voucher = importData.ele('REQUESTDATA')
    .ele('TALLYMESSAGE', { 'xmlns:UDF': 'TallyUDF' })
    .ele('VOUCHER', { VCHTYPE: 'Purchase', ACTION: 'Create', OBJVIEW: 'Invoice Voucher View' });

  voucher.ele('DATE').txt(dateStr);
  voucher.ele('EFFECTIVEDATE').txt(dateStr);
  voucher.ele('VOUCHERTYPENAME').txt('Purchase');
  voucher.ele('PARTYNAME').txt(vendorName);
  voucher.ele('PARTYLEDGERNAME').txt(vendorName);
  voucher.ele('PERSISTEDVIEW').txt('Invoice Voucher View');
  voucher.ele('VCHENTRYMODE').txt('Item Invoice');
  voucher.ele('ISINVOICE').txt('Yes');
  voucher.ele('NARRATION').txt(bill.description || billNo || '');

  // Non-creditable GST folds into the LAST item's own line (rate scaled up
  // so rate*qty still equals the posted amount) rather than a second
  // LEDGERENTRIES.LIST entry under the same ledger — a separate line with an
  // identical ledger name reads as a duplicate/data-entry error in Tally's
  // voucher view, even though the GL total is correct either way. Mirrors
  // journal_entry.js's single lump debit: it doesn't track non-creditable GST
  // per line item either, so folding it onto any one item is consistent.
  invRows.forEach((item, idx) => {
    const isLast = idx === invRows.length - 1;
    const extra = isLast ? nonCreditableGst : 0;
    const amount = item.amount + extra;
    const qty = item.qty || 1;
    const rate = extra > 0 ? amount / qty : item.rate;
    const itemName = item.name || item.sku || item.product_name || bill.description || 'Purchase';
    const unit = (item.unit || 'PIECES').toUpperCase();

    const inv = voucher.ele('ALLINVENTORYENTRIES.LIST');
    inv.ele('STOCKITEMNAME').txt(itemName);
    inv.ele('ISDEEMEDPOSITIVE').txt('Yes');
    inv.ele('RATE').txt(rate + '/' + unit);
    inv.ele('AMOUNT').txt('-' + amount);
    inv.ele('ACTUALQTY').txt(item.qty + ' ' + unit);
    inv.ele('BILLEDQTY').txt(item.qty + ' ' + unit);

    const batch = inv.ele('BATCHALLOCATIONS.LIST');
    batch.ele('GODOWNNAME').txt('Main Location');
    batch.ele('BATCHNAME').txt('Primary Batch');
    batch.ele('AMOUNT').txt('-' + amount);
    batch.ele('ACTUALQTY').txt(item.qty + ' ' + unit);
    batch.ele('BILLEDQTY').txt(item.qty + ' ' + unit);

    const acct = inv.ele('ACCOUNTINGALLOCATIONS.LIST');
    acct.ele('LEDGERNAME').txt(purchaseLedger);
    acct.ele('ISDEEMEDPOSITIVE').txt('Yes');
    acct.ele('ISPARTYLEDGER').txt('No');
    acct.ele('AMOUNT').txt('-' + amount);
  });

  const vendEntry = voucher.ele('LEDGERENTRIES.LIST');
  vendEntry.ele('LEDGERNAME').txt(vendorName);
  vendEntry.ele('ISDEEMEDPOSITIVE').txt('No');
  vendEntry.ele('ISPARTYLEDGER').txt('Yes');
  vendEntry.ele('AMOUNT').txt(String(vendorAmount));
  const billAlloc = vendEntry.ele('BILLALLOCATIONS.LIST');
  billAlloc.ele('NAME').txt(billNo);
  billAlloc.ele('BILLTYPE').txt('New Ref');
  billAlloc.ele('AMOUNT').txt(String(vendorAmount));

  if (isRcm) {
    if (cgst > 0) {
      const e = voucher.ele('LEDGERENTRIES.LIST');
      e.ele('LEDGERNAME').txt(rcmCgstPayableLedger);
      e.ele('ISDEEMEDPOSITIVE').txt('No');
      e.ele('ISPARTYLEDGER').txt('No');
      e.ele('AMOUNT').txt(String(cgst));
    }
    if (sgst > 0) {
      const e = voucher.ele('LEDGERENTRIES.LIST');
      e.ele('LEDGERNAME').txt(rcmSgstPayableLedger);
      e.ele('ISDEEMEDPOSITIVE').txt('No');
      e.ele('ISPARTYLEDGER').txt('No');
      e.ele('AMOUNT').txt(String(sgst));
    }
    if (igst > 0) {
      const e = voucher.ele('LEDGERENTRIES.LIST');
      e.ele('LEDGERNAME').txt(rcmIgstPayableLedger);
      e.ele('ISDEEMEDPOSITIVE').txt('No');
      e.ele('ISPARTYLEDGER').txt('No');
      e.ele('AMOUNT').txt(String(igst));
    }
    // Credit is only "not due yet" once RCM tax is actually paid — combined
    // into one line (unlike Input CGST/SGST/IGST) since Timber's own
    // "Reverse Charge Tax Input but not due" is a single account, not
    // three; splitting it across three same-named lines here would read as
    // a duplicate row the same way the ITC fold did before it was fixed.
    if (itcEligible) {
      const notDue = cgst + sgst + igst;
      if (notDue > 0) {
        const e = voucher.ele('LEDGERENTRIES.LIST');
        e.ele('LEDGERNAME').txt(rcmNotDueLedger);
        e.ele('ISDEEMEDPOSITIVE').txt('Yes');
        e.ele('ISPARTYLEDGER').txt('No');
        e.ele('AMOUNT').txt('-' + notDue);
      }
    }
  } else if (itcEligible) {
    if (cgst > 0) {
      const e = voucher.ele('LEDGERENTRIES.LIST');
      e.ele('LEDGERNAME').txt(cgstInputLedger);
      e.ele('ISDEEMEDPOSITIVE').txt('Yes');
      e.ele('ISPARTYLEDGER').txt('No');
      e.ele('AMOUNT').txt('-' + cgst);
    }
    if (sgst > 0) {
      const e = voucher.ele('LEDGERENTRIES.LIST');
      e.ele('LEDGERNAME').txt(sgstInputLedger);
      e.ele('ISDEEMEDPOSITIVE').txt('Yes');
      e.ele('ISPARTYLEDGER').txt('No');
      e.ele('AMOUNT').txt('-' + sgst);
    }
    if (igst > 0) {
      const e = voucher.ele('LEDGERENTRIES.LIST');
      e.ele('LEDGERNAME').txt(igstInputLedger);
      e.ele('ISDEEMEDPOSITIVE').txt('Yes');
      e.ele('ISPARTYLEDGER').txt('No');
      e.ele('AMOUNT').txt('-' + igst);
    }
  }
  // Non-eligible GST needs no separate line here — it's already folded into
  // the last item's own amount above.

  return doc.end({ prettyPrint: true });
}

// 🧾 Credit/Debit Note voucher XML (Timber → Tally). Both are customer-side
// documents in Timber (CreditNote reduces what the customer owes, DebitNote
// raises an additional demand), so both party ledgers live under Sundry
// Debtors and both use the OUTPUT GST ledgers — never the Input ones.
//
// Sign convention (Tally import XML): negative AMOUNT = debit.
//   Credit Note : revenue/sales-return DEBITED  (items negative),
//                 customer CREDITED (party positive), output GST DEBITED.
//   Debit Note  : exact mirror — customer DEBITED, revenue + GST CREDITED.
//
// Bill allocation: a Credit Note against a synced invoice settles that ref
// ("Agst Ref" on note.linked_invoice_ref); standalone notes and ALL debit
// notes open their own "New Ref" under the note number — allocating a DN
// against the original invoice would over-allocate that ref beyond its
// amount, so the extra demand gets its own reference instead.
//
// `ledgerNames` / `note.account_ledger_name` / `note.account_create_name`
// follow the same Phase 2/2b/2c fallback chain as buildInvoiceXML.
function buildNoteXML(note, { isCredit, ledgerNames = {} }) {
  const revenueLedger = note.account_ledger_name
    || note.account_create_name
    || ledgerNames.sales
    || 'Sales Account';
  const cgstLedger = ledgerNames.output_cgst || 'CGST';
  const sgstLedger = ledgerNames.output_sgst || 'SGST';
  const igstLedger = ledgerNames.output_igst || 'IGST';
  const vchType = isCredit ? 'Credit Note' : 'Debit Note';
  const rawDate = note.issue_date || new Date().toISOString();
  const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
    .split('T')[0].replace(/-/g, '');
  const customerName = note.customer?.name || 'Unknown Customer';
  const subtotal = note.subtotal || 0;
  const cgst = note.cgst || 0;
  const sgst = note.sgst || 0;
  const igst = note.igst || 0;
  const cess = note.cess || 0;
  const cessLedger = ledgerNames.output_cess || 'Cess';
  const total = note.total || (subtotal + cgst + sgst + igst + cess);
  // Party side: Credit Note credits the customer (positive), Debit Note
  // debits them (negative).
  const partySign = isCredit ? '' : '-';
  // Revenue/GST side is always the opposite of the party side.
  const lineSign = isCredit ? '-' : '';
  const lineDeemedPositive = isCredit ? 'Yes' : 'No';

  const items = (note.items || []).filter(i => (i.quantity || i.qty || 0) > 0 || (i.amount || 0) > 0);
  const invRows = items.length > 0 ? items : [{
    title: note.reason || note.note_number || vchType,
    quantity: 1,
    rate: subtotal,
    amount: subtotal,
    gst_rate: 0,
    hsn: ''
  }];
  // The voucher must balance exactly: party total = items + GST. Item rows
  // can drift from `subtotal` (discounts, rounding), so fold any difference
  // into the last row — same trick as buildPurchaseXML's non-creditable GST
  // fold, and consistent with Timber's JE which posts one lump revenue line.
  const itemsSum = invRows.reduce((s, i) => s + (i.amount ?? (i.quantity || 1) * (i.rate || 0)), 0);
  const drift = subtotal - itemsSum;

  const doc = create({ version: '1.0' });
  const envelope = doc.ele('ENVELOPE');
  envelope.ele('HEADER').ele('TALLYREQUEST').txt('Import Data');
  const importData = envelope.ele('BODY').ele('IMPORTDATA');
  importData.ele('REQUESTDESC').ele('REPORTNAME').txt('Vouchers');

  const voucher = importData.ele('REQUESTDATA')
    .ele('TALLYMESSAGE', { 'xmlns:UDF': 'TallyUDF' })
    .ele('VOUCHER', { VCHTYPE: vchType, ACTION: 'Create', OBJVIEW: 'Invoice Voucher View' });

  voucher.ele('DATE').txt(dateStr);
  voucher.ele('EFFECTIVEDATE').txt(dateStr);
  voucher.ele('VOUCHERTYPENAME').txt(vchType);
  voucher.ele('VOUCHERNUMBER').txt(note.note_number || '');
  voucher.ele('PARTYNAME').txt(customerName);
  voucher.ele('PARTYLEDGERNAME').txt(customerName);
  voucher.ele('PERSISTEDVIEW').txt('Invoice Voucher View');
  voucher.ele('VCHENTRYMODE').txt('Item Invoice');
  voucher.ele('ISINVOICE').txt('Yes');
  voucher.ele('NARRATION').txt(note.reason || note.notes || note.note_number || '');

  invRows.forEach((item, idx) => {
    const isLast = idx === invRows.length - 1;
    const qty = item.quantity || item.qty || 1;
    const baseAmount = item.amount ?? qty * (item.rate || 0);
    const amount = isLast ? baseAmount + drift : baseAmount;
    const rate = amount !== baseAmount ? amount / qty : (item.rate || 0);
    const itemName = item.title || item.name || vchType;

    const inv = voucher.ele('ALLINVENTORYENTRIES.LIST');
    inv.ele('STOCKITEMNAME').txt(itemName);
    inv.ele('ISDEEMEDPOSITIVE').txt(lineDeemedPositive);
    inv.ele('RATE').txt(rate + '/PIECES');
    inv.ele('AMOUNT').txt(lineSign + amount);
    inv.ele('ACTUALQTY').txt(qty + ' PIECES');
    inv.ele('BILLEDQTY').txt(qty + ' PIECES');

    const batch = inv.ele('BATCHALLOCATIONS.LIST');
    batch.ele('GODOWNNAME').txt('Main Location');
    batch.ele('BATCHNAME').txt('Primary Batch');
    batch.ele('AMOUNT').txt(lineSign + amount);
    batch.ele('ACTUALQTY').txt(qty + ' PIECES');
    batch.ele('BILLEDQTY').txt(qty + ' PIECES');

    const acct = inv.ele('ACCOUNTINGALLOCATIONS.LIST');
    acct.ele('LEDGERNAME').txt(revenueLedger);
    acct.ele('ISDEEMEDPOSITIVE').txt(lineDeemedPositive);
    acct.ele('ISPARTYLEDGER').txt('No');
    acct.ele('AMOUNT').txt(lineSign + amount);
  });

  const partyEntry = voucher.ele('LEDGERENTRIES.LIST');
  partyEntry.ele('LEDGERNAME').txt(customerName);
  partyEntry.ele('ISDEEMEDPOSITIVE').txt(isCredit ? 'No' : 'Yes');
  partyEntry.ele('ISPARTYLEDGER').txt('Yes');
  partyEntry.ele('AMOUNT').txt(partySign + total);
  const billAlloc = partyEntry.ele('BILLALLOCATIONS.LIST');
  if (isCredit && note.linked_invoice_ref) {
    billAlloc.ele('NAME').txt(note.linked_invoice_ref);
    billAlloc.ele('BILLTYPE').txt('Agst Ref');
  } else {
    billAlloc.ele('NAME').txt(note.note_number || '');
    billAlloc.ele('BILLTYPE').txt('New Ref');
  }
  billAlloc.ele('AMOUNT').txt(partySign + total);

  for (const [ledger, amt] of [[cgstLedger, cgst], [sgstLedger, sgst], [igstLedger, igst], [cessLedger, cess]]) {
    if (amt > 0) {
      const e = voucher.ele('LEDGERENTRIES.LIST');
      e.ele('LEDGERNAME').txt(ledger);
      e.ele('ISDEEMEDPOSITIVE').txt(lineDeemedPositive);
      e.ele('ISPARTYLEDGER').txt('No');
      e.ele('AMOUNT').txt(lineSign + amt);
    }
  }

  return doc.end({ prettyPrint: true });
}

function buildCreditNoteXML(note, ledgerNames = {}) {
  return buildNoteXML(note, { isCredit: true, ledgerNames });
}

function buildDebitNoteXML(note, ledgerNames = {}) {
  return buildNoteXML(note, { isCredit: false, ledgerNames });
}

// 🏗️ Payment voucher XML (Timber → Tally vendor payment)
// `ledgerNames.cash`/`ledgerNames.bank` (Phase 2, optional), `p.account_ledger_name`
// (Phase 2b) and `p.account_create_name`/`account_create_parent` (Phase 2c,
// create-fallback) — see buildReceiptXML for the full fallback chain.
function buildPaymentVoucherXML(p, ledgerNames = {}) {
  const cashLedger = p.account_ledger_name
    || p.account_create_name
    || ledgerNames.cash
    || ledgerNames.bank
    || 'Cash';
  const rawDate = p.date || new Date().toISOString();
  const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
    .split('T')[0].replace(/-/g, '');
  const vendorName = p.vendor_name || 'Unknown Vendor';
  const amount = p.amount || 0;
  // `amount` is the gross cleared against the bill; when TDS was deducted the
  // bank only pays the net and the withheld part is owed to the government
  // (mirrors journal_entry.create_for_payment_made).
  const tds = p.tds_amount > 0 && p.tds_amount < amount ? p.tds_amount : 0;
  const tdsLedger = ledgerNames.tds_payable || 'TDS Payable';
  const bankAmount = Math.round((amount - tds) * 100) / 100;

  const doc = create({ version: '1.0' });
  const envelope = doc.ele('ENVELOPE');
  envelope.ele('HEADER').ele('TALLYREQUEST').txt('Import Data');
  const importData = envelope.ele('BODY').ele('IMPORTDATA');
  importData.ele('REQUESTDESC').ele('REPORTNAME').txt('Vouchers');

  const voucher = importData.ele('REQUESTDATA')
    .ele('TALLYMESSAGE', { 'xmlns:UDF': 'TallyUDF' })
    .ele('VOUCHER', { VCHTYPE: 'Payment', ACTION: 'Create' });

  voucher.ele('DATE').txt(dateStr);
  voucher.ele('EFFECTIVEDATE').txt(dateStr);
  voucher.ele('VOUCHERTYPENAME').txt('Payment');
  voucher.ele('PERSISTEDVIEW').txt('Accounting Voucher View');
  voucher.ele('NARRATION').txt(p.notes || '');

  const cashEntry = voucher.ele('ALLLEDGERENTRIES.LIST');
  cashEntry.ele('LEDGERNAME').txt(cashLedger);
  cashEntry.ele('ISDEEMEDPOSITIVE').txt('Yes');
  cashEntry.ele('AMOUNT').txt('-' + bankAmount);

  const vendEntry = voucher.ele('ALLLEDGERENTRIES.LIST');
  vendEntry.ele('LEDGERNAME').txt(vendorName);
  vendEntry.ele('ISDEEMEDPOSITIVE').txt('No');
  vendEntry.ele('AMOUNT').txt(String(amount));
  const billAlloc = vendEntry.ele('BILLALLOCATIONS.LIST');
  billAlloc.ele('NAME').txt(p.bill_ref || '');
  billAlloc.ele('BILLTYPE').txt('Agst Ref');
  billAlloc.ele('AMOUNT').txt(String(amount));

  if (tds > 0) {
    const tdsEntry = voucher.ele('ALLLEDGERENTRIES.LIST');
    tdsEntry.ele('LEDGERNAME').txt(tdsLedger);
    // Same side as the bank leg: both reduce what is paid out to the vendor.
    tdsEntry.ele('ISDEEMEDPOSITIVE').txt('Yes');
    tdsEntry.ele('AMOUNT').txt('-' + tds);
  }

  return doc.end({ prettyPrint: true });
}

const EXPENSE_LEDGER_MAP = {
  rent: 'Rent',
  utilities: 'Utilities',
  salaries: 'Salaries',
  office_supplies: 'Office Supplies',
  travel: 'Travel Expenses',
  marketing: 'Marketing Expenses',
  software: 'Software Expenses',
  hardware: 'Hardware Expenses',
  maintenance: 'Maintenance Expenses',
  insurance: 'Insurance',
  professional_fees: 'Professional Fees',
  taxes: 'Taxes & Duties',
  miscellaneous: 'Miscellaneous Expenses'
};

function categoryToLedger(category) {
  return EXPENSE_LEDGER_MAP[category] || 'Miscellaneous Expenses';
}

function buildExpenseLedgerXML(ledgerName) {
  return create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER').ele('TALLYREQUEST').txt('Import Data').up().up()
      .ele('BODY').ele('IMPORTDATA')
        .ele('REQUESTDESC').ele('REPORTNAME').txt('All Masters').up().up()
        .ele('REQUESTDATA').ele('TALLYMESSAGE')
          .ele('LEDGER', { NAME: ledgerName, RESERVEDNAME: '' })
            .ele('NAME').txt(ledgerName).up()
            .ele('PARENT').txt('Indirect Expenses').up()
          .up()
        .up().up()
      .up()
    .end({ prettyPrint: true });
}

function buildBankLedgerXML() {
  return create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER').ele('TALLYREQUEST').txt('Import Data').up().up()
      .ele('BODY').ele('IMPORTDATA')
        .ele('REQUESTDESC').ele('REPORTNAME').txt('All Masters').up().up()
        .ele('REQUESTDATA').ele('TALLYMESSAGE')
          .ele('LEDGER', { NAME: 'Bank', RESERVEDNAME: '' })
            .ele('NAME').txt('Bank').up()
            .ele('PARENT').txt('Bank Accounts').up()
          .up()
        .up().up()
      .up()
    .end({ prettyPrint: true });
}

function buildTDSPayableLedgerXML() {
  return create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER').ele('TALLYREQUEST').txt('Import Data').up().up()
      .ele('BODY').ele('IMPORTDATA')
        .ele('REQUESTDESC').ele('REPORTNAME').txt('All Masters').up().up()
        .ele('REQUESTDATA').ele('TALLYMESSAGE')
          .ele('LEDGER', { NAME: 'TDS Payable', RESERVEDNAME: '' })
            .ele('NAME').txt('TDS Payable').up()
            .ele('PARENT').txt('Duties & Taxes').up()
          .up()
        .up().up()
      .up()
    .end({ prettyPrint: true });
}

// `ledgerNames` (Phase 2, optional) overrides bank/cash, GST input, and TDS
// Payable roles — see buildInvoiceXML for the pattern.
// `expense.category_ledger_name`/`expense.payment_ledger_name` (Phase 2b,
// optional): every expense already has a required category account
// (account_id) and payment account (payment_account_id) in Timber — these
// per-transaction mappings win over both the categoryToLedger() guess and the
// company-wide bank/cash role.
// `expense.category_create_name`/`payment_create_name` (+ `..._create_parent`,
// Phase 2c, optional): create-fallback when the respective account has no
// Tally mapping at all — see buildInvoiceXML for the same pattern.
function buildExpenseXML(expense, ledgerNames = {}) {
  const rawDate = expense.date || new Date().toISOString();
  const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
    .split('T')[0].replace(/-/g, '');

  const ledgerName = expense.category_ledger_name
    || expense.category_create_name
    || categoryToLedger(expense.category);
  const bankLedger = expense.payment_ledger_name
    || expense.payment_create_name
    || (expense.mode === 'cash' ? (ledgerNames.cash || 'Cash') : (ledgerNames.bank || 'Bank'));
  const cgstInputLedger = ledgerNames.input_cgst || 'CGST Input';
  const sgstInputLedger = ledgerNames.input_sgst || 'SGST Input';
  const igstInputLedger = ledgerNames.input_igst || 'IGST Input';
  const tdsPayableLedger = ledgerNames.tds_payable || 'TDS Payable';
  const taxable = expense.taxable || 0;
  const total = expense.total || taxable;
  const cgst = expense.cgst || 0;
  const sgst = expense.sgst || 0;
  const igst = expense.igst || 0;
  const hasTds = expense.has_tds && expense.tds_amount > 0;
  const tdsAmount = hasTds ? expense.tds_amount : 0;
  const cashAmount = total - tdsAmount;

  const doc = create({ version: '1.0' });
  const envelope = doc.ele('ENVELOPE');
  envelope.ele('HEADER').ele('TALLYREQUEST').txt('Import Data');
  const importData = envelope.ele('BODY').ele('IMPORTDATA');
  importData.ele('REQUESTDESC').ele('REPORTNAME').txt('Vouchers');

  const voucher = importData.ele('REQUESTDATA')
    .ele('TALLYMESSAGE', { 'xmlns:UDF': 'TallyUDF' })
    .ele('VOUCHER', { VCHTYPE: 'Payment', ACTION: 'Create' });

  voucher.ele('DATE').txt(dateStr);
  voucher.ele('EFFECTIVEDATE').txt(dateStr);
  voucher.ele('VOUCHERTYPENAME').txt('Payment');
  voucher.ele('PERSISTEDVIEW').txt('Accounting Voucher View');
  voucher.ele('NARRATION').txt(expense.narration || expense.notes || '');

  const bankEntry = voucher.ele('ALLLEDGERENTRIES.LIST');
  bankEntry.ele('LEDGERNAME').txt(bankLedger);
  bankEntry.ele('ISDEEMEDPOSITIVE').txt('Yes');
  bankEntry.ele('AMOUNT').txt('-' + cashAmount);

  const expEntry = voucher.ele('ALLLEDGERENTRIES.LIST');
  expEntry.ele('LEDGERNAME').txt(ledgerName);
  expEntry.ele('ISDEEMEDPOSITIVE').txt('No');
  expEntry.ele('AMOUNT').txt(String(taxable));

  if (cgst > 0) {
    const e = voucher.ele('ALLLEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt(cgstInputLedger);
    e.ele('ISDEEMEDPOSITIVE').txt('No');
    e.ele('AMOUNT').txt(String(cgst));
  }
  if (sgst > 0) {
    const e = voucher.ele('ALLLEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt(sgstInputLedger);
    e.ele('ISDEEMEDPOSITIVE').txt('No');
    e.ele('AMOUNT').txt(String(sgst));
  }
  if (igst > 0) {
    const e = voucher.ele('ALLLEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt(igstInputLedger);
    e.ele('ISDEEMEDPOSITIVE').txt('No');
    e.ele('AMOUNT').txt(String(igst));
  }

  if (hasTds) {
    const e = voucher.ele('ALLLEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt(tdsPayableLedger);
    e.ele('ISDEEMEDPOSITIVE').txt('Yes');
    e.ele('AMOUNT').txt('-' + tdsAmount);
  }

  return doc.end({ prettyPrint: true });
}

// Manual journal entry → Tally Journal voucher.
// Every line is one debit or one credit on a single ledger: a debit is
// ISDEEMEDPOSITIVE=Yes with a negative amount, a credit is No with a positive
// amount (same convention as every other voucher here). A line carrying both
// debit and credit is netted. The journal must balance — the backend refuses
// to send one that doesn't, but a rounding drift under one rupee is tolerated
// by posting it to the first line so Tally's own balance check passes.
function buildJournalXML(journal) {
  const rawDate = journal.date || new Date().toISOString();
  const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
    .split('T')[0].replace(/-/g, '');
  const round = n => Math.round(n * 100) / 100;

  const lines = (journal.lines || [])
    .map(l => {
      const net = round((l.debit || 0) - (l.credit || 0));
      const name = l.ledger_name || l.create_name || 'Suspense A/c';
      return { name, amount: Math.abs(net), isDebit: net > 0 };
    })
    .filter(l => l.amount > 0);

  const drift = round(
    lines.filter(l => l.isDebit).reduce((s, l) => s + l.amount, 0) -
    lines.filter(l => !l.isDebit).reduce((s, l) => s + l.amount, 0)
  );
  if (drift !== 0 && Math.abs(drift) < 1 && lines.length) {
    // fold the sub-rupee difference into the first line on the lighter side
    const target = lines.find(l => l.isDebit === (drift < 0)) || lines[0];
    target.amount = round(target.amount + Math.abs(drift));
  }

  const doc = create({ version: '1.0' });
  const envelope = doc.ele('ENVELOPE');
  envelope.ele('HEADER').ele('TALLYREQUEST').txt('Import Data');
  const importData = envelope.ele('BODY').ele('IMPORTDATA');
  importData.ele('REQUESTDESC').ele('REPORTNAME').txt('Vouchers');

  const voucher = importData.ele('REQUESTDATA')
    .ele('TALLYMESSAGE', { 'xmlns:UDF': 'TallyUDF' })
    .ele('VOUCHER', { VCHTYPE: 'Journal', ACTION: 'Create' });

  voucher.ele('DATE').txt(dateStr);
  voucher.ele('EFFECTIVEDATE').txt(dateStr);
  voucher.ele('VOUCHERTYPENAME').txt('Journal');
  voucher.ele('PERSISTEDVIEW').txt('Accounting Voucher View');
  voucher.ele('NARRATION').txt(journal.narration || journal.voucher_ref || '');

  for (const line of lines) {
    const entry = voucher.ele('ALLLEDGERENTRIES.LIST');
    entry.ele('LEDGERNAME').txt(line.name);
    entry.ele('ISDEEMEDPOSITIVE').txt(line.isDebit ? 'Yes' : 'No');
    entry.ele('AMOUNT').txt((line.isDebit ? '-' : '') + line.amount);
  }

  return doc.end({ prettyPrint: true });
}

module.exports = {
  buildJournalXML,
  buildCustomLedgerXML,
  buildUnitXML,
  buildLedgerXML,
  buildSalesLedgerXML,
  buildItemXML,
  buildGSTLedgerXML,
  buildStockGroupXML,
  buildInvoiceXML_FULL,
  buildInvoiceXML,
  buildReceiptXML,
  buildVendorLedgerXML,
  buildPurchaseAccountXML,
  buildGSTInputLedgerXML,
  buildPurchaseXML,
  buildCreditNoteXML,
  buildDebitNoteXML,
  buildPaymentVoucherXML,
  EXPENSE_LEDGER_MAP,
  categoryToLedger,
  buildExpenseLedgerXML,
  buildBankLedgerXML,
  buildTDSPayableLedgerXML,
  buildExpenseXML,
};
