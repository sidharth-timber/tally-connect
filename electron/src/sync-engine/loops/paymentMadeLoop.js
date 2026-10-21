const axios = require('axios');
const { pendingData, noteFailed } = require('../batch');
const logger = require('../logger');
const { describeError } = require('../tally/errors');
const { extractLineError, extractVoucherId, tallyHttp, assertImported } = require('../tally/tallyClient');
const { rollbackVoucher } = require('../tally/deleteVoucher');
const { buildPaymentVoucherXML } = require('../tally/xmlBuilders');
const { fetchTallyPaymentNumber, fetchTallyVoucherNumberById } = require('../tally/voucherLookup');
const { reportSyncStatus } = require('../reporting');
const { ensureCashLedger, ensureCustomLedger } = require('./paymentLoop');

// Syncs pending vendor payments (payments made) for every company.
async function paymentMadeLoop({ companies, serverUrl, caKey, apiKey, tallyUrl, batch }) {
  const results = [];
  for (const company of companies) {
    const { company_id } = company;
    const auth = { serverUrl, caKey, apiKey };
    let succeeded = 0, failed = 0, loopError = null;
    try {
      const res = await axios.post(`${serverUrl}/webhook`, {
        ...(caKey ? { caKey } : { apiKey }),
        company_id,
        event: 'payment-made-sync-request',
        data: pendingData(batch, company_id, 'payment-made-sync-request')
      });
      const payments = res.data.payments || [];
      const ledgerNames = res.data.ledger_names || {};
      for (const p of payments) {
        // handled for the rest of this sync whatever the outcome, so a lost acknowledgement can't get it re-sent
        noteFailed(batch, company_id, 'payment-made-sync-request', p.id);
        try {
          await ensureCashLedger(tallyUrl, ledgerNames);
          await ensureCustomLedger(tallyUrl, p.account_create_name, p.account_create_parent, 'Bank Accounts');
          if (p.tds_amount > 0 && !ledgerNames.tds_payable) {
            await ensureCustomLedger(tallyUrl, 'TDS Payable', null, 'Duties & Taxes');
          }
          const xml = buildPaymentVoucherXML(p, ledgerNames);
          const tallyRes = await tallyHttp.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });
          if (tallyRes.data.includes('Unknown Request')) throw new Error('Tally rejected: Unknown Request');
          const lineError = extractLineError(tallyRes.data);
          if (lineError) throw new Error(`Payment creation failed: ${lineError}`);
          const exceptionsMatch = tallyRes.data.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          if (exceptionsMatch && parseInt(exceptionsMatch[1]) > 0) {
            const detail = (tallyRes.data.match(/<ERROR>(.*?)<\/ERROR>/i) || [])[1] || 'no detail';
            throw new Error(`Payment had exceptions: ${detail}`);
          }
          assertImported(tallyRes.data, 'Payment');
          const rawDate = p.date || new Date().toISOString();
          const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
            .split('T')[0].replace(/-/g, '');
          const paymentNumber = await fetchTallyVoucherNumberById(dateStr, extractVoucherId(tallyRes.data), tallyUrl)
            || await fetchTallyPaymentNumber(dateStr, p.vendor_name, p.amount, tallyUrl);
          if (!paymentNumber) { await rollbackVoucher(tallyUrl, extractVoucherId(tallyRes.data), 'Payment', dateStr); throw new Error('Payment: Tally accepted the voucher but it cannot be found in Tally afterwards — check the open company and period, then sync again'); }
          await reportSyncStatus(auth, 'payment-made-sync-status', company_id, { paymentMadeId: p.id, status: 'success', error: '', tallyMasterId: extractVoucherId(tallyRes.data), voucherDate: dateStr, paymentNumber });
          succeeded++;
        } catch (err) {
          logger.error(`❌ Vendor payment ${p.id} failed:`, err.message);
          await reportSyncStatus(auth, 'payment-made-sync-status', company_id, { paymentMadeId: p.id, status: 'error', error: describeError(err), paymentNumber: null });
          noteFailed(batch, company_id, 'payment-made-sync-request', p.id);
          failed++;
        }
      }
    } catch (err) {
      loopError = err.response?.data?.message || err.message;
      logger.error(`❌ Payment-made loop [${company_id}] error:`, loopError);
    }
    results.push({ company_id, succeeded, failed, error: loopError });
  }
  return results;
}

module.exports = { paymentMadeLoop };
