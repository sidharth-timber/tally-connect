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
 
 
 
// ✅ Purchase Ledger XML
function buildPurchaseLedgerXML() {
  return create()
    .ele("ENVELOPE")
    .ele("HEADER").ele("TALLYREQUEST").txt("Import Data").up().up()
    .ele("BODY").ele("IMPORTDATA")
    .ele("REQUESTDESC").ele("REPORTNAME").txt("All Masters").up().up()
    .ele("REQUESTDATA")
    .ele("TALLYMESSAGE")
    .ele("LEDGER", { NAME: "Purchase", ACTION: "Create" })
    .ele("NAME").txt("Purchase").up()
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
 
  const root = create()
    .ele("ENVELOPE")
    .ele("HEADER").ele("TALLYREQUEST").txt("Import Data").up().up()
    .ele("BODY").ele("IMPORTDATA")
    .ele("REQUESTDESC").ele("REPORTNAME").txt("Vouchers").up().up()
    .ele("REQUESTDATA")
    .ele("TALLYMESSAGE", { xmlns: "TallyUDF" })
    .ele("VOUCHER", { VCHTYPE: "Purchase", ACTION: "Create" })
    .ele("DATE").txt(dateStr).up()
    .ele("VOUCHERTYPENAME").txt("Purchase").up()
    .ele("PARTYLEDGERNAME").txt(invoice.customer?.name || "Unknown Supplier").up()
    .ele("PERSISTEDVIEW").txt("Invoice Voucher View").up()
 
    // Credit supplier (negative amount)
    .ele("LEDGERENTRIES.LIST")
    .ele("LEDGERNAME").txt(invoice.customer?.name || "Unknown Supplier").up()
    .ele("ISDEEMEDPOSITIVE").txt("Yes").up()
    .ele("AMOUNT").txt(`-${invoice.total}`).up()
    .up()
 
    // Debit Purchase ledger (positive amount)
    .ele("LEDGERENTRIES.LIST")
    .ele("LEDGERNAME").txt("Purchase").up()
    .ele("ISDEEMEDPOSITIVE").txt("No").up()
    .ele("AMOUNT").txt(invoice.total).up()
    .up();
 
  // Inventory entries for each item
  for (let item of invoice.items || []) {
    const qty = item.quantity || 1;
    const rate = item.unit_price || item.price || 0;
    const amount = qty * rate;
 
    root.last()
      .ele("INVENTORYENTRIES.LIST")
      .ele("STOCKITEMNAME").txt(item.title || "Unknown Item").up()
      .ele("ISDEEMEDPOSITIVE").txt("No").up()
      .ele("RATE").txt(rate).up()
      .ele("AMOUNT").txt(amount).up()
      .ele("ACTUALQTY").txt(`${qty} pcs`).up()
      .ele("BILLEDQTY").txt(`${qty} pcs`).up()
      .ele("UNIT").txt("PIECES").up()
      .up();
  }
 
  return root.end({ prettyPrint: true });
}
 
 
/* -------------------- Voucher XML -------------------- */
function buildPurchaseLedgerXML() {
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
    .ele("LEDGER", { NAME: "Purchase", RESERVEDNAME: "" })
    .ele("NAME").txt("Purchase").up()
    .ele("PARENT").txt("Purchase Accounts").up()   // group name
    .ele("ISDEEMEDPOSITIVE").txt("Yes").up()
    .ele("ISBILLWISEON").txt("No").up()
    .ele("ISREVENUE").txt("No").up()
    .up()
    .up()
    .up()
    .up()
    .up()
    .end({ prettyPrint: true });
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
        console.log(`🔄 Processing purchase invoice ${invoice._id}`);
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
 
setInterval(mainLoop, 60 * 1000);
mainLoop();