const axios = require('axios');
const logger = require('../logger');
const { describeError } = require('../tally/errors');
const { tallyHttp } = require('../tally/tallyClient');
const {
  parseVouchers, parseReceipts, parsePurchases, parsePayments,
  parseCreditNotes, parseDebitNotes,
} = require('../tally/dayBookParser');

// ---------------------------------------------------------------------------------------------
// Reading Tally history without ever asking Tally for "everything".
//
// A voucher export is heavy (~50 KB of XML per voucher), so a year of data is far too much for one
// request: it times out, or stalls Tally's single-threaded XML server. The pull therefore
//   * remembers how far it has got per company (a cursor: "everything up to this date is in"),
//   * back-fills from the start of the financial year the first time, then only reads what is new
//     (plus a few days of overlap, for back-dated entries — duplicates are filtered by number),
//   * reads one small date window at a time, halving it when a reply is big or slow and growing it
//     again when replies are small, and processes + saves progress after every window,
//   * stops after a time budget and carries on from the cursor on the next sync.
// ---------------------------------------------------------------------------------------------
const START_DAYS = 7;
const MIN_DAYS = 1;
const MAX_DAYS = 31;
const OVERLAP_DAYS = 3;
const BIG_REPLY_BYTES = 3 * 1024 * 1024;
const SMALL_REPLY_BYTES = 400 * 1024;
const CHUNK_TIMEOUT_MS = 120 * 1000;
const DEFAULT_BUDGET_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Used when the app doesn't supply a persistent store (tests, CLI): progress then lasts for the
// life of the process.
const memoryCursors = new Map();
const memoryCursorStore = {
  get: id => memoryCursors.get(String(id)) || null,
  set: (id, ymd) => memoryCursors.set(String(id), ymd),
};

const ymd = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
const fromYmd = s => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Timber's financial year runs April–March.
function financialYearStart(today) {
  const year = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return new Date(year, 3, 1);
}

// A voucher collection filtered inside Tally, not the Day Book / Voucher Register reports: Day Book
// exports only Tally's *current date* and Voucher Register's range depends on the screen Tally is
// showing, so both silently returned the wrong vouchers. The date test is plain arithmetic on the
// voucher's year/month/day (YYYYMMDD) — comparing against date literals makes Tally's educational
// edition reject any date it doesn't allow and return nothing.
function buildFetchXML(from, to) {
  const ymdOfVoucher = '$$YearOfDate:$Date * 10000 + $$MonthOfDate:$Date * 100 + $$DayOfDate:$Date';
  return `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TimberPullVouchers</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="TimberPullVouchers" ISMODIFY="No">
        <TYPE>Voucher</TYPE>
        <FILTERS>TimberPullFrom, TimberPullTo</FILTERS>
        <NATIVEMETHOD>*</NATIVEMETHOD>
        <FETCH>LedgerEntries.*, AllLedgerEntries.*, AllInventoryEntries.*</FETCH>
      </COLLECTION>
      <SYSTEM TYPE="Formulae" NAME="TimberPullFrom">${ymdOfVoucher} >= ${from}</SYSTEM>
      <SYSTEM TYPE="Formulae" NAME="TimberPullTo">${ymdOfVoucher} &lt;= ${to}</SYSTEM>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`;
}

// A backend that answered "no" is a business outcome (already imported, parent not found) and the
// window is still done. No answer at all, or a server error, means the window must be retried, so
// the cursor must not move past it.
const isHardFailure = e => !e.response || e.response.status >= 500;

// Parses one window's XML and hands every voucher to the backend.
async function importWindow(xml, { serverUrl, authPayload, companyId }) {
  const result = { seen: 0, imported: 0, hardFailures: 0 };
  const send = async (event, data, label) => {
    result.seen++;
    try {
      const r = await axios.post(`${serverUrl}/webhook`, { ...authPayload, company_id: companyId, event, data });
      if (r.data.imported) result.imported++;
    } catch (e) {
      if (isHardFailure(e)) result.hardFailures++;
      logger.error(`[pull] ${label} failed: ${e.response?.data?.error || describeError(e)}`);
    }
  };

  for (const v of parseVouchers(xml)) await send('tally-import', v, v.voucher_number);
  for (const p of parsePurchases(xml)) await send('tally-purchase', p, `purchase ${p.voucher_number}`);
  for (const p of parsePayments(xml)) await send('tally-payment', p, `payment ${p.payment_number}`);
  for (const r of parseReceipts(xml)) await send('tally-receipt', r, `receipt ${r.receipt_number}`);
  for (const n of parseCreditNotes(xml)) await send('tally-credit-note', n, `credit note ${n.voucher_number}`);
  for (const n of parseDebitNotes(xml)) await send('tally-debit-note', n, `debit note ${n.voucher_number}`);
  return result;
}

// Pulls new Tally vouchers for one company and pushes them to the backend.
async function pullOnce({
  serverUrl, caKey, apiKey, companyId, credentialId, tallyUrl,
  cursorStore = memoryCursorStore, budgetMs = DEFAULT_BUDGET_MS, now = new Date(),
}) {
  const authPayload = caKey ? { caKey } : { apiKey };
  const startedAt = Date.now();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fyStart = financialYearStart(today);

  let synced_count = 0;
  let pull_error = null;
  let days = START_DAYS;

  try {
    const cursor = cursorStore.get(companyId);
    let from = cursor ? addDays(fromYmd(cursor), 1 - OVERLAP_DAYS) : fyStart;
    if (from < fyStart) from = fyStart;
    if (!cursor) logger.log(`[pull] first pull for this company — reading Tally history from ${ymd(fyStart)} in small steps`);

    const firstFrom = from;
    const totalDays = Math.max(1, Math.round((today - from) / DAY_MS) + 1);

    while (from <= today) {
      if (Date.now() - startedAt > budgetMs) {
        const left = Math.max(1, Math.round((today - from) / DAY_MS) + 1);
        logger.log(`[pull] paused at ${ymd(from)} — ${left} day(s) of Tally history still to read; click Sync again to continue`);
        break;
      }

      const to = new Date(Math.min(addDays(from, days - 1).getTime(), today.getTime()));
      if (totalDays > MAX_DAYS) {
        const pct = Math.min(100, Math.round(((from - firstFrom) / DAY_MS / totalDays) * 100));
        logger.log(`[pull] reading ${ymd(from)} → ${ymd(to)} (${pct}%)`);
      }

      let xml;
      try {
        const res = await tallyHttp.post(tallyUrl, buildFetchXML(ymd(from), ymd(to)), {
          headers: { 'Content-Type': 'application/xml' },
          timeout: CHUNK_TIMEOUT_MS,
        });
        xml = String(res.data);
        if (xml.includes('Unknown Request')) throw new Error('Tally rejected the voucher export (Unknown Request) — check that a company is open in Tally Prime');
      } catch (e) {
        // A window too big for Tally to answer in time: try half as much; at one day there is
        // nothing smaller to try, so surface the error and stop here.
        if (days > MIN_DAYS && /timeout|ECONNABORTED/i.test(`${e.code} ${e.message}`)) {
          days = Math.max(MIN_DAYS, Math.floor(days / 2));
          logger.warn(`[pull] Tally was too slow for that window — retrying with ${days} day(s) at a time`);
          continue;
        }
        throw e;
      }

      const r = await importWindow(xml, { serverUrl, authPayload, companyId });
      synced_count += r.imported;
      if (r.seen) logger.log(`[pull] ${ymd(from)} → ${ymd(to)}: ${r.seen} voucher(s), ${r.imported} new`);

      if (r.hardFailures > 0) {
        pull_error = `Could not reach Timber while importing ${r.hardFailures} voucher(s) dated ${ymd(from)} → ${ymd(to)}; they will be retried on the next sync`;
        break;
      }

      cursorStore.set(companyId, ymd(to));

      // Size the next window from this reply: big → smaller, tiny → larger.
      if (xml.length > BIG_REPLY_BYTES && days > MIN_DAYS) days = Math.max(MIN_DAYS, Math.floor(days / 2));
      else if (xml.length < SMALL_REPLY_BYTES && days < MAX_DAYS) days = Math.min(MAX_DAYS, days * 2);

      from = addDays(to, 1);
    }
  } catch (e) {
    pull_error = describeError(e);
    logger.error('[pull] loop error: ' + pull_error);
  }

  if (caKey && credentialId) {
    try {
      await axios.post(`${serverUrl}/webhook`, {
        caKey, company_id: companyId, event: 'sync-complete',
        data: {
          credential_id: credentialId,
          synced_records: synced_count,
          status: pull_error ? 'error' : 'success',
          error_message: pull_error || null,
        },
      });
    } catch (e) {
      logger.error('[pull] sync-complete report failed:', e.response?.data?.error || e.message);
    }
  }

  return { synced_count, error: pull_error };
}

// Pulls new vouchers for every company.
async function pullLoop({ companies, serverUrl, caKey, apiKey, tallyUrl, cursorStore, budgetMs }) {
  const results = [];
  for (const company of companies) {
    const { synced_count, error } = await pullOnce({
      serverUrl, caKey, apiKey, tallyUrl, cursorStore, budgetMs,
      companyId: company.company_id,
      credentialId: company.credential_id,
    });
    results.push({ company_id: company.company_id, succeeded: synced_count, failed: 0, error });
  }
  return results;
}

module.exports = { pullLoop, pullOnce, financialYearStart };
