// For Purchase
require("dotenv").config();
const axios = require("axios");
const { create } = require("xmlbuilder2");
 
const SERVER_URL = process.env.SERVER_URL;
const API_KEY = process.env.API_KEY;
const TALLY_URL = "http://localhost:9000";
 
/* -------------------- Helpers -------------------- */
 
// ✅ Safe supplier name fallback
function getSupplierName(invoice) {
  return (
    invoice.customer?.name ||
    invoice.customer?.name ||
    invoice.vendor?.name ||
    invoice.partyName ||
    invoice.party ||
    "Unknown Supplier"
  );
}
 
// ✅ Item XML
function buildItemXML(itemName) {
  return create({ version: "1.0" })
    .ele("ENVELOPE")
    .ele("HEADER")
    .ele("TALLYREQUEST").txt("Import Data").up()
    .up()
    .ele("BODY")
    .ele("IMPORTDATA")
    .ele("REQUESTDESC")
    .ele("REPORTNAME").txt("All Masters").up()
    .up()
    .ele("REQUESTDATA")
    .ele("TALLYMESSAGE")
    .ele("STOCKITEM", { NAME: itemName, RESERVEDNAME: "" })
    .ele("NAME").txt(itemName).up()
    .ele("BASEUNITS").txt("PIECES").up()
    .up()
    .up()
    .up()
    .up()
    .up()
    .end({ prettyPrint: true });
}
 
// ✅ Unit XML
function buildUnitXML() {
  return create({ version: "1.0" })
    .ele("ENVELOPE")
    .ele("HEADER")
    .ele("TALLYREQUEST").txt("Import Data").up()
    .up()
    .ele("BODY")
    .ele("IMPORTDATA")
    .ele("REQUESTDESC")
    .ele("REPORTNAME").txt("All Masters").up()
    .up()
    .ele("REQUESTDATA")
    .ele("TALLYMESSAGE", { xmlns: "TallyUDF" })
    .ele("UNIT", { NAME: "PIECES", ACTION: "Create" })
    .ele("NAME").txt("PIECES").up()
    .ele("ISSIMPLEUNIT").txt("Yes").up()
    .ele("DECIMALPLACES").txt("0").up()
    .up()
    .up()
    .up()
    .up()
    .up()
    .end({ prettyPrint: true });
}
 
// ✅ Stock Group XML
function buildStockGroupXML() {
  return create({ version: "1.0" })
    .ele("ENVELOPE")
    .ele("HEADER")
    .ele("TALLYREQUEST").txt("Import Data").up()
    .up()
    .ele("BODY")
    .ele("IMPORTDATA")
    .ele("REQUESTDESC")
    .ele("REPORTNAME").txt("All Masters").up()
    .up()
    .ele("REQUESTDATA")
    .ele("TALLYMESSAGE")
    .ele("STOCKGROUP", { NAME: "Primary", ACTION: "Create" })
    .ele("NAME").txt("Primary").up()
    .up()
    .up()
    .up()
    .up()
    .up()
    .end({ prettyPrint: true });
}
 
// ✅ Supplier Ledger XML
function buildSupplierLedgerXML(supplierName) {
  return create()
    .ele("ENVELOPE")
    .ele("HEADER").ele("TALLYREQUEST").txt("Import Data").up().up()
    .ele("BODY").ele("IMPORTDATA")
    .ele("REQUESTDESC").ele("REPORTNAME").txt("All Masters").up().up()
    .ele("REQUESTDATA")
    .ele("TALLYMESSAGE")
    .ele("LEDGER", { NAME: supplierName, ACTION: "Create" })
    .ele("NAME").txt(supplierName).up()
    .ele("PARENT").txt("Sundry Creditors").up()
    .ele("ISBILLWISEON").txt("Yes").up()
    .up()
    .up()
    .up()
    .up()
    .end({ prettyPrint: true });
}
 
 
 
// ✅ Purchase Account Ledger XML
function buildPurchaseLedgerXML() {
  return create()
    .ele("ENVELOPE")
    .ele("HEADER").ele("TALLYREQUEST").txt("Import Data").up().up()
    .ele("BODY").ele("IMPORTDATA")
    .ele("REQUESTDESC").ele("REPORTNAME").txt("All Masters").up().up()
    .ele("REQUESTDATA")
    .ele("TALLYMESSAGE")
    .ele("LEDGER", { NAME: "Purchase Account", ACTION: "Create" })
    .ele("NAME").txt("Purchase Account").up()
    .ele("PARENT").txt("Purchase Accounts").up()
    .ele("ISDEEMEDPOSITIVE").txt("Yes").up()
    .ele("ISBILLWISEON").txt("No").up()
    .ele("ISREVENUE").txt("No").up()
    .up()
    .up()
    .up()
    .up()
    .end({ prettyPrint: true });
}
 
 
/* -------------------- Master Data Ensure -------------------- */
async function ensureMasterData(invoice) {
  const supplierName = invoice.customer?.name || invoice.vendor?.name;
  if (!supplierName) throw new Error("Supplier name missing in invoice data");
 
  // Unit
  const unitRes = await axios.post(TALLY_URL, buildUnitXML(), {
    headers: { "Content-Type": "application/xml" },
  });
  const unitError = extractLineError(unitRes.data);
  if (!unitError || unitError.toLowerCase().includes("already exists")) {
    console.log("✅ Unit PIECES ensured");
  } else {
    throw new Error(`Unit creation failed: ${unitError}`);
  }
 
  // Stock Group
  const sgRes = await axios.post(TALLY_URL, buildStockGroupXML(), {
    headers: { "Content-Type": "application/xml" },
  });
  const sgError = extractLineError(sgRes.data);
  if (!sgError || sgError.toLowerCase().includes("already exists")) {
    console.log("✅ Stock Group 'Primary' ensured");
  } else {
    console.warn("⚠️ Stock group issue:", sgError);
  }
 
  // Supplier Ledger
  const supplierLedgerRes = await axios.post(
    TALLY_URL,
    buildSupplierLedgerXML(supplierName),
    { headers: { "Content-Type": "application/xml" } }
  );
  const supplierLedgerError = extractLineError(supplierLedgerRes.data);
  if (!supplierLedgerError || supplierLedgerError.toLowerCase().includes("already exists")) {
    console.log(`✅ Supplier ledger "${supplierName}" ensured`);
  } else {
    throw new Error(`Supplier ledger failed: ${supplierLedgerError}`);
  }
 
  // Purchase Ledger
  const purchaseLedgerRes = await axios.post(TALLY_URL, buildPurchaseLedgerXML(), {
    headers: { "Content-Type": "application/xml" },
  });
  const purchaseLedgerError = extractLineError(purchaseLedgerRes.data);
  if (!purchaseLedgerError || purchaseLedgerError.toLowerCase().includes("already exists")) {
    console.log("✅ Purchase ledger ensured");
  } else {
    console.warn("⚠️ Purchase ledger issue:", purchaseLedgerError);
  }
 
  // Items
  for (let item of invoice.items) {
    const itemName = item.title || item.name || "Unknown Item";
    const itemRes = await axios.post(TALLY_URL, buildItemXML(itemName), {
      headers: { "Content-Type": "application/xml" },
    });
    const itemError = extractLineError(itemRes.data);
    if (!itemError || itemError.toLowerCase().includes("already exists")) {
      console.log(`✅ Item "${itemName}" ensured`);
    } else {
      throw new Error(`Item '${itemName}' creation failed: ${itemError}`);
    }
  }
}
 
function buildPurchaseVoucherXML(invoice) {
  const dateStr = (invoice.invoice_date || new Date().toISOString())
    .split("T")[0]
    .replace(/-/g, "");

  const supplierName = invoice.customer?.name || invoice.vendor?.name || "Unknown Supplier";
  const cgst = invoice.cgst || 0;
  const sgst = invoice.sgst || 0;
  const igst = invoice.igst || 0;
  const total = invoice.total || 0;
  const billNo = invoice.invoice_number || invoice.bill_no || "";

  const doc = create({ version: "1.0" });
  const envelope = doc.ele("ENVELOPE");
  envelope.ele("HEADER").ele("TALLYREQUEST").txt("Import Data");
  const importData = envelope.ele("BODY").ele("IMPORTDATA");
  importData.ele("REQUESTDESC").ele("REPORTNAME").txt("Vouchers");

  const voucher = importData.ele("REQUESTDATA")
    .ele("TALLYMESSAGE", { "xmlns:UDF": "TallyUDF" })
    .ele("VOUCHER", { VCHTYPE: "Purchase", ACTION: "Create", OBJVIEW: "Invoice Voucher View" });

  voucher.ele("DATE").txt(dateStr);
  voucher.ele("EFFECTIVEDATE").txt(dateStr);
  voucher.ele("VOUCHERTYPENAME").txt("Purchase");
  voucher.ele("PARTYNAME").txt(supplierName);
  voucher.ele("PARTYLEDGERNAME").txt(supplierName);
  voucher.ele("PERSISTEDVIEW").txt("Invoice Voucher View");
  voucher.ele("VCHENTRYMODE").txt("Item Invoice");
  voucher.ele("ISINVOICE").txt("Yes");
  voucher.ele("NARRATION").txt(invoice.notes || "");

  // Inventory entries — Purchase Account ONLY in ACCOUNTINGALLOCATIONS, not separately
  // Signs follow Tally's own export: ISDEEMEDPOSITIVE=Yes + negative AMOUNT for purchase/debit side
  for (const item of invoice.items || []) {
    const qty = item.quantity || 1;
    const rate = item.unit_price || item.price || 0;
    const amount = qty * rate;
    const itemName = item.title || item.name || "Unknown Item";

    const inv = voucher.ele("ALLINVENTORYENTRIES.LIST");
    inv.ele("STOCKITEMNAME").txt(itemName);
    inv.ele("ISDEEMEDPOSITIVE").txt("Yes");
    inv.ele("RATE").txt(`${rate}/PIECES`);
    inv.ele("AMOUNT").txt("-" + amount);
    inv.ele("ACTUALQTY").txt(`${qty} PIECES`);
    inv.ele("BILLEDQTY").txt(`${qty} PIECES`);

    const batch = inv.ele("BATCHALLOCATIONS.LIST");
    batch.ele("GODOWNNAME").txt("Main Location");
    batch.ele("BATCHNAME").txt("Primary Batch");
    batch.ele("AMOUNT").txt("-" + amount);
    batch.ele("ACTUALQTY").txt(`${qty} PIECES`);
    batch.ele("BILLEDQTY").txt(`${qty} PIECES`);

    const acct = inv.ele("ACCOUNTINGALLOCATIONS.LIST");
    acct.ele("LEDGERNAME").txt("Purchase Account");
    acct.ele("ISDEEMEDPOSITIVE").txt("Yes");
    acct.ele("ISPARTYLEDGER").txt("No");
    acct.ele("AMOUNT").txt("-" + amount);
  }

  // Vendor (Cr): LEDGERENTRIES.LIST, positive amount, ISDEEMEDPOSITIVE=No
  const vendEntry = voucher.ele("LEDGERENTRIES.LIST");
  vendEntry.ele("LEDGERNAME").txt(supplierName);
  vendEntry.ele("ISDEEMEDPOSITIVE").txt("No");
  vendEntry.ele("ISPARTYLEDGER").txt("Yes");
  vendEntry.ele("AMOUNT").txt(String(total));
  const billAlloc = vendEntry.ele("BILLALLOCATIONS.LIST");
  billAlloc.ele("NAME").txt(billNo);
  billAlloc.ele("BILLTYPE").txt("New Ref");
  billAlloc.ele("AMOUNT").txt(String(total));

  // GST Input ledgers (Dr): LEDGERENTRIES.LIST, ISDEEMEDPOSITIVE=Yes, negative amount
  if (cgst > 0) {
    const e = voucher.ele("LEDGERENTRIES.LIST");
    e.ele("LEDGERNAME").txt("CGST Input");
    e.ele("ISDEEMEDPOSITIVE").txt("Yes");
    e.ele("ISPARTYLEDGER").txt("No");
    e.ele("AMOUNT").txt("-" + cgst);
  }
  if (sgst > 0) {
    const e = voucher.ele("LEDGERENTRIES.LIST");
    e.ele("LEDGERNAME").txt("SGST Input");
    e.ele("ISDEEMEDPOSITIVE").txt("Yes");
    e.ele("ISPARTYLEDGER").txt("No");
    e.ele("AMOUNT").txt("-" + sgst);
  }
  if (igst > 0) {
    const e = voucher.ele("LEDGERENTRIES.LIST");
    e.ele("LEDGERNAME").txt("IGST Input");
    e.ele("ISDEEMEDPOSITIVE").txt("Yes");
    e.ele("ISPARTYLEDGER").txt("No");
    e.ele("AMOUNT").txt("-" + igst);
  }

  return doc.end({ prettyPrint: true });
}
 
 
/* -------------------- Utils -------------------- */
function extractLineError(tallyResponse) {
  const match = tallyResponse.match(/<LINEERROR>(.*?)<\/LINEERROR>/);
  return match ? match[1] : null;
}
 
async function reportStatus(invoiceId, status, errorMsg) {
  await axios.post(`${SERVER_URL}/webhook`, {
    apiKey: API_KEY,
    event: "sync-status",
    invoiceId,
    status,
    error: errorMsg || "",
  });
}
 
/* -------------------- Main Loop -------------------- */
async function mainLoop() {
  try {
    const res = await axios.post(`${SERVER_URL}/webhook`, {
      apiKey: API_KEY,
      event: "sync-request",
    });
 
    const invoices = res.data.invoices || [];
    console.log(`📋 Processing ${invoices.length} purchase invoice(s)`);
 
    for (let invoice of invoices) {
      try {
        console.log(`🔄 Processing purchase invoice ${invoice}`);
        await ensureMasterData(invoice);
 
        const xml = buildPurchaseVoucherXML(invoice);
        console.log("🔧 Voucher XML:", xml);
 
        const tallyRes = await axios.post(TALLY_URL, xml, {
          headers: { "Content-Type": "application/xml" },
        });
 
        console.log("📥 Tally response:", tallyRes.data);
        const invoiceError = extractLineError(tallyRes.data);
        if (invoiceError) throw new Error(invoiceError);
 
        console.log(`✅ Synced purchase invoice ${invoice._id}`);
        await reportStatus(invoice._id, "success");
      } catch (err) {
        console.error(`❌ Failed to sync purchase invoice ${invoice._id}: ${err.message}`);
        await reportStatus(invoice._id, "error", err.message);
      }
    }
  } catch (err) {
    console.error("❌ Agent loop error:", err.message);
  }
}
 
// ─── Expense Sync ────────────────────────────────────────────────────────────

const EXPENSE_LEDGER_MAP = {
  rent: 'Rent', utilities: 'Utilities', salaries: 'Salaries',
  office_supplies: 'Office Supplies', travel: 'Travel Expenses',
  marketing: 'Marketing Expenses', software: 'Software Expenses',
  hardware: 'Hardware Expenses', maintenance: 'Maintenance Expenses',
  insurance: 'Insurance', professional_fees: 'Professional Fees',
  taxes: 'Taxes & Duties', miscellaneous: 'Miscellaneous Expenses'
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

async function ensureCashLedger() {
  const xml = create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER').ele('TALLYREQUEST').txt('Import Data').up().up()
      .ele('BODY').ele('IMPORTDATA')
        .ele('REQUESTDESC').ele('REPORTNAME').txt('All Masters').up().up()
        .ele('REQUESTDATA').ele('TALLYMESSAGE')
          .ele('LEDGER', { NAME: 'Cash', RESERVEDNAME: '' })
            .ele('NAME').txt('Cash').up()
            .ele('PARENT').txt('Cash-in-Hand').up()
          .up()
        .up().up()
      .up()
    .end({ prettyPrint: true });
  try {
    const res = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) console.log('⚠️ Cash ledger:', err);
  } catch (e) { console.log('⚠️ Cash ledger error:', e.message); }
}

async function ensureExpenseMasterData(expense) {
  const ledgerName = categoryToLedger(expense.category);
  const bankLedger = expense.mode === 'cash' ? 'Cash' : 'Bank';

  try {
    const res = await axios.post(TALLY_URL, buildExpenseLedgerXML(ledgerName), { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) console.log(`⚠️ Expense ledger "${ledgerName}":`, err);
    else console.log(`✅ Expense ledger "${ledgerName}" ensured`);
  } catch (e) { console.log('⚠️ Expense ledger error:', e.message); }

  if (bankLedger === 'Cash') {
    await ensureCashLedger();
  } else {
    try {
      const res = await axios.post(TALLY_URL, buildBankLedgerXML(), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) console.log('⚠️ Bank ledger:', err);
    } catch (e) { console.log('⚠️ Bank ledger error:', e.message); }
  }

  const inputLedgers = [];
  if (expense.cgst > 0) inputLedgers.push({ name: 'CGST Input', head: 'Central Tax' });
  if (expense.sgst > 0) inputLedgers.push({ name: 'SGST Input', head: 'State Tax' });
  if (expense.igst > 0) inputLedgers.push({ name: 'IGST Input', head: 'Integrated Tax' });
  for (const l of inputLedgers) {
    try {
      const res = await axios.post(TALLY_URL, buildGSTInputLedgerXML(l.name, l.head), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) console.log(`⚠️ ${l.name}:`, err);
    } catch (e) { console.log(`⚠️ ${l.name} error:`, e.message); }
  }

  if (expense.has_tds && expense.tds_amount > 0) {
    try {
      const res = await axios.post(TALLY_URL, buildTDSPayableLedgerXML(), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) console.log('⚠️ TDS Payable ledger:', err);
    } catch (e) { console.log('⚠️ TDS Payable ledger error:', e.message); }
  }
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

async function reportExpenseStatus(expenseId, status, errorMsg, tallyVoucherNumber) {
  try {
    await axios.post(`${SERVER_URL}/webhook`, {
      apiKey: API_KEY,
      event: 'expense-sync-status',
      data: { expenseId, status, error: errorMsg || '', tallyVoucherNumber }
    });
  } catch (err) {
    console.error('❌ Failed to report expense status:', err.message);
  }
}

async function expenseLoop() {
  try {
    const res = await axios.post(`${SERVER_URL}/webhook`, {
      apiKey: API_KEY,
      event: 'expense-sync-request'
    });
    const expenses = res.data.expenses || [];
    console.log(`🧾 Processing ${expenses.length} expense(s)`);
    for (const expense of expenses) {
      try {
        await ensureExpenseMasterData(expense);
        const xml = buildExpenseXML(expense);
        const tallyRes = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'application/xml' } });
        if (tallyRes.data.includes('Unknown Request')) throw new Error('Tally rejected: Unknown Request');
        const lineError = extractLineError(tallyRes.data);
        if (lineError) throw new Error(`Expense creation failed: ${lineError}`);
        console.log(`✅ Expense ${expense._id} synced`);
        await reportExpenseStatus(expense._id, 'success');
      } catch (err) {
        console.error(`❌ Expense ${expense._id} failed:`, err.message);
        await reportExpenseStatus(expense._id, 'error', err.message);
      }
    }
  } catch (err) {
    console.error('❌ Expense loop error:', err.message);
  }
}

setInterval(mainLoop, 60 * 1000);
setInterval(expenseLoop, 60 * 1000);
mainLoop();
expenseLoop();