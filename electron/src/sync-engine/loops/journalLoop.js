const axios = require('axios');
const { describeError } = require('../tally/errors');
const { extractLineError, extractVoucherId, tallyHttp, assertImported } = require('../tally/tallyClient');
const { rollbackVoucher } = require('../tally/deleteVoucher');
const { buildJournalXML, buildLedgerXML, buildVendorLedgerXML } = require('../tally/xmlBuilders');
const { fetchTallyVoucherNumberById } = require('../tally/voucherLookup');
const { reportSyncStatus } = require('../reporting');
const { ensureCustomLedger } = require('./paymentLoop');
const logger = require('../logger');

// Every ledger a journal line touches must exist before the voucher posts:
// customer/vendor lines post to the party's own ledger, unmapped accounts are
// created by name under their Timber group (mapped ones already exist).
async function ensureJournalMasters(journal, tallyUrl) {
  const done = new Set();
  for (const line of journal.lines || []) {
    if (line.party_kind && line.ledger_name) {
      const key = line.party_kind + ':' + line.ledger_name;
      if (done.has(key)) continue;
      done.add(key);
      const xml = line.party_kind === 'vendor' ? buildVendorLedgerXML(line.ledger_name) : buildLedgerXML(line.ledger_name);
      const res = await tallyHttp.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) {
        throw new Error('Could not create party ledger "' + line.ledger_name + '": ' + err);
      }
    } else if (!line.ledger_name && line.create_name) {
      if (done.has(line.create_name)) continue;
      done.add(line.create_name);
      await ensureCustomLedger(tallyUrl, line.create_name, line.create_parent, 'Suspense A/c');
    }
  }
}

// Syncs pending manual journal entries as Tally Journal vouchers.
async function journalLoop({ companies, serverUrl, caKey, apiKey, tallyUrl }) {
  const results = [];
  for (const company of companies) {
    const { company_id } = company;
    const auth = { serverUrl, caKey, apiKey };
    let succeeded = 0, failed = 0, loopError = null;
    try {
      const res = await axios.post(serverUrl + '/webhook', {
        ...(caKey ? { caKey } : { apiKey }),
        company_id,
        event: 'journal-sync-request',
      });
      const journals = res.data.journals || [];
      for (const journal of journals) {
        try {
          await ensureJournalMasters(journal, tallyUrl);
          const xml = buildJournalXML(journal);
          const tallyRes = await tallyHttp.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });
          if (tallyRes.data.includes('Unknown Request')) throw new Error('Tally rejected: Unknown Request');
          const lineError = extractLineError(tallyRes.data);
          if (lineError) throw new Error('Journal creation failed: ' + lineError);
          const exceptionsMatch = tallyRes.data.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          if (exceptionsMatch && parseInt(exceptionsMatch[1]) > 0) {
            const detail = (tallyRes.data.match(/<ERROR>(.*?)<\/ERROR>/i) || [])[1] || 'no detail';
            throw new Error('Journal had exceptions: ' + detail);
          }
          assertImported(tallyRes.data, 'Journal');
          const rawDate = journal.date || new Date().toISOString();
          const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
            .split('T')[0].replace(/-/g, '');
          const tallyVoucherNumber = await fetchTallyVoucherNumberById(dateStr, extractVoucherId(tallyRes.data), tallyUrl);
          if (!tallyVoucherNumber) { await rollbackVoucher(tallyUrl, extractVoucherId(tallyRes.data), 'Journal', dateStr); throw new Error('Journal: Tally accepted the voucher but it cannot be found in Tally afterwards — check the open company and period, then sync again'); }
          await reportSyncStatus(auth, 'journal-sync-status', company_id, { journalId: journal.id, status: 'success', error: '', tallyMasterId: extractVoucherId(tallyRes.data), voucherDate: dateStr, tallyVoucherNumber });
          succeeded++;
        } catch (err) {
          logger.error('❌ Journal ' + journal.id + ' failed: ' + describeError(err));
          await reportSyncStatus(auth, 'journal-sync-status', company_id, { journalId: journal.id, status: 'error', error: describeError(err), tallyVoucherNumber: null });
          failed++;
        }
      }
    } catch (err) {
      loopError = describeError(err);
      logger.error('❌ Journal loop [' + company_id + '] error: ' + loopError);
    }
    results.push({ company_id, succeeded, failed, error: loopError });
  }
  return results;
}

module.exports = { journalLoop };
