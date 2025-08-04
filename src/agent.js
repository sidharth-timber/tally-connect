require("dotenv").config();
const axios = require("axios");
const { create } = require("xmlbuilder2");

const SERVER_URL = process.env.SERVER_URL;
const API_KEY = process.env.API_KEY;
const TALLY_URL = "http://localhost:9000";

// 🧱 Helper to build master XML (for ledgers/items)
function buildLedgerXML(name) {
  return create({ version: "1.0", encoding: "UTF-8" })
    .ele("ENVELOPE")
      .ele("HEADER").ele("TALLYREQUEST").txt("Import Data").up().up()
      .ele("BODY").ele("IMPORTDATA").ele("REQUESTDATA")
        .ele("TALLYMESSAGE").att("xmlns:UDF", "TallyUDF")
          .ele("LEDGER").att("NAME", name).att("Action", "Create")
            .ele("NAME").txt(name).up()
            .ele("PARENT").txt("Sundry Debtors").up()
            .ele("ISBILLWISEON").txt("Yes").up()
            .ele("AFFECTSSTOCK").txt("No").up()
          .up()
        .up()
      .up()
    .end({ prettyPrint: true });
}

function buildItemXML(name) {
  return create({ version: "1.0", encoding: "UTF-8" })
    .ele("ENVELOPE")
      .ele("HEADER").ele("TALLYREQUEST").txt("Import Data").up().up()
      .ele("BODY").ele("IMPORTDATA").ele("REQUESTDATA")
        .ele("TALLYMESSAGE").att("xmlns:UDF", "TallyUDF")
          .ele("STOCKITEM").att("NAME", name).att("Action", "Create")
            .ele("NAME").txt(name).up()
            .ele("BASEUNITS").txt("Nos").up()
          .up()
        .up()
      .up()
    .end({ prettyPrint: true });
}

// 🧾 Build Tally invoice XML
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
        .ele("RATE").txt(`${item.rate} / Nos`).up()
        .ele("AMOUNT").txt(`-${item.total}`).up()
        .ele("ACTUALQTY").txt(`${item.quantity} Nos`).up()
        .ele("BILLEDQTY").txt(`${item.quantity} Nos`).up()
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

// 🔁 Try master creation before sending invoice
async function ensureMasterData(invoice) {
  const customerXML = buildLedgerXML(invoice.customer.name);
  await axios.post(TALLY_URL, customerXML, {
    headers: { "Content-Type": "application/xml" },
  });

  for (let item of invoice.items) {
    const itemXML = buildItemXML(item.title);
    await axios.post(TALLY_URL, itemXML, {
      headers: { "Content-Type": "application/xml" },
    });
  }
}

// 🔁 POST status back to server
async function reportStatus(invoiceId, status, error = null) {
  await axios.post(`${SERVER_URL}/webhook`, {
    apiKey: API_KEY,
    event: "sync-status",
    data: { invoiceId, status, error },
  });
}

// 🔄 Main loop
async function mainLoop() {
  try {
    // 📨 Step 1: Get pending invoices
    const res = await axios.post(`${SERVER_URL}/webhook`, {
      apiKey: API_KEY,
      event: "sync-request",
    });
    const invoices = res.data.invoices || [];

    for (let invoice of invoices) {
      try {
        await ensureMasterData(invoice);
        const xml = buildInvoiceXML(invoice);
        const tallyRes = await axios.post(TALLY_URL, xml, {
          headers: { "Content-Type": "application/xml" },
        });

        if (tallyRes.data.includes("REJECTED")) {
          console.error(`❌ Tally rejected invoice ${invoice._id}`);
          await reportStatus(invoice._id, "error", "Tally rejected the invoice");
        } else {
          console.log(`✅ Synced invoice ${invoice._id}`);
          await reportStatus(invoice._id, "success");
        }
      } catch (err) {
        console.error(`❌ Error processing ${invoice._id}:`, err.message);
        await reportStatus(invoice._id, "error", err.message);
      }
    }
  } catch (err) {
    console.error("❌ Agent error:", err.message);
  }
}

// ⏱ Run every minute
setInterval(mainLoop, 60 * 1000);
mainLoop(); // also run immediately on start
