const axios = require('axios');
const { describeError } = require('../tally/errors');
const { extractLineError, extractVoucherId } = require('../tally/tallyClient');
const { buildPaymentVoucherXML } = require('../tally/xmlBuilders');
const { fetchTallyPaymentNumber, fetchTallyVoucherNumberById } = require('../tally/voucherLookup');
const { reportSyncStatus } = require('../reporting');
const { ensureCashLedger, ensureCustomLedger } = require('./paymentLoop');

// Syncs pending vendor payments (payments made) for every company.
async function paymentMadeLoop({ companies, serverUrl, caKey, apiKey, tallyUrl }) {
  const results = [];
  for (const company of companies) {
    const { company_id } = company;
    const auth = { serverUrl, caKey, apiKey };
    let succeeded = 0, failed = 0, loopError = null;
    try {
      const res = await axios.post(`${serverUrl}/webhook`, {
        ...(caKey ? { caKey } : { apiKey }),
        company_id,
        event: 'payment-made-sync-request'
      });
      const payments = res.data.payments || [];
      const ledgerNames = res.data.ledger_names || {};
      for (const p of payments) {
        try {
          await ensureCashLedger(tallyUrl, ledgerNames);
          await ensureCustomLedger(tallyUrl, p.account_create_name, p.account_create_parent, 'Bank Accounts');
          if (p.tds_amount > 0 && !ledgerNames.tds_payable) {
            await ensureCustomLedger(tallyUrl, 'TDS Payable', null, 'Duties & Taxes');
          }
          const xml = buildPaymentVoucherXML(p, ledgerNames);
          const tallyRes = await axios.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });
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
          const paymentNumber = await fetchTallyVoucherNumberById(dateStr, extractVoucherId(tallyRes.data), tallyUrl)
            || await fetchTallyPaymentNumber(dateStr, p.vendor_name, p.amount, tallyUrl);
          await reportSyncStatus(auth, 'payment-made-sync-status', company_id, { paymentMadeId: p.id, status: 'success', error: '', paymentNumber });
          succeeded++;
        } catch (err) {
          console.error(`❌ Vendor payment ${p.id} failed:`, err.message);
          await reportSyncStatus(auth, 'payment-made-sync-status', company_id, { paymentMadeId: p.id, status: 'error', error: describeError(err), paymentNumber: null });
          failed++;
        }
      }
    } catch (err) {
      loopError = err.response?.data?.message || err.message;
      console.error(`❌ Payment-made loop [${company_id}] error:`, loopError);
    }
    results.push({ company_id, succeeded, failed, error: loopError });
  }
  return results;
}

module.exports = { paymentMadeLoop };
