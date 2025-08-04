require("dotenv").config();
const axios = require("axios");
const { create } = require("xmlbuilder2");

const API_KEY = process.env.API_KEY;
const SERVER_URL = process.env.SERVER_URL;
const TALLY_URL = "http://localhost:9000"; // Tally must have HTTP server enabled

async function fetchPendingInvoices() {
  const res = await axios.get(`${SERVER_URL}/invoices/pending`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  return res.data.invoices || [];
}

function buildTallyXML(invoice) {
  // very basic example - needs expansion
  const xml = create({ version: "1.0", encoding: "UTF-8" })
    .ele("ENVELOPE")
    .ele("HEADER")
    .ele("TALLYREQUEST")
    .txt("Import Data")
    .up()
    .up()
    .ele("BODY")
    .ele("IMPORTDATA")
    .ele("REQUESTDATA")
    .ele("TALLYMESSAGE")
    .att("xmlns:UDF", "TallyUDF")
    .ele("VOUCHER")
    .att("VCHTYPE", "Sales")
    .ele("DATE")
    .txt(invoice.date)
    .up()
    .ele("PARTYNAME")
    .txt(invoice.customer)
    .up()
    // add more fields here
    .end({ prettyPrint: true });

  return xml;
}

async function sendToTally(xml) {
  return await axios.post(`${TALLY_URL}`, xml, {
    headers: { "Content-Type": "application/xml" },
  });
}

async function mainLoop() {
  try {
    const invoices = await fetchPendingInvoices();
    for (let invoice of invoices) {
      const xml = buildTallyXML(invoice);
      const tallyRes = await sendToTally(xml);
      if (tallyRes.data.includes("REJECTED")) {
        console.error("Tally rejected invoice:", invoice.id);
      } else {
        // update sync status
        await axios.post(
          `${SERVER_URL}/invoices/${invoice.id}/sync-success`,
          {},
          { headers: { Authorization: `Bearer ${API_KEY}` } }
        );
      }
    }
  } catch (err) {
    console.error("Agent error:", err.message);
  }
}

setInterval(mainLoop, 60 * 1000); // every 1 min
