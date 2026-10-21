const axios = require('axios');
const { describeError } = require('../tally/errors');
const { VCH_TYPE, deleteVoucherById } = require('../tally/deleteVoucher');
const { reportSyncStatus } = require('../reporting');
const logger = require('../logger');

// Removes from Tally the vouchers of documents that were edited, cancelled or deleted in Timber
// since they were pushed. Runs BEFORE the push loops: an edited document then has no voucher left
// and is re-pushed by the normal loops in the same sync; a cancelled one simply stays gone.
async function reconcileLoop({ companies, serverUrl, caKey, apiKey, tallyUrl }) {
  const results = [];
  for (const company of companies) {
    const { company_id } = company;
    const auth = { serverUrl, caKey, apiKey };
    let succeeded = 0, failed = 0, loopError = null;
    try {
      const res = await axios.post(serverUrl + '/webhook', {
        ...(caKey ? { caKey } : { apiKey }),
        company_id,
        event: 'tally-reconcile-request',
      });
      for (const d of res.data.deletions || []) {
        try {
          const { deleted, alreadyGone, lineError } = await deleteVoucherById(tallyUrl, d.master_id, VCH_TYPE[d.doc_type] || '', d.voucher_date);
          if (!deleted && !alreadyGone) {
            throw new Error('Tally did not delete ' + (VCH_TYPE[d.doc_type] || d.doc_type) + ' voucher ' + (d.voucher_number || d.master_id) + (lineError ? ': ' + lineError : ''));
          }
          logger.log('🗑️ Removed ' + (VCH_TYPE[d.doc_type] || d.doc_type) + ' ' + (d.voucher_number || d.master_id) + ' from Tally (' + d.reason + ')');
          await reportSyncStatus(auth, 'tally-reconcile-status', company_id, { link_id: d.link_id, status: 'success', error: '' });
          succeeded++;
        } catch (err) {
          logger.error('❌ Could not remove voucher for ' + d.doc_type + ' ' + d.doc_id + ': ' + describeError(err));
          await reportSyncStatus(auth, 'tally-reconcile-status', company_id, { link_id: d.link_id, status: 'error', error: describeError(err) });
          failed++;
        }
      }
    } catch (err) {
      loopError = describeError(err);
      logger.error('❌ Reconcile loop [' + company_id + '] error: ' + loopError);
    }
    results.push({ company_id, succeeded, failed, error: loopError });
  }
  return results;
}

module.exports = { reconcileLoop };
