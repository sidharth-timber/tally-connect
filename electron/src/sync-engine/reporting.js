const axios = require('axios');
const logger = require('./logger');

// Generic replacement for agent.js's five near-identical reportXxxStatus functions.
// `auth` is { serverUrl, caKey } or { serverUrl, apiKey }.
const LABELS = {
  'sync-status': 'Invoice', 'payment-sync-status': 'Receipt', 'bill-sync-status': 'Bill',
  'payment-made-sync-status': 'Payment', 'expense-sync-status': 'Expense', 'journal-sync-status': 'Journal',
  'credit-note-sync-status': 'Credit note', 'debit-note-sync-status': 'Debit note',
  'tally-reconcile-status': 'Removed voucher',
};

// One line per document the agent finishes with, so the Logs view reads as a running account of
// what was pushed: success lines come from here, failures are logged (with the reason) by the
// loops themselves.
function describeAck(event, data) {
  const label = LABELS[event];
  if (!label || !data || data.status !== 'success') return null;
  const idKey = Object.keys(data).find(k => /Id$/.test(k) || k === 'link_id');
  const number = data.tallyVoucherNumber || data.receiptNumber || data.paymentNumber;
  return '✅ ' + label + (idKey ? ' #' + data[idKey] : '') + (number ? ' → Tally voucher ' + number : '') + (event === 'tally-reconcile-status' ? ' deleted from Tally' : ' synced');
}

async function reportSyncStatus(auth, event, companyId, data) {
  const ack = describeAck(event, data);
  if (ack) logger.log(ack);
  try {
    await axios.post(`${auth.serverUrl}/webhook`, {
      ...(auth.caKey ? { caKey: auth.caKey } : { apiKey: auth.apiKey }),
      company_id: companyId,
      event,
      data,
    });
  } catch (err) {
    logger.error(`❌ Failed to report ${event}:`, err.message);
  }
}

module.exports = { reportSyncStatus };
