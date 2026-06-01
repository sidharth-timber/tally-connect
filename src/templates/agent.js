require("dotenv").config();
const fs = require("fs");

const axios = require("axios");
const { create } = require("xmlbuilder2");

const SERVER_URL = process.env.SERVER_URL;
const API_KEY = process.env.API_KEY;
const COMPANY_ID = process.env.COMPANY_ID;
const TALLY_COMPANY_NAME = process.env.TALLY_COMPANY_NAME || "Company";
const TALLY_GSTIN = process.env.TALLY_COMPANY_GSTIN || "";
const TALLY_STATE = process.env.TALLY_COMPANY_STATE || "Kerala";
fs.appendFileSync(require("path").join(__dirname, "agent-run-log.txt"), `${SERVER_URL} agent.js started at ${new Date()}\n`);
const TALLY_URL = "http://localhost:9000";

// 🧱 Helper to build unit XML for "PIECES"
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

// 🧱 Helper to build ledger XML for customer
function buildLedgerXML(customerName) {
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
              .ele("LEDGER", { NAME: customerName, RESERVEDNAME: "" })
                .ele("NAME").txt(customerName).up()
                .ele("PARENT").txt("Sundry Debtors").up()
                .ele("ISBILLWISEON").txt("Yes").up()
              .up()
            .up()
          .up()
        .up()
      .up()
    .end({ prettyPrint: true });
}

// 🧱 Helper to build Sales ledger XML - Fixed version
function buildSalesLedgerXML() {
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
              .ele("LEDGER", { NAME: "Sales Account", RESERVEDNAME: "" })
                .ele("NAME").txt("Sales Account").up()
                .ele("PARENT").txt("Sales Accounts").up()
                .ele("ISREVENUE").txt("Yes").up()
                .ele("AFFECTSGST").txt("No").up()
                .ele("ISDEEMEDPOSITIVE").txt("No").up()
                .ele("USEFORVAT").txt("No").up()
                .ele("ISPARTYLEDGER").txt("No").up()
                .ele("ISBILLWISEON").txt("No").up()
                .ele("ISINACTIVE").txt("No").up()
              .up()
            .up()
          .up()
        .up()
      .up()
    .end({ prettyPrint: true });
}

// 🧱 Helper to build item XML with PIECES as unit and GST rate
function buildItemXML(itemName, gstRate, hsnCode) {
  const centralRate = (gstRate || 0) / 2;
  const stateRate = (gstRate || 0) / 2;

  const msg = create({ version: "1.0" })
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
                .ele("PARENT").txt("Primary").up()
                .ele("BASEUNITS").txt("PIECES").up()
                .ele("ISSTOCKITEM").txt("Yes").up()
                .ele("HSNDETAILS.LIST")
                  .ele("APPLICABLEFROM").txt("20010401").up()
                  .ele("HSNCODE").txt(hsnCode || "").up()
                  .ele("TAXABILITY").txt("Taxable").up()
                  .ele("GSTRATE").txt((gstRate || 0).toString()).up()
                  .ele("INTEGRATEDTAXRATE").txt((gstRate || 0).toString()).up()
                  .ele("CENTRALTAXRATE").txt(centralRate.toString()).up()
                  .ele("STATETAXRATE").txt(stateRate.toString()).up()
                .up()
              .up()
            .up()
          .up()
        .up()
      .up()
    .end({ prettyPrint: true });

  return msg;
}

// 🧱 Helper to build GST tax ledger XML (CGST / SGST / IGST)
function buildGSTLedgerXML(name, gstHead) {
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
              .ele("LEDGER", { NAME: name, RESERVEDNAME: "" })
                .ele("NAME").txt(name).up()
                .ele("PARENT").txt("Duties & Taxes").up()
                .ele("TAXTYPE").txt("GST").up()
                .ele("GSTDUTYHEAD").txt(gstHead).up()
              .up()
            .up()
          .up()
        .up()
      .up()
    .end({ prettyPrint: true });
}

// 🧱 Helper to build stock group XML
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

// 🛠 Ensures master data exists: Unit + Stock Group + Customer Ledger + Items + Sales Ledger
async function ensureMasterData(invoice) {
  // 1️⃣ Create or ensure "PIECES" unit exists
  try {
    const unitXML = buildUnitXML();
    console.log("🔧 Creating unit XML:", unitXML);
    
    const unitRes = await axios.post(TALLY_URL, unitXML, {
      headers: { "Content-Type": "application/xml" },
    });
    
    console.log("📥 Unit response:", unitRes.data);
    
    const unitError = extractLineError(unitRes.data);
    if (unitError && !unitError.toLowerCase().includes("already exists")) {
      throw new Error(`Unit creation failed: ${unitError}`);
    }
    
    if (unitError && unitError.toLowerCase().includes("already exists")) {
      console.log("ℹ️ Unit PIECES already exists, continuing...");
    } else {
      console.log("✅ Unit PIECES created successfully");
    }
  } catch (err) {
    console.error("❌ Unit creation error:", err.message);
    throw err;
  }

  // 1.5️⃣ Create or ensure "Primary" stock group exists
  try {
    const stockGroupXML = buildStockGroupXML();
    const stockGroupRes = await axios.post(TALLY_URL, stockGroupXML, {
      headers: { "Content-Type": "application/xml" },
    });
    
    const stockGroupError = extractLineError(stockGroupRes.data);
    if (stockGroupError && !stockGroupError.toLowerCase().includes("already exists")) {
      console.log("⚠️ Primary stock group creation failed, will try without parent group");
    } else {
      console.log("✅ Stock group 'Primary' ensured");
    }
  } catch (err) {
    console.log("⚠️ Stock group creation error, will try items without parent group");
  }

  // 2️⃣ Create or ensure Sales Account ledger FIRST
  try {
    const salesLedgerXML = buildSalesLedgerXML();
    const salesLedgerRes = await axios.post(TALLY_URL, salesLedgerXML, {
      headers: { "Content-Type": "application/xml" },
    });
    
    const salesLedgerError = extractLineError(salesLedgerRes.data);
    if (salesLedgerError && !salesLedgerError.toLowerCase().includes("already exists")) {
      console.log("⚠️ Sales ledger creation failed:", salesLedgerError);
      // Don't throw error, continue with invoice creation
    } else {
      console.log("✅ Sales ledger 'Sales Account' ensured");
    }
  } catch (err) {
    console.log("⚠️ Sales ledger creation error:", err.message);
  }

  // 3️⃣ Create or ensure GST tax ledgers (CGST / SGST / IGST)
  const gstLedgers = [];
  if (invoice.cgst > 0) gstLedgers.push({ name: "CGST", head: "Central Tax" });
  if (invoice.sgst > 0) gstLedgers.push({ name: "SGST", head: "State Tax" });
  if (invoice.igst > 0) gstLedgers.push({ name: "IGST", head: "Integrated Tax" });

  for (const gst of gstLedgers) {
    try {
      const gstXML = buildGSTLedgerXML(gst.name, gst.head);
      const gstRes = await axios.post(TALLY_URL, gstXML, { headers: { "Content-Type": "application/xml" } });
      const gstError = extractLineError(gstRes.data);
      if (gstError && !gstError.toLowerCase().includes("already exists")) {
        console.log(`⚠️ ${gst.name} ledger creation failed:`, gstError);
      } else {
        console.log(`✅ ${gst.name} ledger ensured`);
      }
    } catch (err) {
      console.log(`⚠️ ${gst.name} ledger creation error:`, err.message);
    }
  }

  // 5️⃣ Create or ensure customer ledger
  try {
    const customerName = invoice.customer?.name || invoice.customerName || "Unknown Customer";
    const ledgerXML = buildLedgerXML(customerName);
    const ledgerRes = await axios.post(TALLY_URL, ledgerXML, {
      headers: { "Content-Type": "application/xml" },
    });
    
    const ledgerError = extractLineError(ledgerRes.data);
    if (ledgerError && !ledgerError.toLowerCase().includes("already exists")) {
      throw new Error(`Customer creation failed: ${ledgerError}`);
    }
    
    console.log(`✅ Customer ledger for "${customerName}" ensured`);
  } catch (err) {
    console.error("❌ Customer ledger error:", err.message);
    throw err;
  }

  // 6️⃣ Create or ensure each item (always alter to keep GST rate in sync)
  for (let item of invoice.items) {
    const itemName = item.title || item.name || 'Unknown Item';
    try {
      const itemXML = buildItemXML(itemName, item.gst_rate || 0, item.hsn || "");
      const itemRes = await axios.post(TALLY_URL, itemXML, {
        headers: { "Content-Type": "application/xml" },
      });

      const itemError = extractLineError(itemRes.data);
      if (itemError && itemError.toLowerCase().includes("already exists")) {
        // Item exists — send Alter to update GST details
        const alterXML = itemXML.replace(
          `<STOCKITEM NAME="${itemName}" RESERVEDNAME="">`,
          `<STOCKITEM NAME="${itemName}" RESERVEDNAME="" ACTION="Alter">`
        );
        const alterRes = await axios.post(TALLY_URL, alterXML, {
          headers: { "Content-Type": "application/xml" },
        });
        const alterError = extractLineError(alterRes.data);
        if (alterError) throw new Error(`Item alter failed: ${alterError}`);
        console.log(`✅ Item "${itemName}" updated with GST rate`);
      } else if (itemError) {
        throw new Error(`Item '${itemName}' creation failed: ${itemError}`);
      } else {
        console.log(`✅ Item "${itemName}" created with GST rate`);
      }
    } catch (err) {
      console.error(`❌ Item creation error for "${itemName}":`, err.message);
      throw err;
    }
  }
}

// 🔎 Extracts error text from Tally response XML string
function extractLineError(tallyResponse) {
  const match = tallyResponse.match(/<LINEERROR>(.*?)<\/LINEERROR>/);
  return match ? match[1] : null;
}

// 📝 Reports sync status to server
async function reportStatus(invoiceId, status, errorMsg, tallyVoucherNumber) {
  try {
    await axios.post(`${SERVER_URL}/webhook`, {
      apiKey: API_KEY,
      companyId: COMPANY_ID,
      event: "sync-status",
      data: { invoiceId, status, error: errorMsg || "", tallyVoucherNumber }
    });
  } catch (err) {
    console.error("❌ Failed to report status:", err.message);
  }
}

async function fetchTallyVoucherNumber(dateStr, partyName, total) {
  try {
    const xml = `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>Day Book</REPORTNAME>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <SVFROMDATE>${dateStr}</SVFROMDATE>
      <SVTODATE>${dateStr}</SVTODATE>
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

    const res = await axios.post(TALLY_URL, xml, {
      headers: { "Content-Type": "application/xml" },
      timeout: 10000
    });

    const blocks = [...res.data.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
      .filter(([, body]) => /<VOUCHERTYPENAME>\s*Sales\s*<\/VOUCHERTYPENAME>/i.test(body));

    for (const [, body] of blocks) {
      const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ""; };
      const name = get("PARTYNAME") || get("PARTYLEDGERNAME");
      if (name.toLowerCase() !== partyName.toLowerCase()) continue;

      // Match by total: the party ledger entry carries the invoice total as a negative amount
      const partyEntry = [...body.matchAll(/<LEDGERENTRIES\.LIST>([\s\S]*?)<\/LEDGERENTRIES\.LIST>/g)]
        .find(([, b]) => /<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER>/i.test(b));
      if (partyEntry) {
        const amtMatch = partyEntry[1].match(/<AMOUNT>(.*?)<\/AMOUNT>/);
        const tallyTotal = amtMatch ? Math.abs(parseFloat(amtMatch[1])) : null;
        if (tallyTotal !== null && Math.abs(tallyTotal - total) > 1) continue; // >1 tolerance for rounding
      }

      return get("VOUCHERNUMBER");
    }
  } catch (e) {
    console.error("[agent] fetchTallyVoucherNumber error:", e.message);
  }
  return null;
}

// 🏗️ Build invoice XML matching Tally Prime's own export structure exactly
function buildInvoiceXML_FULL(invoice) {
  const rawDate = invoice.invoice_date || invoice.issue_date || new Date().toISOString();
  const dateStr = (typeof rawDate === "string" ? rawDate : new Date(rawDate).toISOString())
    .split("T")[0].replace(/-/g, "");
  const customerName = invoice.customer?.name || invoice.customerName || "Unknown Customer";

  const subtotal = invoice.subtotal || invoice.items.reduce((sum, item) => {
    return sum + (item.quantity || item.qty || 1) * (item.unit_price || item.rate || 0);
  }, 0);
  const cgst = invoice.cgst || 0;
  const sgst = invoice.sgst || 0;
  const igst = invoice.igst || 0;
  const total = invoice.total || (subtotal + cgst + sgst + igst);

  const doc = create({ version: "1.0" });
  const envelope = doc.ele("ENVELOPE");
  envelope.ele("HEADER").ele("TALLYREQUEST").txt("Import Data");

  const importData = envelope.ele("BODY").ele("IMPORTDATA");
  importData.ele("REQUESTDESC").ele("REPORTNAME").txt("Vouchers");

  // OBJVIEW is an attribute on VOUCHER — confirmed from Tally's own export
  const voucher = importData.ele("REQUESTDATA")
    .ele("TALLYMESSAGE", { "xmlns:UDF": "TallyUDF" })
    .ele("VOUCHER", { VCHTYPE: "Sales", ACTION: "Create", OBJVIEW: "Invoice Voucher View" });

  voucher.ele("DATE").txt(dateStr);
  voucher.ele("EFFECTIVEDATE").txt(dateStr);
  voucher.ele("VOUCHERTYPENAME").txt("Sales");
  voucher.ele("VOUCHERNUMBER").txt(invoice.invoice_number || "");
  voucher.ele("PARTYLEDGERNAME").txt(customerName);
  voucher.ele("PERSISTEDVIEW").txt("Invoice Voucher View");
  voucher.ele("VCHENTRYMMODE").txt("Item Invoice");
  voucher.ele("ISGSTOVERRIDDEN").txt("No");
  voucher.ele("ISINVOICE").txt("Yes");
  voucher.ele("NARRATION").txt(invoice.notes || "");

  // ALLINVENTORYENTRIES comes FIRST (per Tally's export structure)
  // Amounts are POSITIVE for inventory/sales/GST, NEGATIVE only for party
  for (const item of invoice.items) {
    const quantity = item.quantity || item.qty || 1;
    const rate = item.unit_price || item.rate || 0;
    const itemAmount = quantity * rate;
    const itemName = item.title || item.name || item.desc || "Unknown Item";

    const inv = voucher.ele("ALLINVENTORYENTRIES.LIST");
    inv.ele("STOCKITEMNAME").txt(itemName);
    inv.ele("ISDEEMEDPOSITIVE").txt("No");
    inv.ele("RATE").txt(`${rate}/PIECES`);
    inv.ele("AMOUNT").txt(itemAmount.toString());           // POSITIVE
    inv.ele("ACTUALQTY").txt(`${quantity} PIECES`);
    inv.ele("BILLEDQTY").txt(`${quantity} PIECES`);

    // Batch allocation — required by Tally Prime
    const batch = inv.ele("BATCHALLOCATIONS.LIST");
    batch.ele("GODOWNNAME").txt("Main Location");
    batch.ele("BATCHNAME").txt("Primary Batch");
    batch.ele("AMOUNT").txt(itemAmount.toString());         // POSITIVE
    batch.ele("ACTUALQTY").txt(`${quantity} PIECES`);
    batch.ele("BILLEDQTY").txt(`${quantity} PIECES`);

    // Sales Account inside the item allocation (POSITIVE)
    const salesAlloc = inv.ele("ACCOUNTINGALLOCATIONS.LIST");
    salesAlloc.ele("LEDGERNAME").txt("Sales Account");
    salesAlloc.ele("ISDEEMEDPOSITIVE").txt("No");
    salesAlloc.ele("ISPARTYLEDGER").txt("No");
    salesAlloc.ele("AMOUNT").txt(itemAmount.toString());    // POSITIVE

    // CGST inside item allocation (POSITIVE)
    if (cgst > 0) {
      const e = inv.ele("ACCOUNTINGALLOCATIONS.LIST");
      e.ele("LEDGERNAME").txt("CGST");
      e.ele("ISDEEMEDPOSITIVE").txt("No");
      e.ele("ISPARTYLEDGER").txt("No");
      e.ele("AMOUNT").txt(cgst.toString());                 // POSITIVE
    }
    // SGST inside item allocation (POSITIVE)
    if (sgst > 0) {
      const e = inv.ele("ACCOUNTINGALLOCATIONS.LIST");
      e.ele("LEDGERNAME").txt("SGST");
      e.ele("ISDEEMEDPOSITIVE").txt("No");
      e.ele("ISPARTYLEDGER").txt("No");
      e.ele("AMOUNT").txt(sgst.toString());                 // POSITIVE
    }
    // IGST inside item allocation (POSITIVE)
    if (igst > 0) {
      const e = inv.ele("ACCOUNTINGALLOCATIONS.LIST");
      e.ele("LEDGERNAME").txt("IGST");
      e.ele("ISDEEMEDPOSITIVE").txt("No");
      e.ele("ISPARTYLEDGER").txt("No");
      e.ele("AMOUNT").txt(igst.toString());                 // POSITIVE
    }
  }

  // LEDGERENTRIES comes AFTER inventory — party entry only, amount NEGATIVE
  const custEntry = voucher.ele("LEDGERENTRIES.LIST");
  custEntry.ele("LEDGERNAME").txt(customerName);
  custEntry.ele("ISDEEMEDPOSITIVE").txt("Yes");
  custEntry.ele("ISPARTYLEDGER").txt("Yes");
  custEntry.ele("AMOUNT").txt("-" + total.toString());      // NEGATIVE

  // Bill reference for receivables tracking
  const bill = custEntry.ele("BILLALLOCATIONS.LIST");
  bill.ele("NAME").txt(invoice.invoice_number || "");
  bill.ele("BILLTYPE").txt("New Ref");
  bill.ele("AMOUNT").txt("-" + total.toString());           // NEGATIVE

  return doc.end({ prettyPrint: true });
}

// 🏗️ Build invoice XML matching Tally's "GST Invoice" voucher type export exactly
function buildInvoiceXML(invoice) {
  const rawDate = invoice.invoice_date || invoice.issue_date || new Date().toISOString();
  const dateStr = (typeof rawDate === "string" ? rawDate : new Date(rawDate).toISOString())
    .split("T")[0].replace(/-/g, "");
  const customerName = invoice.customer?.name || invoice.customerName || "Unknown Customer";
  const voucherNumber = invoice.invoice_number || "";

  const subtotal = invoice.subtotal || (invoice.items || []).reduce((sum, item) => {
    return sum + (item.quantity || item.qty || 1) * (item.unit_price || item.rate || 0);
  }, 0);
  const cgst = invoice.cgst || 0;
  const sgst = invoice.sgst || 0;
  const igst = invoice.igst || 0;
  const total = invoice.total || (subtotal + cgst + sgst + igst);

  const doc = create({ version: "1.0" });
  const envelope = doc.ele("ENVELOPE");
  envelope.ele("HEADER").ele("TALLYREQUEST").txt("Import Data");
  const importData = envelope.ele("BODY").ele("IMPORTDATA");
  importData.ele("REQUESTDESC").ele("REPORTNAME").txt("Vouchers");

  const voucher = importData.ele("REQUESTDATA")
    .ele("TALLYMESSAGE", { "xmlns:UDF": "TallyUDF" })
    .ele("VOUCHER", { VCHTYPE: "Sales", ACTION: "Create", OBJVIEW: "Invoice Voucher View" });

  voucher.ele("DATE").txt(dateStr);
  voucher.ele("EFFECTIVEDATE").txt(dateStr);
  voucher.ele("GSTREGISTRATIONTYPE").txt("Regular");
  voucher.ele("STATENAME").txt(TALLY_STATE);
  voucher.ele("COUNTRYOFRESIDENCE").txt("India");
  voucher.ele("PLACEOFSUPPLY").txt(TALLY_STATE);
  voucher.ele("VOUCHERTYPENAME").txt("Sales");
  voucher.ele("PARTYNAME").txt(customerName);
  voucher.ele("CMPGSTIN").txt(TALLY_GSTIN);
  voucher.ele("PARTYLEDGERNAME").txt(customerName);
  voucher.ele("VOUCHERNUMBER").txt(voucherNumber);
  voucher.ele("BASICBUYERNAME").txt(customerName);
  voucher.ele("CMPGSTREGISTRATIONTYPE").txt("Regular");
  voucher.ele("PARTYMAILINGNAME").txt(customerName);
  voucher.ele("CONSIGNEEMAILINGNAME").txt(customerName);
  voucher.ele("CONSIGNEESTATENAME").txt(TALLY_STATE);
  voucher.ele("CMPGSTSTATE").txt(TALLY_STATE);
  voucher.ele("CONSIGNEECOUNTRYNAME").txt("India");
  voucher.ele("BASICBASEPARTYNAME").txt(customerName);
  voucher.ele("PERSISTEDVIEW").txt("Invoice Voucher View");
  voucher.ele("VCHENTRYMODE").txt("Item Invoice");
  voucher.ele("ISGSTOVERRIDDEN").txt("No");
  voucher.ele("ISINVOICE").txt("Yes");
  voucher.ele("VCHGSTSTATUSISUNCERTAIN").txt("Yes");
  voucher.ele("VCHGSTSTATUSISAPPLICABLE").txt("Yes");
  voucher.ele("NARRATION").txt(invoice.notes || "");

  // Inventory entries FIRST — Sales Account only in ACCOUNTINGALLOCATIONS
  for (const item of (invoice.items || [])) {
    const quantity = item.quantity || item.qty || 1;
    const rate = item.unit_price || item.rate || 0;
    const itemAmount = quantity * rate;
    const itemName = item.title || item.name || item.desc || "Unknown Item";
    const gstRate = item.gst_rate || 0;

    const inv = voucher.ele("ALLINVENTORYENTRIES.LIST");
    inv.ele("STOCKITEMNAME").txt(itemName);
    inv.ele("ISDEEMEDPOSITIVE").txt("No");
    inv.ele("RATE").txt(`${rate}/PIECES`);
    inv.ele("AMOUNT").txt(itemAmount.toString());
    inv.ele("ACTUALQTY").txt(`${quantity} PIECES`);
    inv.ele("BILLEDQTY").txt(`${quantity} PIECES`);

    const batch = inv.ele("BATCHALLOCATIONS.LIST");
    batch.ele("GODOWNNAME").txt("Main Location");
    batch.ele("BATCHNAME").txt("Primary Batch");
    batch.ele("AMOUNT").txt(itemAmount.toString());
    batch.ele("ACTUALQTY").txt(`${quantity} PIECES`);
    batch.ele("BILLEDQTY").txt(`${quantity} PIECES`);

    const salesAlloc = inv.ele("ACCOUNTINGALLOCATIONS.LIST");
    salesAlloc.ele("LEDGERNAME").txt("Sales Account");
    salesAlloc.ele("ISDEEMEDPOSITIVE").txt("No");
    salesAlloc.ele("ISPARTYLEDGER").txt("No");
    salesAlloc.ele("AMOUNT").txt(itemAmount.toString());

    // GST rate details on the item (as per Tally's own export)
    const cgstRateEntry = inv.ele("RATEDETAILS.LIST");
    cgstRateEntry.ele("GSTRATEDUTYHEAD").txt("CGST");
    cgstRateEntry.ele("GSTRATEVALUATIONTYPE").txt("Based on Value");
    cgstRateEntry.ele("GSTRATE").txt((gstRate / 2).toString());

    const sgstRateEntry = inv.ele("RATEDETAILS.LIST");
    sgstRateEntry.ele("GSTRATEDUTYHEAD").txt("SGST/UTGST");
    sgstRateEntry.ele("GSTRATEVALUATIONTYPE").txt("Based on Value");
    sgstRateEntry.ele("GSTRATE").txt((gstRate / 2).toString());

    const igstRateEntry = inv.ele("RATEDETAILS.LIST");
    igstRateEntry.ele("GSTRATEDUTYHEAD").txt("IGST");
    igstRateEntry.ele("GSTRATEVALUATIONTYPE").txt("Based on Value");
    igstRateEntry.ele("GSTRATE").txt(gstRate.toString());
  }

  // Customer ledger AFTER inventory — NEGATIVE amount
  const custEntry = voucher.ele("LEDGERENTRIES.LIST");
  custEntry.ele("LEDGERNAME").txt(customerName);
  custEntry.ele("ISDEEMEDPOSITIVE").txt("Yes");
  custEntry.ele("ISPARTYLEDGER").txt("Yes");
  custEntry.ele("AMOUNT").txt("-" + total.toString());
  const bill = custEntry.ele("BILLALLOCATIONS.LIST");
  bill.ele("NAME").txt(voucherNumber);
  bill.ele("BILLTYPE").txt("New Ref");
  bill.ele("AMOUNT").txt("-" + total.toString());

  // CGST — POSITIVE (comes before SGST, per Tally's own export)
  if (cgst > 0) {
    const e = voucher.ele("LEDGERENTRIES.LIST");
    e.ele("LEDGERNAME").txt("CGST");
    e.ele("ISDEEMEDPOSITIVE").txt("No");
    e.ele("ISPARTYLEDGER").txt("No");
    e.ele("REMOVEZEROENTRIES").txt("No");
    e.ele("AMOUNT").txt(cgst.toString());
    e.ele("VATEXPAMOUNT").txt(cgst.toString());
  }

  // SGST — POSITIVE
  if (sgst > 0) {
    const e = voucher.ele("LEDGERENTRIES.LIST");
    e.ele("LEDGERNAME").txt("SGST");
    e.ele("ISDEEMEDPOSITIVE").txt("No");
    e.ele("ISPARTYLEDGER").txt("No");
    e.ele("REMOVEZEROENTRIES").txt("No");
    e.ele("AMOUNT").txt(sgst.toString());
    e.ele("VATEXPAMOUNT").txt(sgst.toString());
  }

  // IGST — POSITIVE
  if (igst > 0) {
    const e = voucher.ele("LEDGERENTRIES.LIST");
    e.ele("LEDGERNAME").txt("IGST");
    e.ele("ISDEEMEDPOSITIVE").txt("No");
    e.ele("ISPARTYLEDGER").txt("No");
    e.ele("REMOVEZEROENTRIES").txt("No");
    e.ele("AMOUNT").txt(igst.toString());
    e.ele("VATEXPAMOUNT").txt(igst.toString());
  }

  return doc.end({ prettyPrint: true });
}

// 🧾 Build Receipt voucher XML (Timber → Tally payment)
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
  voucher.ele('NARRATION').txt(p.notes || '');

  // Cash: debit side (money in)
  const cashEntry = voucher.ele('LEDGERENTRIES.LIST');
  cashEntry.ele('LEDGERNAME').txt('Cash');
  cashEntry.ele('ISDEEMEDPOSITIVE').txt('Yes');
  cashEntry.ele('ISPARTYLEDGER').txt('No');
  cashEntry.ele('AMOUNT').txt('-' + amount);

  // Customer: credit side (receivable reduced), with bill reference
  const custEntry = voucher.ele('LEDGERENTRIES.LIST');
  custEntry.ele('LEDGERNAME').txt(customerName);
  custEntry.ele('ISDEEMEDPOSITIVE').txt('No');
  custEntry.ele('ISPARTYLEDGER').txt('Yes');
  custEntry.ele('AMOUNT').txt(String(amount));
  const bill = custEntry.ele('BILLALLOCATIONS.LIST');
  bill.ele('NAME').txt(p.tally_voucher_number || '');
  bill.ele('BILLTYPE').txt('Agst Ref');
  bill.ele('AMOUNT').txt(String(amount));

  return doc.end({ prettyPrint: true });
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
    if (err && !err.toLowerCase().includes('already exists')) {
      console.log('⚠️ Cash ledger creation failed:', err);
    }
  } catch (e) {
    console.log('⚠️ Cash ledger creation error:', e.message);
  }
}

async function reportPaymentStatus(paymentId, status, errorMsg, receiptNumber) {
  try {
    await axios.post(`${SERVER_URL}/webhook`, {
      apiKey: API_KEY,
      companyId: COMPANY_ID,
      event: 'payment-sync-status',
      data: { paymentId, status, error: errorMsg || '', receiptNumber }
    });
  } catch (err) {
    console.error('❌ Failed to report payment status:', err.message);
  }
}

async function fetchTallyReceiptNumber(dateStr, partyName, amount) {
  try {
    const xml = `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>Day Book</REPORTNAME>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <SVFROMDATE>${dateStr}</SVFROMDATE>
      <SVTODATE>${dateStr}</SVTODATE>
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

    const res = await axios.post(TALLY_URL, xml, {
      headers: { 'Content-Type': 'application/xml' },
      timeout: 10000
    });

    const blocks = [...res.data.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
      .filter(([, body]) => /<VOUCHERTYPENAME>\s*Receipt\s*<\/VOUCHERTYPENAME>/i.test(body));

    for (const [, body] of blocks) {
      const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
      const name = get('PARTYNAME') || get('PARTYLEDGERNAME');
      if (name.toLowerCase() !== partyName.toLowerCase()) continue;

      const partyEntry = [...body.matchAll(/<LEDGERENTRIES\.LIST>([\s\S]*?)<\/LEDGERENTRIES\.LIST>/g)]
        .find(([, b]) => /<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER>/i.test(b));
      if (partyEntry) {
        const amtMatch = partyEntry[1].match(/<AMOUNT>(.*?)<\/AMOUNT>/);
        const tallyAmt = amtMatch ? Math.abs(parseFloat(amtMatch[1])) : null;
        if (tallyAmt !== null && Math.abs(tallyAmt - amount) > 1) continue;
      }

      return get('VOUCHERNUMBER');
    }
  } catch (e) {
    console.error('[agent] fetchTallyReceiptNumber error:', e.message);
  }
  return null;
}

async function paymentLoop() {
  try {
    const res = await axios.post(`${SERVER_URL}/webhook`, {
      apiKey: API_KEY,
      companyId: COMPANY_ID,
      event: 'payment-sync-request'
    });

    const payments = res.data.payments || [];
    console.log(`💰 Processing ${payments.length} payment(s)`);

    for (const p of payments) {
      try {
        await ensureCashLedger();
        const xml = buildReceiptXML(p);
        const tallyRes = await axios.post(TALLY_URL, xml, {
          headers: { 'Content-Type': 'application/xml' }
        });

        if (tallyRes.data.includes('Unknown Request'))
          throw new Error('Tally rejected receipt: Unknown Request');
        const lineError = extractLineError(tallyRes.data);
        if (lineError) throw new Error(`Receipt creation failed: ${lineError}`);

        const rawDate = p.date || new Date().toISOString();
        const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
          .split('T')[0].replace(/-/g, '');
        const receiptNumber = await fetchTallyReceiptNumber(dateStr, p.customer_name, p.amount);
        console.log(`✅ Payment ${p._id} synced, receipt: ${receiptNumber}`);
        await reportPaymentStatus(p._id, 'success', null, receiptNumber);
      } catch (err) {
        console.error(`❌ Payment ${p._id} failed:`, err.message);
        await reportPaymentStatus(p._id, 'error', err.message);
      }
    }
  } catch (err) {
    console.error('❌ Payment loop error:', err.response?.data?.message || err.message);
  }
}

// 🔄 Main loop
async function mainLoop() {
  try {
    const res = await axios.post(`${SERVER_URL}/webhook`, {
      apiKey: API_KEY,
      companyId: COMPANY_ID,
      event: "sync-request",
    });

    const invoices = res.data.invoices || [];
    console.log(`📋 Processing ${invoices.length} invoice(s)`);

    for (let invoice of invoices) {
      try {
        console.log(`🔄 Processing invoice ${invoice._id}`);
        await ensureMasterData(invoice);

        const xml = buildInvoiceXML(invoice);
        console.log("🔧 Creating invoice XML:", xml);
        
        const tallyRes = await axios.post(TALLY_URL, xml, {
          headers: { "Content-Type": "application/xml" },
        });

        console.log("📥 Invoice response:", tallyRes.data);
        require("fs").writeFileSync("invoice.xml", xml);
        require("fs").writeFileSync("tally-response.xml", tallyRes.data);

        if (tallyRes.data.includes("Unknown Request")) {
          throw new Error("Tally rejected the request: Unknown Request — check XML structure or ensure a company is open in Tally Prime");
        }

        const invoiceError = extractLineError(tallyRes.data);
        if (invoiceError) {
          throw new Error(`Invoice creation failed: ${invoiceError}`);
        }

        // Check for exceptions
        const responseText = tallyRes.data;
        const exceptionsMatch = responseText.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
        const exceptions = exceptionsMatch ? parseInt(exceptionsMatch[1]) : 0;
        
        if (exceptions > 0) {
          const errorMatch = responseText.match(/<ERROR>(.*?)<\/ERROR>/i);
          const exceptionMatch = responseText.match(/<EXCEPTION>(.*?)<\/EXCEPTION>/i);
          const errListMatch = responseText.match(/<ERRLISTEX>([\s\S]*?)<\/ERRLISTEX>/i);
          const detail = errorMatch?.[1] || exceptionMatch?.[1] || errListMatch?.[1]?.trim() || "no detail returned by Tally";
          console.log(`⚠️ Invoice exception detail: ${detail}`);
          console.log("⚠️ Full Tally response:", responseText);
          throw new Error(`Invoice creation had exceptions: ${detail}`);
        }

        console.log(`✅ Synced invoice ${invoice._id}`);
        const rawDate = invoice.invoice_date || invoice.issue_date || new Date().toISOString();
        const dateStr = (typeof rawDate === "string" ? rawDate : new Date(rawDate).toISOString())
          .split("T")[0].replace(/-/g, "");
        const partyName = invoice.customer?.name || invoice.customerName || "";
        const tallyVoucherNumber = await fetchTallyVoucherNumber(dateStr, partyName, invoice.total);
        console.log(`[agent] Tally voucher number for ${invoice._id}: ${tallyVoucherNumber}`);
        await reportStatus(invoice._id, "success", null, tallyVoucherNumber);
      } catch (err) {
        console.error(`❌ Failed to sync invoice ${invoice._id}: ${err.message}`);
        await reportStatus(invoice._id, "error", err.message);
      }
    }
  } catch (err) {
    console.error("❌ Agent loop error:", err.response?.data?.message || err.message);
  }
}

// 🕒 Run every minute
setInterval(mainLoop, 60 * 1000);
setInterval(paymentLoop, 60 * 1000);
mainLoop();
paymentLoop();

require('./tally-pull');