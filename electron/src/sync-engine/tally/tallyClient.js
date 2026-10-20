const axios = require('axios');

const DEFAULT_TALLY_URL = 'http://localhost:9000';

// Tally Prime's XML server answers only when its UI is idle: a modal dialog
// open in Tally (or a crash) leaves a request hanging forever, and without a
// timeout the agent sat on "Syncing…" indefinitely. Every push/export uses
// this instance so a stall becomes an error after 90 s instead.
const TALLY_TIMEOUT_MS = 90 * 1000;
const tallyHttp = axios.create({ timeout: TALLY_TIMEOUT_MS });

// 🔎 Extracts error text from Tally response XML string
function extractLineError(tallyResponse) {
  const match = tallyResponse.match(/<LINEERROR>(.*?)<\/LINEERROR>/);
  return match ? match[1] : null;
}

// Tally returns the master id of the voucher it just saved. It is the only
// reliable handle on that voucher: party + amount is ambiguous as soon as two
// documents share both.
function extractVoucherId(tallyResponse) {
  const match = String(tallyResponse).match(/<LASTVCHID>\s*(\d+)\s*<\/LASTVCHID>/);
  return match && match[1] !== '0' ? match[1] : null;
}

function dayBookXML(dateStr) {
  return `<?xml version="1.0"?><ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>${dateStr}</SVFROMDATE><SVTODATE>${dateStr}</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
}

// Day Book is the only safe exportable report in Tally Prime.
// Tally always embeds <SVCURRENTCOMPANY> in the XML response header.
// "List of Companies" doesn't exist; "Company Summary" / "COMPANY MASTER"
// trigger TDL error dialogs inside Tally Prime's UI — do not use them.
async function fetchTallyCompanies(tallyUrl = DEFAULT_TALLY_URL) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const xml = dayBookXML(today);
  try {
    const res = await axios.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' }, timeout: 5000 });
    const m = res.data.match(/<SVCURRENTCOMPANY>(.*?)<\/SVCURRENTCOMPANY>/i);
    if (m && m[1].trim()) {
      return [m[1].trim()];
    }
    return [];
  } catch (e) {
    return [];
  }
}

// Connection probe, reusing the same Day Book request fetchTallyCompanies
// already makes. Verified empirically against a live TallyPrime instance:
// the response header only ever contains REPORTNAME and SVCURRENTCOMPANY
// inside STATICVARIABLES — no version tag is present in any form. The status
// row therefore omits the "(TallyPrime - X.Y)" parenthetical entirely rather
// than showing a fabricated or stale version number; `version` is kept in
// the return shape in case a future Tally release adds one.
async function checkTallyStatus(tallyUrl = DEFAULT_TALLY_URL) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const xml = dayBookXML(today);
  try {
    const res = await axios.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' }, timeout: 5000 });
    const companyMatch = res.data.match(/<SVCURRENTCOMPANY>(.*?)<\/SVCURRENTCOMPANY>/i);
    return {
      connected: true,
      currentCompany: companyMatch ? companyMatch[1].trim() : null,
      version: null,
    };
  } catch (e) {
    return { connected: false, currentCompany: null, version: null };
  }
}

module.exports = {
  DEFAULT_TALLY_URL,
  tallyHttp,
  TALLY_TIMEOUT_MS,
  extractLineError,
  extractVoucherId,
  fetchTallyCompanies,
  checkTallyStatus,
};
