const axios = require('axios');
const { describeError } = require('../tally/errors');
const { extractLineError, tallyHttp } = require('../tally/tallyClient');
const { reportSyncStatus } = require('../reporting');
const logger = require('../logger');

// Voucher type each Timber document becomes in Tally (expenses post as Payment vouchers).
const VCH_TYPE = {
  invoice: 'Sales',
  payment: 'Receipt',
  bill: 'Purchase',
  payment_made: 'Payment',
  expense: 'Payment',
  journal: 'Journal',
  credit_note: 'Credit Note',
  debit_note: 'Debit Note',
};

// Deleting by Master ID removes exactly that voucher. Deleting by voucher number is not safe:
// numbers restart per voucher type and collide, and it once removed the wrong voucher.
function buildDeleteXML(masterId, vchType, date) {
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER${date ? ` DATE="${date}"` : ''} TAGNAME="Master ID" TAGVALUE="${masterId}" VCHTYPE="${vchType}" ACTION="Delete"></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

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
          const xml = buildDeleteXML(d.master_id, VCH_TYPE[d.doc_type] || '', d.voucher_date);
          const tallyRes = await tallyHttp.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });
          const deleted = Number((String(tallyRes.data).match(/<DELETED>(\d+)<\/DELETED>/) || [])[1] || 0);
          const lineError = extractLineError(String(tallyRes.data));
          // Already gone (someone deleted it in Tally) is the state we wanted.
          const alreadyGone = /not found|does not exist|no such/i.test(lineError || '');
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
