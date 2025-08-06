require("dotenv").config();
const fs = require("fs");

const axios = require("axios");
const { create } = require("xmlbuilder2");

const SERVER_URL = process.env.SERVER_URL;
const API_KEY = process.env.API_KEY;
fs.appendFileSync("C:\\TallyAgent-run-log.txt", `${SERVER_URL} agent.js started at ${new Date()}\n`);
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

// 🧱 Helper to build item XML with PIECES as unit
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
                .ele("PARENT").txt("Primary").up()
                .ele("BASEUNITS").txt("PIECES").up()
                .ele("ISSTOCKITEM").txt("Yes").up()
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

  // 3️⃣ Create or ensure customer ledger
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

  // 4️⃣ Create or ensure each item
  for (let item of invoice.items) {
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
  try {
    await axios.post(`${SERVER_URL}/webhook`, {
      apiKey: API_KEY,
      event: "sync-status",
      data:{invoiceId,
      status,
      error: errorMsg || "",}
    });
  } catch (err) {
    console.error("❌ Failed to report status:", err.message);
  }
}

// 🏗️ Build invoice XML with proper structure
function buildInvoiceXML(invoice) {
  const dateStr = invoice.invoice_date.split("T")[0].replace(/-/g, "");
  const customerName = invoice.customer?.name || invoice.customerName || "Unknown Customer";

  // Calculate total from items if not provided
  let calculatedTotal = 0;
  for (const item of invoice.items) {
    const quantity = item.quantity || 1;
    const rate = item.unit_price || item.price || item.rate || 0;
    calculatedTotal += quantity * rate;
  }
  const totalAmount = invoice.total || calculatedTotal;

  const xml = create({ version: "1.0" })
    .ele("ENVELOPE")
      .ele("HEADER")
        .ele("TALLYREQUEST").txt("Import Data").up()
      .up()
      .ele("BODY")
        .ele("IMPORTDATA")
          .ele("REQUESTDESC")
            .ele("REPORTNAME").txt("Vouchers").up()
          .up()
          .ele("REQUESTDATA")
            .ele("TALLYMESSAGE", { xmlns: "TallyUDF" })
              .ele("VOUCHER", {
                VCHTYPE: "Sales",
                ACTION: "Create",
                OBJVIEW: "Invoice Voucher View"
              })
                .ele("DATE").txt(dateStr).up()
                .ele("NARRATION").txt(invoice.notes || "Sales Invoice").up()
                .ele("VOUCHERTYPENAME").txt("Sales").up()
                .ele("PARTYLEDGERNAME").txt(customerName).up()
                .ele("PERSISTEDVIEW").txt("Invoice Voucher View").up()
                .ele("VCHENTRYMODE").txt("Item Invoice").up()
                
                // Customer Ledger Entry (Debit)
                .ele("LEDGERENTRIES.LIST")
                  .ele("LEDGERNAME").txt(customerName).up()
                  .ele("ISDEEMEDPOSITIVE").txt("Yes").up()
                  .ele("AMOUNT").txt(totalAmount.toString()).up()
                .up()
                
                // Sales Account Ledger Entry (Credit)
                .ele("LEDGERENTRIES.LIST")
                  .ele("LEDGERNAME").txt("Sales Account").up()
                  .ele("ISDEEMEDPOSITIVE").txt("No").up()
                  .ele("AMOUNT").txt("-" + totalAmount.toString()).up();

  // Get the current voucher element to add inventory entries
  const currentVoucher = xml.last();

  // Add inventory entries for each item
  for (const item of invoice.items) {
    const quantity = item.quantity || 1;
    const rate = item.unit_price || item.price || item.rate || 0;
    const amount = quantity * rate;
    const itemName = item.title || item.name || "Unknown Item";

    currentVoucher
      .ele("INVENTORYENTRIES.LIST")
        .ele("STOCKITEMNAME").txt(itemName).up()
        .ele("ISDEEMEDPOSITIVE").txt("No").up()
        .ele("RATE").txt(rate.toString()).up()
        .ele("AMOUNT").txt("-" + amount.toString()).up()
        .ele("ACTUALQTY").txt(`${quantity} PIECES`).up()
        .ele("BILLEDQTY").txt(`${quantity} PIECES`).up()
      .up();
  }

  return xml.end({ prettyPrint: true });
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
        console.log("🔧 Creating invoice XML:", xml);
        
        const tallyRes = await axios.post(TALLY_URL, xml, {
          headers: { "Content-Type": "application/xml" },
        });

        console.log("📥 Invoice response:", tallyRes.data);
        require("fs").writeFileSync("invoice.xml", xml);

        const invoiceError = extractLineError(tallyRes.data);
        if (invoiceError) {
          throw new Error(`Invoice creation failed: ${invoiceError}`);
        }

        // Check for exceptions
        const responseText = tallyRes.data;
        const exceptionsMatch = responseText.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
        const exceptions = exceptionsMatch ? parseInt(exceptionsMatch[1]) : 0;
        
        if (exceptions > 0) {
          console.log("⚠️ Invoice created with exceptions. Response:", responseText);
          const errorMatch = responseText.match(/<e>(.*?)<\/ERROR>/);
          const exceptionMatch = responseText.match(/<EXCEPTION>(.*?)<\/EXCEPTION>/);
          
          if (errorMatch || exceptionMatch) {
            throw new Error(`Invoice creation had exceptions: ${errorMatch?.[1] || exceptionMatch?.[1]}`);
          } else {
            console.log("⚠️ Invoice created but with unknown exceptions");
          }
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