const { extractLineError, tallyHttp } = require('./tallyClient');

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

// Deleting by Master ID removes exactly that voucher (Tally ignores the type on this path).
// Deleting by voucher number is not safe: numbers restart per voucher type and collide, and it
// once removed the wrong voucher.
function buildDeleteXML(masterId, vchType, date) {
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER${date ? ` DATE="${date}"` : ''} TAGNAME="Master ID" TAGVALUE="${masterId}" VCHTYPE="${vchType}" ACTION="Delete"></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

// Returns { deleted, alreadyGone, lineError }.
async function deleteVoucherById(tallyUrl, masterId, vchType, date) {
  const res = await tallyHttp.post(tallyUrl, buildDeleteXML(masterId, vchType, date), { headers: { 'Content-Type': 'application/xml' } });
  const deleted = Number((String(res.data).match(/<DELETED>(\d+)<\/DELETED>/) || [])[1] || 0) > 0;
  const lineError = extractLineError(String(res.data));
  return { deleted, alreadyGone: /not found|does not exist|no such/i.test(lineError || ''), lineError };
}

// A voucher Tally says it created but that can't be found afterwards would be re-posted by the
// next sync (the document is marked errored), leaving a duplicate. Remove it first, best effort.
async function rollbackVoucher(tallyUrl, masterId, vchType, date) {
  if (!masterId) return;
  try { await deleteVoucherById(tallyUrl, masterId, vchType, date); } catch { /* the sync error is what matters */ }
}

module.exports = { VCH_TYPE, buildDeleteXML, deleteVoucherById, rollbackVoucher };
