require("dotenv").config();
const axios = require("axios");
const { create } = require("xmlbuilder2");

const SERVER_URL = process.env.SERVER_URL;
const API_KEY = process.env.API_KEY;
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
                .ele("PARENT").txt("Sundry Debtors").up()
                .ele("ISBILLWISEON").txt("Yes").up()
              .up()
            .up()
          .up()
        .up()
      .up()
    .end({ prettyPrint: true });
}

// 🧱 Helper to build item XML with PIECES as unit (consistent with unit creation)
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
                .ele("PARENT").txt("Primary").up()
                .ele("BASEUNITS").txt("PIECES").up() // Changed from NOS to PIECES
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

// 🛠 Ensures master data exists: Unit + Stock Group + Customer Ledger + Items
async function ensureMasterData(invoice) {
  // 1️⃣ Create or ensure "PIECES" unit exists
  try {
    const unitXML = buildUnitXML();
    console.log("🔧 Creating unit XML:", unitXML); // Debug log
    
    const unitRes = await axios.post(TALLY_URL, unitXML, {
      headers: { "Content-Type": "application/xml" },
    });
    
    console.log("📥 Unit response:", unitRes.data); // Debug log
    
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

  // 2️⃣ Create or ensure customer ledger
  try {
    const customerName = invoice.customer.name;
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

  // 3️⃣ Create or ensure each item
  for (let item of invoice.items) {
    // Define itemName outside try block so it's accessible in catch
    const itemName = item.title || item.name || 'Unknown Item';
    try {
      const itemXML = buildItemXML(itemName);
      const itemRes = await axios.post(TALLY_URL, itemXML, {
        headers: { "Content-Type": "application/xml" },
      });
      
      const itemError = extractLineError(itemRes.data);
      if (itemError && !itemError.toLowerCase().includes("already exists")) {
        throw new Error(`Item '${itemName}' creation failed: ${itemError}`);
      }
      
      console.log(`✅ Item "${itemName}" ensured`);
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
async function reportStatus(invoiceId, status, errorMsg) {
  await axios.post(`${SERVER_URL}/webhook`, {
    apiKey: API_KEY,
    event: "sync-status",
    data: { invoiceId, status, error: errorMsg || "" },
  });
}

// 🔄 Main loop
async function mainLoop() {
  try {
    const res = await axios.post(`${SERVER_URL}/webhook`, {
      apiKey: API_KEY,
      event: "sync-request",
    });

    const invoices = res.data.invoices || [];
    console.log(`📋 Processing ${invoices.length} invoice(s)`);

    for (let invoice of invoices) {
      try {
        console.log(`🔄 Processing invoice ${invoice._id}`);
        await ensureMasterData(invoice);

        const xml = buildInvoiceXML(invoice);
        const tallyRes = await axios.post(TALLY_URL, xml, {
          headers: { "Content-Type": "application/xml" },
        });

        const invoiceError = extractLineError(tallyRes.data);
        if (invoiceError) {
          throw new Error(`Invoice creation failed: ${invoiceError}`);
        }

        console.log(`✅ Synced invoice ${invoice._id}`);
        await reportStatus(invoice._id, "success");
      } catch (err) {
        console.error(`❌ Failed to sync invoice ${invoice._id}: ${err.message}`);
        await reportStatus(invoice._id, "error", err.message);
      }
    }
  } catch (err) {
    console.error("❌ Agent loop error:", err.message);
  }
}

// 🕒 Run every minute
setInterval(mainLoop, 60 * 1000);
mainLoop(); // Run immediately on start

function buildInvoiceXML(invoice) {
  const dateStr = invoice.invoice_date.split("T")[0].replace(/-/g, "");

  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("ENVELOPE")
      .ele("HEADER").ele("TALLYREQUEST").txt("Import Data").up().up()
      .ele("BODY").ele("IMPORTDATA")
        .ele("REQUESTDATA")
          .ele("TALLYMESSAGE").att("xmlns:UDF", "TallyUDF")
            .ele("VOUCHER")
              .att("VCHTYPE", "Sales")
              .att("ACTION", "Create")
              .ele("DATE").txt(dateStr).up()
              .ele("PARTYNAME").txt(invoice.customer.name).up()
              .ele("VOUCHERTYPENAME").txt("Sales").up()
              .ele("PARTYLEDGERNAME").txt(invoice.customer.name).up()
              .ele("PERSISTEDVIEW").txt("Invoice Voucher View").up()
              .ele("FBTPAYMENTTYPE").txt("Default").up();

  for (let item of invoice.items) {
    root
      .ele("ALLINVENTORYENTRIES.LIST")
        .ele("STOCKITEMNAME").txt(item.title).up()
        .ele("RATE").txt(`${item.rate} / PIECES`).up() // Changed from NOS to PIECES
        .ele("AMOUNT").txt(`-${item.total}`).up()
        .ele("ACTUALQTY").txt(`${item.quantity} PIECES`).up() // Changed from NOS to PIECES
        .ele("BILLEDQTY").txt(`${item.quantity} PIECES`).up() // Changed from NOS to PIECES
        .ele("ISDEEMEDPOSITIVE").txt("No").up()
        .up();
  }

  root
    .ele("LEDGERENTRIES.LIST")
      .ele("LEDGERNAME").txt(invoice.customer.name).up()
      .ele("AMOUNT").txt(`${invoice.total}`).up()
      .ele("ISDEEMEDPOSITIVE").txt("Yes").up()
    .up();

  return root.end({ prettyPrint: true });
}

// 🔧 NOTE: you still need your existing buildInvoiceXML() function here.