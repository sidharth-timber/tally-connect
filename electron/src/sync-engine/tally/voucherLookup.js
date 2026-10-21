const axios = require('axios');
const logger = require('../logger');
const { DEFAULT_TALLY_URL, tallyHttp } = require('./tallyClient');

// Voucher Register, not Day Book: Day Book ignores SVFROMDATE/SVTODATE and exports only Tally's
// *current date* (which moves to the last voucher entered), so lookups silently missed every
// voucher dated otherwise. Voucher Register honours the requested range.
function dayBookRangeXML(dateStr) {
  return `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>Voucher Register</REPORTNAME>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <SVFROMDATE>${dateStr}</SVFROMDATE>
      <SVTODATE>${dateStr}</SVTODATE>
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;
}

// Tally often records the cash/bank ledger (not the customer/vendor) as the
// PARTYLEDGERNAME of Receipt and Payment vouchers, so the party is matched
// against every ledger entry on the voucher as well.
function ledgerNamesOf(body) {
  return [...body.matchAll(/<LEDGERNAME>(.*?)<\/LEDGERNAME>/g)].map(m => m[1].trim().toLowerCase());
}

function partyMatches(body, get, partyName) {
  const want = String(partyName || '').trim().toLowerCase();
  if (!want) return false;
  const name = (get('PARTYNAME') || get('PARTYLEDGERNAME')).toLowerCase();
  return name === want || ledgerNamesOf(body).includes(want);
}

function anyEntryAmountMatches(body, amounts) {
  const wanted = [].concat(amounts).filter(a => typeof a === 'number' && !Number.isNaN(a));
  return [...body.matchAll(/<AMOUNT>(.*?)<\/AMOUNT>/g)].some(([, raw]) => {
    const amt = Math.abs(parseFloat(raw));
    return !Number.isNaN(amt) && wanted.some(w => Math.abs(amt - w) <= 1);
  });
}

function unescapeXml(str) {
  return String(str || '').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

async function fetchTallyVoucherNumber(dateStr, partyName, total, tallyUrl = DEFAULT_TALLY_URL) {
  try {
    const res = await tallyHttp.post(tallyUrl, dayBookRangeXML(dateStr), {
      headers: { 'Content-Type': 'application/xml' },
      timeout: 10000
    });

    const blocks = [...res.data.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
      .filter(([, body]) => /<VOUCHERTYPENAME>\s*Sales\s*<\/VOUCHERTYPENAME>/i.test(body));

    for (const [, body] of blocks) {
      const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
      const name = get('PARTYNAME') || get('PARTYLEDGERNAME');
      if (name.toLowerCase() !== partyName.toLowerCase()) continue;

      const partyEntry = [...body.matchAll(/<LEDGERENTRIES\.LIST>([\s\S]*?)<\/LEDGERENTRIES\.LIST>/g)]
        .find(([, b]) => /<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER>/i.test(b));
      if (partyEntry) {
        const amtMatch = partyEntry[1].match(/<AMOUNT>(.*?)<\/AMOUNT>/);
        const tallyTotal = amtMatch ? Math.abs(parseFloat(amtMatch[1])) : null;
        if (tallyTotal !== null && Math.abs(tallyTotal - total) > 1) continue;
      }

      return get('VOUCHERNUMBER');
    }
  } catch (e) {
    logger.error('[sync-engine] fetchTallyVoucherNumber error:', e.message);
  }
  return null;
}

async function fetchTallyPurchaseVoucherNumber(dateStr, vendorName, total, tallyUrl = DEFAULT_TALLY_URL) {
  try {
    const res = await tallyHttp.post(tallyUrl, dayBookRangeXML(dateStr), { headers: { 'Content-Type': 'application/xml' }, timeout: 10000 });
    const blocks = [...res.data.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
      .filter(([, body]) => /<VOUCHERTYPENAME>\s*Purchase\s*<\/VOUCHERTYPENAME>/i.test(body));
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
        return amt !== null && Math.abs(amt - total) <= 1;
      });
      if (!amountMatched) continue;
      return get('VOUCHERNUMBER');
    }
  } catch (e) {
    logger.error('[sync-engine] fetchTallyPurchaseVoucherNumber error:', e.message);
  }
  return null;
}

async function fetchTallyReceiptNumber(dateStr, partyName, amount, tallyUrl = DEFAULT_TALLY_URL) {
  try {
    const res = await tallyHttp.post(tallyUrl, dayBookRangeXML(dateStr), {
      headers: { 'Content-Type': 'application/xml' },
      timeout: 10000
    });

    const blocks = [...res.data.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
      .filter(([, body]) => /<VOUCHERTYPENAME>\s*Receipt\s*<\/VOUCHERTYPENAME>/i.test(body));

    for (const [, body] of blocks) {
      const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
      if (!partyMatches(body, get, partyName)) continue;
      if (!anyEntryAmountMatches(body, amount)) continue;
      return get('VOUCHERNUMBER');
    }
  } catch (e) {
    logger.error('[sync-engine] fetchTallyReceiptNumber error:', e.message);
  }
  return null;
}

async function fetchTallyPaymentNumber(dateStr, vendorName, amount, tallyUrl = DEFAULT_TALLY_URL) {
  try {
    const res = await tallyHttp.post(tallyUrl, dayBookRangeXML(dateStr), { headers: { 'Content-Type': 'application/xml' }, timeout: 10000 });
    const blocks = [...res.data.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
      .filter(([, body]) => /<VOUCHERTYPENAME>\s*Payment\s*<\/VOUCHERTYPENAME>/i.test(body));
    for (const [, body] of blocks) {
      const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
      if (!partyMatches(body, get, vendorName)) continue;
      if (!anyEntryAmountMatches(body, amount)) continue;
      return get('VOUCHERNUMBER');
    }
  } catch (e) {
    logger.error('[sync-engine] fetchTallyPaymentNumber error:', e.message);
  }
  return null;
}

// Shared by credit and debit notes — same scan as
// fetchTallyPurchaseVoucherNumber, parameterized on the voucher type. The
// type names contain a space, so the filter regex allows flexible whitespace.
async function fetchTallyNoteVoucherNumber(vchType, dateStr, partyName, total, tallyUrl = DEFAULT_TALLY_URL) {
  try {
    const res = await tallyHttp.post(tallyUrl, dayBookRangeXML(dateStr), { headers: { 'Content-Type': 'application/xml' }, timeout: 10000 });
    const typeRe = new RegExp(`<VOUCHERTYPENAME>\\s*${vchType.replace(/ /g, '\\s+')}\\s*</VOUCHERTYPENAME>`, 'i');
    const blocks = [...res.data.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
      .filter(([, body]) => typeRe.test(body));
    for (const [, body] of blocks) {
      const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
      const name = get('PARTYNAME') || get('PARTYLEDGERNAME');
      if (name.toLowerCase() !== partyName.toLowerCase()) continue;
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
    logger.error(`[sync-engine] fetchTallyNoteVoucherNumber(${vchType}) error:`, e.message);
  }
  return null;
}

// `amounts` may list several candidates (gross total and net-of-TDS bank
// amount). With `narration`, the voucher must carry the same narration — amount
// alone also matches unrelated Payment vouchers of equal value.
async function fetchTallyExpenseVoucherNumber(dateStr, amounts, tallyUrl = DEFAULT_TALLY_URL, narration = '') {
  try {
    const res = await tallyHttp.post(tallyUrl, dayBookRangeXML(dateStr), { headers: { 'Content-Type': 'application/xml' }, timeout: 10000 });
    const blocks = [...res.data.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
      .filter(([, body]) => /<VOUCHERTYPENAME>\s*Payment\s*<\/VOUCHERTYPENAME>/i.test(body));
    const wantNarration = String(narration || '').trim().toLowerCase();
    for (const [, body] of blocks) {
      const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
      if (wantNarration && unescapeXml(get('NARRATION')).toLowerCase() !== wantNarration) continue;
      if (anyEntryAmountMatches(body, amounts)) return get('VOUCHERNUMBER');
    }
  } catch (e) {
    logger.error('[sync-engine] fetchTallyExpenseVoucherNumber error:', e.message);
  }
  return null;
}

// Resolves the voucher number of a just-posted voucher from its master id
// (see extractVoucherId). Returns null when the id is unknown or not found, so
// callers fall back to the party/amount heuristic.
// Asks Tally for exactly one voucher, by Master ID, and gets back just its number (a couple of KB,
// ~50 ms). Scanning the whole day instead exports every voucher on that date — fine for ten, but
// with thousands of documents per day it made each sync step slower than the one before.
async function fetchVoucherNumberByMasterId(voucherId, tallyUrl) {
  const xml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TimberVoucherById</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="TimberVoucherById" ISMODIFY="No"><TYPE>Voucher</TYPE><FILTERS>TimberById</FILTERS><FETCH>VoucherNumber, VoucherTypeName, Date</FETCH></COLLECTION><SYSTEM TYPE="Formulae" NAME="TimberById">$MasterID = ${Number(voucherId)}</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
  const res = await tallyHttp.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' }, timeout: 15000 });
  const number = (String(res.data).match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/) || [])[1];
  return number ? number.trim() : null;
}

async function fetchTallyVoucherNumberById(dateStr, voucherId, tallyUrl = DEFAULT_TALLY_URL) {
  if (!voucherId) return null;
  try {
    const number = await fetchVoucherNumberByMasterId(voucherId, tallyUrl);
    if (number) return number;
  } catch (e) {
    logger.warn('[sync-engine] voucher lookup by id failed, scanning the day instead: ' + e.message);
  }
  try {
    const res = await tallyHttp.post(tallyUrl, dayBookRangeXML(dateStr), { headers: { 'Content-Type': 'application/xml' }, timeout: 10000 });
    const blocks = [...res.data.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)];
    for (const [, body] of blocks) {
      const id = (body.match(/<MASTERID>\s*(\d+)\s*<\/MASTERID>/) || [])[1];
      if (id === String(voucherId)) {
        const number = (body.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/) || [])[1];
        return number ? number.trim() : null;
      }
    }
  } catch (e) {
    logger.error('[sync-engine] fetchTallyVoucherNumberById error:', e.message);
  }
  return null;
}

module.exports = {
  fetchTallyVoucherNumberById,
  fetchTallyVoucherNumber,
  fetchTallyPurchaseVoucherNumber,
  fetchTallyReceiptNumber,
  fetchTallyPaymentNumber,
  fetchTallyNoteVoucherNumber,
  fetchTallyExpenseVoucherNumber,
};
