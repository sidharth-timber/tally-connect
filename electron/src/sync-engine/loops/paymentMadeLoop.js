const axios = require('axios');
const { extractLineError } = require('../tally/tallyClient');
const { buildPaymentVoucherXML } = require('../tally/xmlBuilders');
const { fetchTallyPaymentNumber } = require('../tally/voucherLookup');
const { reportSyncStatus } = require('../reporting');
const { ensureCashLedger } = require('./paymentLoop');

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
      for (const p of payments) {
        try {
          await ensureCashLedger(tallyUrl);
          const xml = buildPaymentVoucherXML(p);
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
          const paymentNumber = await fetchTallyPaymentNumber(dateStr, p.vendor_name, p.amount, tallyUrl);
          await reportSyncStatus(auth, 'payment-made-sync-status', company_id, { paymentMadeId: p.id, status: 'success', error: '', paymentNumber });
          succeeded++;
        } catch (err) {
          console.error(`❌ Vendor payment ${p.id} failed:`, err.message);
          await reportSyncStatus(auth, 'payment-made-sync-status', company_id, { paymentMadeId: p.id, status: 'error', error: err.message, paymentNumber: null });
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
