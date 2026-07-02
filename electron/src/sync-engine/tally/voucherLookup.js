const axios = require('axios');
const { DEFAULT_TALLY_URL } = require('./tallyClient');

function dayBookRangeXML(dateStr) {
  return `<?xml version="1.0"?>
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
}

async function fetchTallyVoucherNumber(dateStr, partyName, total, tallyUrl = DEFAULT_TALLY_URL) {
  try {
    const res = await axios.post(tallyUrl, dayBookRangeXML(dateStr), {
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
    console.error('[sync-engine] fetchTallyVoucherNumber error:', e.message);
  }
  return null;
}

async function fetchTallyPurchaseVoucherNumber(dateStr, vendorName, total, tallyUrl = DEFAULT_TALLY_URL) {
  try {
    const res = await axios.post(tallyUrl, dayBookRangeXML(dateStr), { headers: { 'Content-Type': 'application/xml' }, timeout: 10000 });
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
    console.error('[sync-engine] fetchTallyPurchaseVoucherNumber error:', e.message);
  }
  return null;
}

async function fetchTallyReceiptNumber(dateStr, partyName, amount, tallyUrl = DEFAULT_TALLY_URL) {
  try {
    const res = await axios.post(tallyUrl, dayBookRangeXML(dateStr), {
      headers: { 'Content-Type': 'application/xml' },
      timeout: 10000
    });

    const blocks = [...res.data.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
      .filter(([, body]) => /<VOUCHERTYPENAME>\s*Receipt\s*<\/VOUCHERTYPENAME>/i.test(body));

    for (const [, body] of blocks) {
      const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
      const name = get('PARTYNAME') || get('PARTYLEDGERNAME');
      if (name.toLowerCase() !== partyName.toLowerCase()) continue;

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
    console.error('[sync-engine] fetchTallyReceiptNumber error:', e.message);
  }
  return null;
}

async function fetchTallyPaymentNumber(dateStr, vendorName, amount, tallyUrl = DEFAULT_TALLY_URL) {
  try {
    const res = await axios.post(tallyUrl, dayBookRangeXML(dateStr), { headers: { 'Content-Type': 'application/xml' }, timeout: 10000 });
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
    console.error('[sync-engine] fetchTallyPaymentNumber error:', e.message);
  }
  return null;
}

async function fetchTallyExpenseVoucherNumber(dateStr, amount, tallyUrl = DEFAULT_TALLY_URL) {
  try {
    const res = await axios.post(tallyUrl, dayBookRangeXML(dateStr), { headers: { 'Content-Type': 'application/xml' }, timeout: 10000 });
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
    console.error('[sync-engine] fetchTallyExpenseVoucherNumber error:', e.message);
  }
  return null;
}

module.exports = {
  fetchTallyVoucherNumber,
  fetchTallyPurchaseVoucherNumber,
  fetchTallyReceiptNumber,
  fetchTallyPaymentNumber,
  fetchTallyExpenseVoucherNumber,
};
