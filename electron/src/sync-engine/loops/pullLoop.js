const axios = require('axios');
const logger = require('../logger');
const { tallyHttp } = require('../tally/tallyClient');
const {
  parseVouchers, parseReceipts, parsePurchases, parsePayments,
  parseCreditNotes, parseDebitNotes,
} = require('../tally/dayBookParser');

function fmtDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// Voucher Register, not Day Book: Day Book ignores SVFROMDATE/SVTODATE and exports only Tally's
// *current date* (which moves to the last voucher entered), so lookups silently missed every
// voucher dated otherwise. Voucher Register honours the requested range.
function buildFetchXML(from, to) {
  return `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Voucher Register</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVFROMDATE>${from}</SVFROMDATE>
          <SVTODATE>${to}</SVTODATE>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

// Pulls Day Book data for one company and pushes any new vouchers to the backend.
async function pullOnce({ serverUrl, caKey, apiKey, companyId, credentialId, tallyUrl, pullDays = 30 }) {
  const authPayload = caKey ? { caKey } : { apiKey };
  let synced_count = 0;
  let pull_error = null;

  try {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - pullDays);

    const xml = buildFetchXML(fmtDate(from), fmtDate(to));
    const tallyRes = await tallyHttp.post(tallyUrl, xml, {
      headers: { 'Content-Type': 'application/xml' },
      timeout: 10000
    });

    const vouchers = parseVouchers(tallyRes.data);
    for (const v of vouchers) {
      try {
        const r = await axios.post(`${serverUrl}/webhook`, {
          ...authPayload, company_id: companyId, event: 'tally-import', data: v
        });
        if (r.data.imported) synced_count++;
      } catch (e) { logger.error(`[pull] ${v.voucher_number} failed:`, e.response?.data?.error || e.message); }
    }

    const purchases = parsePurchases(tallyRes.data);
    for (const p of purchases) {
      try {
        const r = await axios.post(`${serverUrl}/webhook`, {
          ...authPayload, company_id: companyId, event: 'tally-purchase', data: p
        });
        if (r.data.imported) synced_count++;
      } catch (e) { logger.error(`[pull] purchase ${p.voucher_number} failed:`, e.response?.data?.error || e.message); }
    }

    const vendor_payments = parsePayments(tallyRes.data);
    for (const p of vendor_payments) {
      try {
        const r = await axios.post(`${serverUrl}/webhook`, {
          ...authPayload, company_id: companyId, event: 'tally-payment', data: p
        });
        if (r.data.imported) synced_count++;
      } catch (e) { logger.error(`[pull] payment ${p.payment_number} failed:`, e.response?.data?.error || e.message); }
    }

    const receipts = parseReceipts(tallyRes.data);
    for (const r of receipts) {
      try {
        const resp = await axios.post(`${serverUrl}/webhook`, {
          ...authPayload, company_id: companyId, event: 'tally-receipt', data: r
        });
        if (resp.data.imported) synced_count++;
      } catch (e) { logger.error(`[pull] receipt ${r.receipt_number} failed:`, e.response?.data?.error || e.message); }
    }

    const creditNotes = parseCreditNotes(tallyRes.data);
    for (const n of creditNotes) {
      try {
        const resp = await axios.post(`${serverUrl}/webhook`, {
          ...authPayload, company_id: companyId, event: 'tally-credit-note', data: n
        });
        if (resp.data.imported) synced_count++;
      } catch (e) { logger.error(`[pull] credit note ${n.voucher_number} failed:`, e.response?.data?.error || e.message); }
    }

    const debitNotes = parseDebitNotes(tallyRes.data);
    for (const n of debitNotes) {
      try {
        const resp = await axios.post(`${serverUrl}/webhook`, {
          ...authPayload, company_id: companyId, event: 'tally-debit-note', data: n
        });
        if (resp.data.imported) synced_count++;
      } catch (e) { logger.error(`[pull] debit note ${n.voucher_number} failed:`, e.response?.data?.error || e.message); }
    }
  } catch (e) {
    pull_error = e.message;
    logger.error('[pull] loop error:', e.message);
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

// Pulls Day Book data for every company.
async function pullLoop({ companies, serverUrl, caKey, apiKey, tallyUrl, pullDays }) {
  const results = [];
  for (const company of companies) {
    const { synced_count, error } = await pullOnce({
      serverUrl, caKey, apiKey, tallyUrl, pullDays,
      companyId: company.company_id,
      credentialId: company.credential_id,
    });
    results.push({ company_id: company.company_id, succeeded: synced_count, failed: 0, error });
  }
  return results;
}

module.exports = { pullLoop, pullOnce };
