require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const fs = require("fs");
const path = require("path");

const axios = require("axios");
const { create } = require("xmlbuilder2");

const SERVER_URL = process.env.SERVER_URL;
const CA_KEY = process.env.CA_KEY;
const AGENT_VERSION = process.env.AGENT_VERSION || null;
// Legacy single-company support (if CA_KEY not set)
const API_KEY = process.env.API_KEY;
const COMPANY_ID = process.env.COMPANY_ID;

console.log("─────────────────────────────────────────");
console.log("🚀 Timber TallyAgent starting");
console.log(`   SERVER_URL : ${SERVER_URL  || "❌ MISSING — set SERVER_URL in .env"}`);
console.log(`   Mode       : ${CA_KEY ? `CA_KEY (${CA_KEY.slice(0, 10)}…)` : API_KEY ? `Legacy API_KEY + COMPANY_ID=${COMPANY_ID}` : "❌ No auth key found in .env"}`);
console.log("─────────────────────────────────────────");

if (!SERVER_URL) {
  console.error("❌ SERVER_URL is not set. Copy your .env into this directory and restart.");
  process.exit(1);
}

// Companies fetched dynamically via agent-init (CA_KEY mode)
// or set from env (legacy mode)
let companies = COMPANY_ID
  ? [{ company_id: COMPANY_ID, tally_company_name: process.env.TALLY_COMPANY_NAME || "Company", gstin: process.env.TALLY_COMPANY_GSTIN || "", state: process.env.TALLY_COMPANY_STATE || "Kerala" }]
  : [];

// Per-company context vars (updated before each company's sync cycle)
let TALLY_GSTIN = process.env.TALLY_COMPANY_GSTIN || "";
let TALLY_STATE = process.env.TALLY_COMPANY_STATE || "Kerala";

async function fetchTallyCompanies() {
  // Day Book is the only safe exportable report in Tally Prime.
  // Tally always embeds <SVCURRENTCOMPANY> in the XML response header.
  // "List of Companies" doesn't exist; "Company Summary" / "COMPANY MASTER"
  // trigger TDL error dialogs inside Tally Prime's UI — do not use them.
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const xml = `<?xml version="1.0"?><ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>${today}</SVFROMDATE><SVTODATE>${today}</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
  try {
    const res = await axios.post(TALLY_URL, xml, { headers: { "Content-Type": "application/xml" }, timeout: 5000 });
    console.log("[fetchTallyCompanies] Day Book header:", res.data.substring(0, 600));
    const m = res.data.match(/<SVCURRENTCOMPANY>(.*?)<\/SVCURRENTCOMPANY>/i);
    if (m && m[1].trim()) {
      const name = m[1].trim();
      console.log("[fetchTallyCompanies] Current company:", name);
      return [name];
    }
    console.warn("[fetchTallyCompanies] <SVCURRENTCOMPANY> not found in response — no company open in Tally?");
    return [];
  } catch (e) {
    console.warn("[fetchTallyCompanies] Tally not reachable:", e.message);
    return [];
  }
}

async function agentInit() {
  if (!CA_KEY) {
    console.log(`[agent-init] Legacy mode — using COMPANY_ID=${COMPANY_ID}`);
    return;
  }
  console.log(`[agent-init] Fetching company list from server…`);
  try {
    const tally_companies = await fetchTallyCompanies();
    if (tally_companies.length > 0) {
      console.log(`[agent-init] Open Tally companies: ${tally_companies.join(", ")}`);
    }
    const res = await axios.post(`${SERVER_URL}/webhook`, { caKey: CA_KEY, event: "agent-init", tally_companies });
    companies = res.data.companies || [];
    if (companies.length === 0) {
      console.warn("[agent-init] ⚠️  No companies returned. Enable sync for at least one client in Timber → CA Settings → Integrations.");
    } else {
      console.log(`[agent-init] ✅ ${companies.length} company/companies loaded:`);
      companies.forEach(c => console.log(`   • company_id=${c.company_id}  tally="${c.tally_company_name}"  gstin=${c.gstin || "—"}`));
    }

    // Auto-update check
    const latest_version = res.data.latest_version;
    const download_url = res.data.agent_download_url;
    if (latest_version && AGENT_VERSION && latest_version !== AGENT_VERSION && download_url) {
      console.log(`[agent-init] 🔄 New version available: ${latest_version} (current: ${AGENT_VERSION}). Downloading…`);
      try {
        const exeRes = await axios.get(download_url, { responseType: "arraybuffer", timeout: 60000 });
        const exePath = path.join(__dirname, "TallyAgent-update.exe");
        fs.writeFileSync(exePath, Buffer.from(exeRes.data));
        console.log(`[agent-init] ✅ Update downloaded to ${exePath}. Restarting service to apply…`);
        // Signal service manager to restart (works with node-windows / NSSM)
        process.exit(0);
      } catch (updateErr) {
        console.error("[agent-init] ⚠️  Auto-update failed — will retry next cycle:", updateErr.message);
      }
    } else if (latest_version) {
      console.log(`[agent-init] ✅ Agent is up to date (v${AGENT_VERSION || latest_version})`);
    }
  } catch (err) {
    console.error("[agent-init] ❌ Failed:", err.response?.data || err.message);
  }
}
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
async function reportStatus(invoiceId, status, errorMsg, tallyVoucherNumber, companyId) {
  try {
    await axios.post(`${SERVER_URL}/webhook`, {
      ...(CA_KEY ? { caKey: CA_KEY } : { apiKey: API_KEY }),
      company_id: companyId || COMPANY_ID,
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
  voucher.ele('PERSISTEDVIEW').txt('Accounting Voucher View');
  voucher.ele('NARRATION').txt(p.notes || '');

  // Cash: ALLLEDGERENTRIES.LIST, positive amount, ISDEEMEDPOSITIVE=No
  const cashEntry = voucher.ele('ALLLEDGERENTRIES.LIST');
  cashEntry.ele('LEDGERNAME').txt('Cash');
  cashEntry.ele('ISDEEMEDPOSITIVE').txt('No');
  cashEntry.ele('AMOUNT').txt(String(amount));

  // Customer: ALLLEDGERENTRIES.LIST, negative amount, ISDEEMEDPOSITIVE=Yes
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

async function ensurePurchaseMasterData(bill) {
  const vendorName = bill.vendor_name || 'Unknown Vendor';
  const lineItems = (bill.line_items || []).filter(i => i.qty > 0 || i.amount > 0);

  // Purchase Account ledger
  try {
    const res = await axios.post(TALLY_URL, buildPurchaseAccountXML(), { headers: { 'Content-Type': 'application/xml' } });
    console.log('[bill] Purchase Account creation response:', res.data);
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) console.log('⚠️ Purchase Account ledger:', err);
    else console.log('✅ Purchase Account ledger ensured');
  } catch (e) { console.log('⚠️ Purchase Account error:', e.message); }

  // PIECES unit (needed for inventory entries)
  try {
    const res = await axios.post(TALLY_URL, buildUnitXML(), { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) console.log('⚠️ Unit PIECES:', err);
  } catch (e) { console.log('⚠️ Unit PIECES error:', e.message); }

  // Stock items — use real line items if available, else fall back to generic
  const itemsToCreate = lineItems.length > 0
    ? lineItems.map(i => ({
        name: i.name || i.sku || i.product_name || bill.description || 'Purchase',
        gstRate: i.gst_rate || bill.gst_rate || 0,
        hsn: i.hsn_code || i.hsn || ''
      }))
    : [{ name: bill.description || bill.bill_no || 'Purchase', gstRate: bill.gst_rate || 0, hsn: '' }];

  for (const item of itemsToCreate) {
    try {
      const itemXML = buildItemXML(item.name, item.gstRate, item.hsn);
      const itemRes = await axios.post(TALLY_URL, itemXML, { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(itemRes.data);
      if (err && !err.toLowerCase().includes('already exists')) console.log(`⚠️ Item "${item.name}":`, err);
      else console.log(`✅ Item "${item.name}" ensured`);
    } catch (e) { console.log(`⚠️ Item "${item.name}" error:`, e.message); }
  }

  // GST Input ledgers
  const inputLedgers = [];
  if (bill.cgst > 0) inputLedgers.push({ name: 'CGST Input', head: 'Central Tax' });
  if (bill.sgst > 0) inputLedgers.push({ name: 'SGST Input', head: 'State Tax' });
  if (bill.igst > 0) inputLedgers.push({ name: 'IGST Input', head: 'Integrated Tax' });
  for (const l of inputLedgers) {
    try {
      const res = await axios.post(TALLY_URL, buildGSTInputLedgerXML(l.name, l.head), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) console.log(`⚠️ ${l.name} ledger:`, err);
    } catch (e) { console.log(`⚠️ ${l.name} error:`, e.message); }
  }

  // Vendor ledger (Sundry Creditors)
  try {
    const res = await axios.post(TALLY_URL, buildVendorLedgerXML(vendorName), { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) console.log(`⚠️ Vendor ledger "${vendorName}":`, err);
    else console.log(`✅ Vendor ledger "${vendorName}" ensured`);
  } catch (e) { console.log('⚠️ Vendor ledger error:', e.message); }
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

  // Normalise to inventory rows (fallback: single row with full taxable)
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

  // OBJVIEW must match PERSISTEDVIEW for Invoice Voucher View to work on import
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

  // Inventory entries — signs follow Tally's own export:
  // ISDEEMEDPOSITIVE=Yes + negative AMOUNT for purchase/debit side
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

  // Vendor (Cr): LEDGERENTRIES.LIST, ISDEEMEDPOSITIVE=No, positive amount
  const vendEntry = voucher.ele('LEDGERENTRIES.LIST');
  vendEntry.ele('LEDGERNAME').txt(vendorName);
  vendEntry.ele('ISDEEMEDPOSITIVE').txt('No');
  vendEntry.ele('ISPARTYLEDGER').txt('Yes');
  vendEntry.ele('AMOUNT').txt(String(total));
  const billAlloc = vendEntry.ele('BILLALLOCATIONS.LIST');
  billAlloc.ele('NAME').txt(billNo);
  billAlloc.ele('BILLTYPE').txt('New Ref');
  billAlloc.ele('AMOUNT').txt(String(total));

  // GST Input ledgers (Dr): LEDGERENTRIES.LIST, ISDEEMEDPOSITIVE=Yes, negative amount
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

async function fetchTallyPurchaseVoucherNumber(dateStr, vendorName, total) {
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
    const res = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'application/xml' }, timeout: 10000 });
    const blocks = [...res.data.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
      .filter(([, body]) => /<VOUCHERTYPENAME>\s*Purchase\s*<\/VOUCHERTYPENAME>/i.test(body));
    for (const [, body] of blocks) {
      const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
      const name = get('PARTYNAME') || get('PARTYLEDGERNAME');
      if (name.toLowerCase() !== vendorName.toLowerCase()) continue;
      // Match by total amount — check both ALLLEDGERENTRIES and LEDGERENTRIES
      // (Tally may normalize tag names on export differently from import)
      const ledgerBodies = [
        ...[...body.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g)].map(([, b]) => b),
        ...[...body.matchAll(/<LEDGERENTRIES\.LIST>([\s\S]*?)<\/LEDGERENTRIES\.LIST>/g)].map(([, b]) => b)
      ];
      const amountMatched = ledgerBodies.some(b => {
        const amtMatch = b.match(/<AMOUNT>(.*?)<\/AMOUNT>/);
        const amt = amtMatch ? Math.abs(parseFloat(amtMatch[1])) : null;
        return amt !== null && Math.abs(amt - total) <= 1;
      });
      if (!amountMatched) continue;
      return get('VOUCHERNUMBER');
    }
  } catch (e) {
    console.error('[agent] fetchTallyPurchaseVoucherNumber error:', e.message);
  }
  return null;
}

async function reportBillStatus(billId, status, errorMsg, tallyVoucherNumber, companyId) {
  try {
    await axios.post(`${SERVER_URL}/webhook`, {
      ...(CA_KEY ? { caKey: CA_KEY } : { apiKey: API_KEY }),
      company_id: companyId || COMPANY_ID,
      event: 'bill-sync-status',
      data: { billId, status, error: errorMsg || '', tallyVoucherNumber }
    });
  } catch (err) {
    console.error('❌ Failed to report bill status:', err.message);
  }
}

async function billLoop() {
  for (const company of companies) {
    const { company_id, gstin, state } = company;
    TALLY_GSTIN = gstin; TALLY_STATE = state;
    try {
      const res = await axios.post(`${SERVER_URL}/webhook`, {
        ...(CA_KEY ? { caKey: CA_KEY } : { apiKey: API_KEY }),
        company_id,
        event: 'bill-sync-request'
      });
      const bills = res.data.bills || [];
      console.log(`🧾 [${company_id}] Processing ${bills.length} bill(s)`);
      for (const bill of bills) {
        try {
          await ensurePurchaseMasterData(bill);
          const xml = buildPurchaseXML(bill);
          const tallyRes = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'application/xml' } });
          if (tallyRes.data.includes('Unknown Request')) throw new Error('Tally rejected: Unknown Request');
          const lineError = extractLineError(tallyRes.data);
          if (lineError) throw new Error(`Purchase creation failed: ${lineError}`);
          const exceptionsMatch = tallyRes.data.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          if (exceptionsMatch && parseInt(exceptionsMatch[1]) > 0) {
            const detail = (tallyRes.data.match(/<ERROR>(.*?)<\/ERROR>/i) || [])[1] || 'no detail';
            throw new Error(`Purchase had exceptions: ${detail}`);
          }
          const rawDate = bill.bill_date || new Date().toISOString();
          const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
            .split('T')[0].replace(/-/g, '');
          const tallyVoucherNumber = await fetchTallyPurchaseVoucherNumber(dateStr, bill.vendor_name, bill.total_amount);
          console.log(`✅ Bill ${bill.id} synced, voucher: ${tallyVoucherNumber}`);
          await reportBillStatus(bill.id, 'success', null, tallyVoucherNumber, company_id);
        } catch (err) {
          console.error(`❌ Bill ${bill.id} failed:`, err.message);
          await reportBillStatus(bill.id, 'error', err.message, null, company_id);
        }
      }
    } catch (err) {
      console.error(`❌ Bill loop [${company_id}] error:`, err.response?.data?.message || err.response?.data?.error || err.message);
    }
  }
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

async function reportPaymentStatus(paymentId, status, errorMsg, receiptNumber, companyId) {
  try {
    await axios.post(`${SERVER_URL}/webhook`, {
      ...(CA_KEY ? { caKey: CA_KEY } : { apiKey: API_KEY }),
      company_id: companyId || COMPANY_ID,
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

      // Receipt vouchers use ALLLEDGERENTRIES.LIST; customer entry has ISDEEMEDPOSITIVE=No
      const allEntries = [...body.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g)];
      const partyEntry = allEntries.find(([, b]) => /<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>/i.test(b));
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
  for (const company of companies) {
    const { company_id, gstin, state } = company;
    TALLY_GSTIN = gstin; TALLY_STATE = state;
    try {
      const res = await axios.post(`${SERVER_URL}/webhook`, {
        ...(CA_KEY ? { caKey: CA_KEY } : { apiKey: API_KEY }),
        company_id,
        event: 'payment-sync-request'
      });

      const payments = res.data.payments || [];
      console.log(`💰 [${company_id}] Processing ${payments.length} payment(s)`);

      for (const p of payments) {
        try {
          await ensureCashLedger();
          const xml = buildReceiptXML(p);
          const tallyRes = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'application/xml' } });

          if (tallyRes.data.includes('Unknown Request'))
            throw new Error('Tally rejected receipt: Unknown Request');
          const lineError = extractLineError(tallyRes.data);
          if (lineError) throw new Error(`Receipt creation failed: ${lineError}`);

          const exceptionsMatch = tallyRes.data.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          if (exceptionsMatch && parseInt(exceptionsMatch[1]) > 0) {
            const detail = (tallyRes.data.match(/<ERROR>(.*?)<\/ERROR>/i) || tallyRes.data.match(/<ERRLISTEX>([\s\S]*?)<\/ERRLISTEX>/i) || [])[1] || 'no detail';
            throw new Error(`Receipt creation had exceptions: ${detail}`);
          }

          const rawDate = p.date || new Date().toISOString();
          const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
            .split('T')[0].replace(/-/g, '');
          const receiptNumber = await fetchTallyReceiptNumber(dateStr, p.customer_name, p.amount);
          console.log(`✅ Payment ${p.id} synced, receipt: ${receiptNumber}`);
          await reportPaymentStatus(p.id, 'success', null, receiptNumber, company_id);
        } catch (err) {
          console.error(`❌ Payment ${p.id} failed:`, err.message);
          await reportPaymentStatus(p.id, 'error', err.message, null, company_id);
        }
      }
    } catch (err) {
      console.error(`❌ Payment loop [${company_id}] error:`, err.response?.data?.message || err.message);
    }
  }
}

// 🔄 Main loop
async function mainLoop() {
  for (const company of companies) {
    const { company_id, gstin, state } = company;
    TALLY_GSTIN = gstin; TALLY_STATE = state;
    try {
      const res = await axios.post(`${SERVER_URL}/webhook`, {
        ...(CA_KEY ? { caKey: CA_KEY } : { apiKey: API_KEY }),
        company_id,
        event: "sync-request",
      });

      const invoices = res.data.invoices || [];
      console.log(`📋 [${company_id}] Processing ${invoices.length} invoice(s)`);

      for (let invoice of invoices) {
        try {
          console.log(`🔄 Processing invoice ${invoice.id}`);
          await ensureMasterData(invoice);

          const xml = buildInvoiceXML(invoice);
          const tallyRes = await axios.post(TALLY_URL, xml, { headers: { "Content-Type": "application/xml" } });

          require("fs").writeFileSync("invoice.xml", xml);
          require("fs").writeFileSync("tally-response.xml", tallyRes.data);

          if (tallyRes.data.includes("Unknown Request")) {
            throw new Error("Tally rejected the request: Unknown Request — check XML structure or ensure a company is open in Tally Prime");
          }

          const invoiceError = extractLineError(tallyRes.data);
          if (invoiceError) throw new Error(`Invoice creation failed: ${invoiceError}`);

          const responseText = tallyRes.data;
          const exceptionsMatch = responseText.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          const exceptions = exceptionsMatch ? parseInt(exceptionsMatch[1]) : 0;
          if (exceptions > 0) {
            const errorMatch = responseText.match(/<ERROR>(.*?)<\/ERROR>/i);
            const exceptionMatch = responseText.match(/<EXCEPTION>(.*?)<\/EXCEPTION>/i);
            const errListMatch = responseText.match(/<ERRLISTEX>([\s\S]*?)<\/ERRLISTEX>/i);
            const detail = errorMatch?.[1] || exceptionMatch?.[1] || errListMatch?.[1]?.trim() || "no detail returned by Tally";
            throw new Error(`Invoice creation had exceptions: ${detail}`);
          }

          console.log(`✅ Synced invoice ${invoice.id}`);
          const rawDate = invoice.invoice_date || invoice.issue_date || new Date().toISOString();
          const dateStr = (typeof rawDate === "string" ? rawDate : new Date(rawDate).toISOString())
            .split("T")[0].replace(/-/g, "");
          const partyName = invoice.customer?.name || invoice.customerName || "";
          const tallyVoucherNumber = await fetchTallyVoucherNumber(dateStr, partyName, invoice.total);
          await reportStatus(invoice.id, "success", null, tallyVoucherNumber, company_id);
        } catch (err) {
          console.error(`❌ Failed to sync invoice ${invoice.id}: ${err.message}`);
          await reportStatus(invoice.id, "error", err.message, null, company_id);
        }
      }
    } catch (err) {
      console.error(`❌ Agent loop [${company_id}] error:`, err.response?.data?.message || err.message);
    }
  }
}

// 🏗️ Build Payment voucher XML (Timber → Tally vendor payment)
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

  // Cash: ISDEEMEDPOSITIVE=Yes, AMOUNT=-amount (cash goes out)
  const cashEntry = voucher.ele('ALLLEDGERENTRIES.LIST');
  cashEntry.ele('LEDGERNAME').txt('Cash');
  cashEntry.ele('ISDEEMEDPOSITIVE').txt('Yes');
  cashEntry.ele('AMOUNT').txt('-' + amount);

  // Vendor: ISDEEMEDPOSITIVE=No, AMOUNT=+amount (payable cleared), Agst Ref
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

async function fetchTallyPaymentNumber(dateStr, vendorName, amount) {
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
    const res = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'application/xml' }, timeout: 10000 });
    const blocks = [...res.data.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
      .filter(([, body]) => /<VOUCHERTYPENAME>\s*Payment\s*<\/VOUCHERTYPENAME>/i.test(body));
    for (const [, body] of blocks) {
      const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
      const name = get('PARTYNAME') || get('PARTYLEDGERNAME');
      if (name.toLowerCase() !== vendorName.toLowerCase()) continue;
      const ledgerBodies = [
        ...[...body.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g)].map(([, b]) => b),
        ...[...body.matchAll(/<LEDGERENTRIES\.LIST>([\s\S]*?)<\/LEDGERENTRIES\.LIST>/g)].map(([, b]) => b)
      ];
      const amountMatched = ledgerBodies.some(b => {
        const amtMatch = b.match(/<AMOUNT>(.*?)<\/AMOUNT>/);
        const amt = amtMatch ? Math.abs(parseFloat(amtMatch[1])) : null;
        return amt !== null && Math.abs(amt - amount) <= 1;
      });
      if (!amountMatched) continue;
      return get('VOUCHERNUMBER');
    }
  } catch (e) {
    console.error('[agent] fetchTallyPaymentNumber error:', e.message);
  }
  return null;
}

async function reportPaymentMadeStatus(paymentMadeId, status, errorMsg, paymentNumber, companyId) {
  try {
    await axios.post(`${SERVER_URL}/webhook`, {
      ...(CA_KEY ? { caKey: CA_KEY } : { apiKey: API_KEY }),
      company_id: companyId || COMPANY_ID,
      event: 'payment-made-sync-status',
      data: { paymentMadeId, status, error: errorMsg || '', paymentNumber }
    });
  } catch (err) {
    console.error('❌ Failed to report payment-made status:', err.message);
  }
}

async function paymentMadeLoop() {
  for (const company of companies) {
    const { company_id, gstin, state } = company;
    TALLY_GSTIN = gstin; TALLY_STATE = state;
    try {
      const res = await axios.post(`${SERVER_URL}/webhook`, {
        ...(CA_KEY ? { caKey: CA_KEY } : { apiKey: API_KEY }),
        company_id,
        event: 'payment-made-sync-request'
      });
      const payments = res.data.payments || [];
      console.log(`💸 [${company_id}] Processing ${payments.length} vendor payment(s)`);
      for (const p of payments) {
        try {
          await ensureCashLedger();
          const xml = buildPaymentVoucherXML(p);
          const tallyRes = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'application/xml' } });
          if (tallyRes.data.includes('Unknown Request')) throw new Error('Tally rejected: Unknown Request');
          const lineError = extractLineError(tallyRes.data);
          if (lineError) throw new Error(`Payment creation failed: ${lineError}`);
          const exceptionsMatch = tallyRes.data.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          if (exceptionsMatch && parseInt(exceptionsMatch[1]) > 0) {
            const detail = (tallyRes.data.match(/<ERROR>(.*?)<\/ERROR>/i) || [])[1] || 'no detail';
            throw new Error(`Payment had exceptions: ${detail}`);
          }
          const rawDate = p.date || new Date().toISOString();
          const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
            .split('T')[0].replace(/-/g, '');
          const paymentNumber = await fetchTallyPaymentNumber(dateStr, p.vendor_name, p.amount);
          console.log(`✅ Vendor payment ${p.id} synced, voucher: ${paymentNumber}`);
          await reportPaymentMadeStatus(p.id, 'success', null, paymentNumber, company_id);
        } catch (err) {
          console.error(`❌ Vendor payment ${p.id} failed:`, err.message);
          await reportPaymentMadeStatus(p.id, 'error', err.message, null, company_id);
        }
      }
    } catch (err) {
      console.error(`❌ Payment-made loop [${company_id}] error:`, err.response?.data?.message || err.message);
    }
  }
}

// ─── Expense Sync ────────────────────────────────────────────────────────────

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

async function ensureExpenseMasterData(expense) {
  const ledgerName = categoryToLedger(expense.category);
  const bankLedger = expense.mode === 'cash' ? 'Cash' : 'Bank';

  // Expense ledger under Indirect Expenses
  try {
    const res = await axios.post(TALLY_URL, buildExpenseLedgerXML(ledgerName), { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) console.log(`⚠️ Expense ledger "${ledgerName}":`, err);
    else console.log(`✅ Expense ledger "${ledgerName}" ensured`);
  } catch (e) { console.log(`⚠️ Expense ledger error:`, e.message); }

  // Bank or Cash ledger
  if (bankLedger === 'Cash') {
    await ensureCashLedger();
  } else {
    try {
      const res = await axios.post(TALLY_URL, buildBankLedgerXML(), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) console.log('⚠️ Bank ledger:', err);
    } catch (e) { console.log('⚠️ Bank ledger error:', e.message); }
  }

  // GST Input ledgers (only if GST applies)
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

  // TDS Payable ledger (only if TDS applies)
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
  // Cash/bank payout = total minus TDS withheld
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

  // Bank/Cash (Cr): money goes out → ISDEEMEDPOSITIVE=Yes, AMOUNT=-(cashAmount)
  const bankEntry = voucher.ele('ALLLEDGERENTRIES.LIST');
  bankEntry.ele('LEDGERNAME').txt(bankLedger);
  bankEntry.ele('ISDEEMEDPOSITIVE').txt('Yes');
  bankEntry.ele('AMOUNT').txt('-' + cashAmount);

  // Expense Ledger (Dr): ISDEEMEDPOSITIVE=No, AMOUNT=+(taxable)
  const expEntry = voucher.ele('ALLLEDGERENTRIES.LIST');
  expEntry.ele('LEDGERNAME').txt(ledgerName);
  expEntry.ele('ISDEEMEDPOSITIVE').txt('No');
  expEntry.ele('AMOUNT').txt(String(taxable));

  // GST Input ledgers (Dr) — only when GST is applicable
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

  // TDS Payable (Cr): liability created → ISDEEMEDPOSITIVE=Yes, AMOUNT=-(tdsAmount)
  if (hasTds) {
    const e = voucher.ele('ALLLEDGERENTRIES.LIST');
    e.ele('LEDGERNAME').txt('TDS Payable');
    e.ele('ISDEEMEDPOSITIVE').txt('Yes');
    e.ele('AMOUNT').txt('-' + tdsAmount);
  }

  return doc.end({ prettyPrint: true });
}

async function fetchTallyExpenseVoucherNumber(dateStr, amount) {
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
    const res = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'application/xml' }, timeout: 10000 });
    const blocks = [...res.data.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
      .filter(([, body]) => /<VOUCHERTYPENAME>\s*Payment\s*<\/VOUCHERTYPENAME>/i.test(body));
    for (const [, body] of blocks) {
      const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
      const allEntries = [
        ...[...body.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g)].map(([, b]) => b),
        ...[...body.matchAll(/<LEDGERENTRIES\.LIST>([\s\S]*?)<\/LEDGERENTRIES\.LIST>/g)].map(([, b]) => b)
      ];
      const matched = allEntries.some(b => {
        const amtMatch = b.match(/<AMOUNT>(.*?)<\/AMOUNT>/);
        const amt = amtMatch ? Math.abs(parseFloat(amtMatch[1])) : null;
        return amt !== null && Math.abs(amt - amount) <= 1;
      });
      if (matched) return get('VOUCHERNUMBER');
    }
  } catch (e) {
    console.error('[agent] fetchTallyExpenseVoucherNumber error:', e.message);
  }
  return null;
}

async function reportExpenseStatus(expenseId, status, errorMsg, tallyVoucherNumber, companyId) {
  try {
    await axios.post(`${SERVER_URL}/webhook`, {
      ...(CA_KEY ? { caKey: CA_KEY } : { apiKey: API_KEY }),
      company_id: companyId || COMPANY_ID,
      event: 'expense-sync-status',
      data: { expenseId, status, error: errorMsg || '', tallyVoucherNumber }
    });
  } catch (err) {
    console.error('❌ Failed to report expense status:', err.message);
  }
}

async function expenseLoop() {
  for (const company of companies) {
    const { company_id, gstin, state } = company;
    TALLY_GSTIN = gstin; TALLY_STATE = state;
    try {
      const res = await axios.post(`${SERVER_URL}/webhook`, {
        ...(CA_KEY ? { caKey: CA_KEY } : { apiKey: API_KEY }),
        company_id,
        event: 'expense-sync-request'
      });
      const expenses = res.data.expenses || [];
      console.log(`🧾 [${company_id}] Processing ${expenses.length} expense(s)`);
      for (const expense of expenses) {
        try {
          await ensureExpenseMasterData(expense);
          const xml = buildExpenseXML(expense);
          const tallyRes = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'application/xml' } });
          if (tallyRes.data.includes('Unknown Request')) throw new Error('Tally rejected: Unknown Request');
          const lineError = extractLineError(tallyRes.data);
          if (lineError) throw new Error(`Expense creation failed: ${lineError}`);
          const exceptionsMatch = tallyRes.data.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          if (exceptionsMatch && parseInt(exceptionsMatch[1]) > 0) {
            const detail = (tallyRes.data.match(/<ERROR>(.*?)<\/ERROR>/i) || [])[1] || 'no detail';
            throw new Error(`Expense had exceptions: ${detail}`);
          }
          const rawDate = expense.date || new Date().toISOString();
          const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
            .split('T')[0].replace(/-/g, '');
          const tallyVoucherNumber = await fetchTallyExpenseVoucherNumber(dateStr, expense.total);
          console.log(`✅ Expense ${expense.id} synced, voucher: ${tallyVoucherNumber}`);
          await reportExpenseStatus(expense.id, 'success', null, tallyVoucherNumber, company_id);
        } catch (err) {
          console.error(`❌ Expense ${expense.id} failed:`, err.message);
          await reportExpenseStatus(expense.id, 'error', err.message, null, company_id);
        }
      }
    } catch (err) {
      console.error(`❌ Expense loop [${company_id}] error:`, err.response?.data?.message || err.message);
    }
  }
}

const { runPull } = require('./tally-pull');

// 🕒 Initialise companies then start all sync loops
agentInit().then(() => {
  console.log(`[agent] Starting sync loops (${companies.length} companies active). Polling every 60s.`);
  // Refresh company list every 5 minutes (picks up new clients added in Timber)
  setInterval(agentInit, 5 * 60 * 1000);

  setInterval(mainLoop, 60 * 1000);
  setInterval(paymentLoop, 60 * 1000);
  setInterval(billLoop, 60 * 1000);
  setInterval(paymentMadeLoop, 60 * 1000);
  setInterval(expenseLoop, 60 * 1000);
  // Pull runs per company in CA_KEY mode, using the live companies array
  setInterval(() => runPull(companies, CA_KEY), 60 * 1000);

  mainLoop();
  paymentLoop();
  billLoop();
  paymentMadeLoop();
  expenseLoop();
  runPull(companies, CA_KEY);
});