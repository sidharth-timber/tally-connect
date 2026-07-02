const { create } = require('xmlbuilder2');

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

function buildLedgerXML(customerName) {
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
              .ele('LEDGER', { NAME: customerName, RESERVEDNAME: '' })
                .ele('NAME').txt(customerName).up()
                .ele('PARENT').txt('Sundry Debtors').up()
                .ele('ISBILLWISEON').txt('Yes').up()
              .up()
            .up()
          .up()
        .up()
      .up()
    .end({ prettyPrint: true });
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
function buildInvoiceXML(invoice, { gstin, state } = {}) {
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

  for (const item of (invoice.items || [])) {
    const quantity = item.quantity || item.qty || 1;
    const rate = item.unit_price || item.rate || 0;
    const itemAmount = quantity * rate;
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
    salesAlloc.ele('LEDGERNAME').txt('Sales Account');
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
  }

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
    e.ele('LEDGERNAME').txt('CGST');
    e.ele('ISDEEMEDPOSITIVE').txt('No');
    e.ele('ISPARTYLEDGER').txt('No');
    e.ele('REMOVEZEROENTRIES').txt('No');
    e.ele('AMOUNT').txt(cgst.toString());
    e.ele('VATEXPAMOUNT').txt(cgst.toString());
  }
  if (sgst > 0) {
    const e = voucher.ele('LEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt('SGST');
    e.ele('ISDEEMEDPOSITIVE').txt('No');
    e.ele('ISPARTYLEDGER').txt('No');
    e.ele('REMOVEZEROENTRIES').txt('No');
    e.ele('AMOUNT').txt(sgst.toString());
    e.ele('VATEXPAMOUNT').txt(sgst.toString());
  }
  if (igst > 0) {
    const e = voucher.ele('LEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt('IGST');
    e.ele('ISDEEMEDPOSITIVE').txt('No');
    e.ele('ISPARTYLEDGER').txt('No');
    e.ele('REMOVEZEROENTRIES').txt('No');
    e.ele('AMOUNT').txt(igst.toString());
    e.ele('VATEXPAMOUNT').txt(igst.toString());
  }

  return doc.end({ prettyPrint: true });
}

// 🧾 Receipt voucher XML (Timber → Tally customer payment)
function buildReceiptXML(p) {
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
  cashEntry.ele('LEDGERNAME').txt('Cash');
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

function buildPurchaseXML(bill) {
  const rawDate = bill.bill_date || new Date().toISOString();
  const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
    .split('T')[0].replace(/-/g, '');
  const vendorName = bill.vendor_name || 'Unknown Vendor';
  const taxable = bill.taxable || 0;
  const cgst = bill.cgst || 0;
  const sgst = bill.sgst || 0;
  const igst = bill.igst || 0;
  const total = bill.total_amount || (taxable + cgst + sgst + igst);
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

  for (const item of invRows) {
    const itemName = item.name || item.sku || item.product_name || bill.description || 'Purchase';
    const unit = (item.unit || 'PIECES').toUpperCase();

    const inv = voucher.ele('ALLINVENTORYENTRIES.LIST');
    inv.ele('STOCKITEMNAME').txt(itemName);
    inv.ele('ISDEEMEDPOSITIVE').txt('Yes');
    inv.ele('RATE').txt(item.rate + '/' + unit);
    inv.ele('AMOUNT').txt('-' + item.amount);
    inv.ele('ACTUALQTY').txt(item.qty + ' ' + unit);
    inv.ele('BILLEDQTY').txt(item.qty + ' ' + unit);

    const batch = inv.ele('BATCHALLOCATIONS.LIST');
    batch.ele('GODOWNNAME').txt('Main Location');
    batch.ele('BATCHNAME').txt('Primary Batch');
    batch.ele('AMOUNT').txt('-' + item.amount);
    batch.ele('ACTUALQTY').txt(item.qty + ' ' + unit);
    batch.ele('BILLEDQTY').txt(item.qty + ' ' + unit);

    const acct = inv.ele('ACCOUNTINGALLOCATIONS.LIST');
    acct.ele('LEDGERNAME').txt('Purchase Account');
    acct.ele('ISDEEMEDPOSITIVE').txt('Yes');
    acct.ele('ISPARTYLEDGER').txt('No');
    acct.ele('AMOUNT').txt('-' + item.amount);
  }

  const vendEntry = voucher.ele('LEDGERENTRIES.LIST');
  vendEntry.ele('LEDGERNAME').txt(vendorName);
  vendEntry.ele('ISDEEMEDPOSITIVE').txt('No');
  vendEntry.ele('ISPARTYLEDGER').txt('Yes');
  vendEntry.ele('AMOUNT').txt(String(total));
  const billAlloc = vendEntry.ele('BILLALLOCATIONS.LIST');
  billAlloc.ele('NAME').txt(billNo);
  billAlloc.ele('BILLTYPE').txt('New Ref');
  billAlloc.ele('AMOUNT').txt(String(total));

  if (cgst > 0) {
    const e = voucher.ele('LEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt('CGST Input');
    e.ele('ISDEEMEDPOSITIVE').txt('Yes');
    e.ele('ISPARTYLEDGER').txt('No');
    e.ele('AMOUNT').txt('-' + cgst);
  }
  if (sgst > 0) {
    const e = voucher.ele('LEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt('SGST Input');
    e.ele('ISDEEMEDPOSITIVE').txt('Yes');
    e.ele('ISPARTYLEDGER').txt('No');
    e.ele('AMOUNT').txt('-' + sgst);
  }
  if (igst > 0) {
    const e = voucher.ele('LEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt('IGST Input');
    e.ele('ISDEEMEDPOSITIVE').txt('Yes');
    e.ele('ISPARTYLEDGER').txt('No');
    e.ele('AMOUNT').txt('-' + igst);
  }

  return doc.end({ prettyPrint: true });
}

// 🏗️ Payment voucher XML (Timber → Tally vendor payment)
function buildPaymentVoucherXML(p) {
  const rawDate = p.date || new Date().toISOString();
  const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
    .split('T')[0].replace(/-/g, '');
  const vendorName = p.vendor_name || 'Unknown Vendor';
  const amount = p.amount || 0;

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
  cashEntry.ele('LEDGERNAME').txt('Cash');
  cashEntry.ele('ISDEEMEDPOSITIVE').txt('Yes');
  cashEntry.ele('AMOUNT').txt('-' + amount);

  const vendEntry = voucher.ele('ALLLEDGERENTRIES.LIST');
  vendEntry.ele('LEDGERNAME').txt(vendorName);
  vendEntry.ele('ISDEEMEDPOSITIVE').txt('No');
  vendEntry.ele('AMOUNT').txt(String(amount));
  const billAlloc = vendEntry.ele('BILLALLOCATIONS.LIST');
  billAlloc.ele('NAME').txt(p.bill_ref || '');
  billAlloc.ele('BILLTYPE').txt('Agst Ref');
  billAlloc.ele('AMOUNT').txt(String(amount));

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

function buildExpenseXML(expense) {
  const rawDate = expense.date || new Date().toISOString();
  const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
    .split('T')[0].replace(/-/g, '');

  const ledgerName = categoryToLedger(expense.category);
  const bankLedger = expense.mode === 'cash' ? 'Cash' : 'Bank';
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
    e.ele('LEDGERNAME').txt('CGST Input');
    e.ele('ISDEEMEDPOSITIVE').txt('No');
    e.ele('AMOUNT').txt(String(cgst));
  }
  if (sgst > 0) {
    const e = voucher.ele('ALLLEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt('SGST Input');
    e.ele('ISDEEMEDPOSITIVE').txt('No');
    e.ele('AMOUNT').txt(String(sgst));
  }
  if (igst > 0) {
    const e = voucher.ele('ALLLEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt('IGST Input');
    e.ele('ISDEEMEDPOSITIVE').txt('No');
    e.ele('AMOUNT').txt(String(igst));
  }

  if (hasTds) {
    const e = voucher.ele('ALLLEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt('TDS Payable');
    e.ele('ISDEEMEDPOSITIVE').txt('Yes');
    e.ele('AMOUNT').txt('-' + tdsAmount);
  }

  return doc.end({ prettyPrint: true });
}

module.exports = {
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
  buildPaymentVoucherXML,
  EXPENSE_LEDGER_MAP,
  categoryToLedger,
  buildExpenseLedgerXML,
  buildBankLedgerXML,
  buildTDSPayableLedgerXML,
  buildExpenseXML,
};
