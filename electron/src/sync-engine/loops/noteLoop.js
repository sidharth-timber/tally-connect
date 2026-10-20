const axios = require('axios');
const logger = require('../logger');
const { describeError } = require('../tally/errors');
const { extractLineError, extractVoucherId, tallyHttp } = require('../tally/tallyClient');
const {
  buildUnitXML, buildStockGroupXML, buildSalesLedgerXML, buildGSTLedgerXML,
  buildLedgerXML, buildItemXML, buildCreditNoteXML, buildDebitNoteXML,
} = require('../tally/xmlBuilders');
const { fetchTallyNoteVoucherNumber, fetchTallyVoucherNumberById } = require('../tally/voucherLookup');
const { reportSyncStatus } = require('../reporting');
const { ensureCustomLedger } = require('./paymentLoop');

// Master data for a credit/debit note voucher. Both note types are
// customer-side in Timber, so this is invoiceLoop's ensureMasterData shape:
// customer ledger under Sundry Debtors and the OUTPUT GST ledgers (never the
// Input ones), plus stock items for each row. Roles already mapped to a real
// Tally ledger via the CA's COA mapping skip default-ledger creation.
async function ensureNoteMasterData(note, tallyUrl, ledgerNames = {}) {
  try {
    const res = await tallyHttp.post(tallyUrl, buildUnitXML(), { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) logger.log('⚠️ Unit PIECES:', err);
  } catch (e) { logger.log('⚠️ Unit PIECES error:', e.message); }

  try {
    const res = await tallyHttp.post(tallyUrl, buildStockGroupXML(), { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) logger.log('⚠️ Primary stock group:', err);
  } catch (e) { logger.log('⚠️ Stock group error:', e.message); }

  // Default revenue ledger only when neither the company-wide "sales" role
  // nor a per-note account substitutes for it.
  if (!ledgerNames.sales && !note.account_ledger_name && !note.account_create_name) {
    try {
      const res = await tallyHttp.post(tallyUrl, buildSalesLedgerXML(), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) logger.log('⚠️ Sales ledger:', err);
    } catch (e) { logger.log('⚠️ Sales ledger error:', e.message); }
  }

  const gstLedgers = [];
  if (note.cgst > 0 && !ledgerNames.output_cgst) gstLedgers.push({ name: 'CGST', head: 'Central Tax' });
  if (note.sgst > 0 && !ledgerNames.output_sgst) gstLedgers.push({ name: 'SGST', head: 'State Tax' });
  if (note.igst > 0 && !ledgerNames.output_igst) gstLedgers.push({ name: 'IGST', head: 'Integrated Tax' });
  if (note.cess > 0 && !ledgerNames.output_cess) gstLedgers.push({ name: 'Cess', head: 'Cess' });
  for (const gst of gstLedgers) {
    try {
      const res = await tallyHttp.post(tallyUrl, buildGSTLedgerXML(gst.name, gst.head), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) logger.log(`⚠️ ${gst.name} ledger:`, err);
    } catch (e) { logger.log(`⚠️ ${gst.name} error:`, e.message); }
  }

  const customerName = note.customer?.name || 'Unknown Customer';
  const ledgerRes = await tallyHttp.post(tallyUrl, buildLedgerXML(customerName, note.customer), { headers: { 'Content-Type': 'application/xml' } });
  const ledgerError = extractLineError(ledgerRes.data);
  if (ledgerError && !ledgerError.toLowerCase().includes('already exists')) {
    throw new Error(`Customer creation failed: ${ledgerError}`);
  }

  const itemsToCreate = (note.items || []).length > 0
    ? note.items.map(i => ({ name: i.title || 'Item', gstRate: i.gst_rate || 0, hsn: i.hsn || '' }))
    : [{ name: note.reason || note.note_number || 'Note', gstRate: 0, hsn: '' }];
  for (const item of itemsToCreate) {
    try {
      const res = await tallyHttp.post(tallyUrl, buildItemXML(item.name, item.gstRate, item.hsn), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) logger.log(`⚠️ Item "${item.name}":`, err);
    } catch (e) { logger.log(`⚠️ Item "${item.name}" error:`, e.message); }
  }
}

// Shared engine for both note types — they differ only in webhook event
// names, response/id keys, voucher type, and XML builder.
const NOTE_KINDS = {
  credit: {
    requestEvent: 'credit-note-sync-request',
    statusEvent: 'credit-note-sync-status',
    responseKey: 'credit_notes',
    idKey: 'creditNoteId',
    vchType: 'Credit Note',
    buildXML: buildCreditNoteXML,
  },
  debit: {
    requestEvent: 'debit-note-sync-request',
    statusEvent: 'debit-note-sync-status',
    responseKey: 'debit_notes',
    idKey: 'debitNoteId',
    vchType: 'Debit Note',
    buildXML: buildDebitNoteXML,
  },
};

async function runNoteLoop(kindKey, { companies, serverUrl, caKey, apiKey, tallyUrl }) {
  const kind = NOTE_KINDS[kindKey];
  const results = [];
  for (const company of companies) {
    const { company_id } = company;
    const auth = { serverUrl, caKey, apiKey };
    let succeeded = 0, failed = 0, loopError = null;
    try {
      const res = await axios.post(`${serverUrl}/webhook`, {
        ...(caKey ? { caKey } : { apiKey }),
        company_id,
        event: kind.requestEvent,
      });
      const notes = res.data[kind.responseKey] || [];
      const ledgerNames = res.data.ledger_names || {};
      for (const note of notes) {
        try {
          await ensureNoteMasterData(note, tallyUrl, ledgerNames);
          await ensureCustomLedger(tallyUrl, note.account_create_name, note.account_create_parent, 'Sales Accounts');

          const xml = kind.buildXML(note, ledgerNames);
          const tallyRes = await tallyHttp.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });
          if (tallyRes.data.includes('Unknown Request')) {
            throw new Error('Tally rejected: Unknown Request — check XML structure or ensure a company is open in Tally Prime');
          }
          const lineError = extractLineError(tallyRes.data);
          if (lineError) throw new Error(`${kind.vchType} creation failed: ${lineError}`);
          const exceptionsMatch = tallyRes.data.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          if (exceptionsMatch && parseInt(exceptionsMatch[1]) > 0) {
            const detail = (tallyRes.data.match(/<ERROR>(.*?)<\/ERROR>/i) || [])[1]
              || (tallyRes.data.match(/<EXCEPTION>(.*?)<\/EXCEPTION>/i) || [])[1]
              || (tallyRes.data.match(/<ERRLISTEX>([\s\S]*?)<\/ERRLISTEX>/i) || [])[1]?.trim()
              || 'no detail';
            throw new Error(`${kind.vchType} had exceptions: ${detail}`);
          }

          const rawDate = note.issue_date || new Date().toISOString();
          const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
            .split('T')[0].replace(/-/g, '');
          const tallyVoucherNumber = await fetchTallyVoucherNumberById(dateStr, extractVoucherId(tallyRes.data), tallyUrl)
            || await fetchTallyNoteVoucherNumber(
            kind.vchType, dateStr, note.customer?.name || '', note.total, tallyUrl
          );
          await reportSyncStatus(auth, kind.statusEvent, company_id, {
            [kind.idKey]: note.id, status: 'success', error: '', tallyVoucherNumber,
          });
          succeeded++;
        } catch (err) {
          logger.error(`❌ ${kind.vchType} ${note.id} failed:`, err.message);
          await reportSyncStatus(auth, kind.statusEvent, company_id, {
            [kind.idKey]: note.id, status: 'error', error: describeError(err), tallyVoucherNumber: null,
          });
          failed++;
        }
      }
    } catch (err) {
      loopError = err.response?.data?.message || err.response?.data?.error || err.message;
      logger.error(`❌ ${kind.vchType} loop [${company_id}] error:`, loopError);
    }
    results.push({ company_id, succeeded, failed, error: loopError });
  }
  return results;
}

const creditNoteLoop = ctx => runNoteLoop('credit', ctx);
const debitNoteLoop = ctx => runNoteLoop('debit', ctx);

module.exports = { creditNoteLoop, debitNoteLoop, ensureNoteMasterData };
