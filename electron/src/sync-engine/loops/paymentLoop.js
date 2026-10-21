const axios = require('axios');
const { pendingData, noteFailed } = require('../batch');
const logger = require('../logger');
const { describeError } = require('../tally/errors');
const { extractLineError, extractVoucherId, tallyHttp, assertImported } = require('../tally/tallyClient');
const { rollbackVoucher } = require('../tally/deleteVoucher');
const { buildReceiptXML, buildCustomLedgerXML } = require('../tally/xmlBuilders');
const { fetchTallyReceiptNumber, fetchTallyVoucherNumberById } = require('../tally/voucherLookup');
const { reportSyncStatus } = require('../reporting');

// Create-fallback (Phase 2c): creates a ledger under an arbitrary name/parent
// for a Timber account with no Tally mapping yet, instead of silently posting
// to an unrelated default. Tolerates "already exists" like every other
// master-ensure call here; never alters an existing ledger. `name` may be
// undefined (nothing to create) — a plain no-op in that case.
async function ensureCustomLedger(tallyUrl, name, parentName, fallbackParent) {
  if (!name) {
    return;
  }
  try {
    const res = await axios.post(
      tallyUrl,
      buildCustomLedgerXML(name, parentName, fallbackParent),
      { headers: { 'Content-Type': 'application/xml' } }
    );
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) {
      logger.log(`⚠️ Ledger "${name}" creation failed:`, err);
    }
  } catch (e) {
    logger.log(`⚠️ Ledger "${name}" creation error:`, e.message);
  }
}

// `ledgerNames.cash` (Phase 2, optional): skip creating the generic "Cash"
// ledger when the CA has already mapped a real Tally cash ledger — it
// already exists in Tally, so there's nothing to create.
async function ensureCashLedger(tallyUrl, ledgerNames = {}) {
  if (ledgerNames.cash) {
    return;
  }
  const { create } = require('xmlbuilder2');
  const xml = create({ version: '1.0' })
    .ele('ENVELOPE')
      .ele('HEADER').ele('TALLYREQUEST').txt('Import Data').up().up()
      .ele('BODY').ele('IMPORTDATA')
        .ele('REQUESTDESC').ele('REPORTNAME').txt('All Masters').up().up()
        .ele('REQUESTDATA').ele('TALLYMESSAGE')
          .ele('LEDGER', { NAME: 'Cash', RESERVEDNAME: '' })
            .ele('NAME').txt('Cash').up()
            .ele('PARENT').txt('Cash-in-Hand').up()
          .up()
        .up().up()
      .up()
    .end({ prettyPrint: true });
  try {
    const res = await tallyHttp.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) {
      logger.log('⚠️ Cash ledger creation failed:', err);
    }
  } catch (e) {
    logger.log('⚠️ Cash ledger creation error:', e.message);
  }
}

// Syncs pending customer payments (receipts) for every company.
async function paymentLoop({ companies, serverUrl, caKey, apiKey, tallyUrl, batch }) {
  const results = [];
  for (const company of companies) {
    const { company_id } = company;
    const auth = { serverUrl, caKey, apiKey };
    let succeeded = 0, failed = 0, loopError = null;
    try {
      const res = await axios.post(`${serverUrl}/webhook`, {
        ...(caKey ? { caKey } : { apiKey }),
        company_id,
        event: 'payment-sync-request',
        data: pendingData(batch, company_id, 'payment-sync-request')
      });

      const payments = res.data.payments || [];
      const ledgerNames = res.data.ledger_names || {};
      for (const p of payments) {
        // handled for the rest of this sync whatever the outcome, so a lost acknowledgement can't get it re-sent
        noteFailed(batch, company_id, 'payment-sync-request', p.id);
        try {
          await ensureCashLedger(tallyUrl, ledgerNames);
          await ensureCustomLedger(tallyUrl, p.account_create_name, p.account_create_parent, 'Bank Accounts');
          const xml = buildReceiptXML(p, ledgerNames);
          const tallyRes = await tallyHttp.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });

          if (tallyRes.data.includes('Unknown Request')) throw new Error('Tally rejected receipt: Unknown Request');
          const lineError = extractLineError(tallyRes.data);
          if (lineError) throw new Error(`Receipt creation failed: ${lineError}`);

          const exceptionsMatch = tallyRes.data.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          if (exceptionsMatch && parseInt(exceptionsMatch[1]) > 0) {
            const detail = (tallyRes.data.match(/<ERROR>(.*?)<\/ERROR>/i) || tallyRes.data.match(/<ERRLISTEX>([\s\S]*?)<\/ERRLISTEX>/i) || [])[1] || 'no detail';
            throw new Error(`Receipt creation had exceptions: ${detail}`);
          }

          assertImported(tallyRes.data, 'Receipt');
          const rawDate = p.date || new Date().toISOString();
          const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
            .split('T')[0].replace(/-/g, '');
          const receiptNumber = await fetchTallyVoucherNumberById(dateStr, extractVoucherId(tallyRes.data), tallyUrl)
            || await fetchTallyReceiptNumber(dateStr, p.customer_name, p.amount, tallyUrl);
          if (!receiptNumber) { await rollbackVoucher(tallyUrl, extractVoucherId(tallyRes.data), 'Receipt', dateStr); throw new Error('Receipt: Tally accepted the voucher but it cannot be found in Tally afterwards — check the open company and period, then sync again'); }
          await reportSyncStatus(auth, 'payment-sync-status', company_id, { paymentId: p.id, status: 'success', error: '', tallyMasterId: extractVoucherId(tallyRes.data), voucherDate: dateStr, receiptNumber });
          succeeded++;
        } catch (err) {
          logger.error(`❌ Payment ${p.id} failed:`, err.message);
          await reportSyncStatus(auth, 'payment-sync-status', company_id, { paymentId: p.id, status: 'error', error: describeError(err), receiptNumber: null });
          noteFailed(batch, company_id, 'payment-sync-request', p.id);
          failed++;
        }
      }
    } catch (err) {
      loopError = err.response?.data?.message || err.message;
      logger.error(`❌ Payment loop [${company_id}] error:`, loopError);
    }
    results.push({ company_id, succeeded, failed, error: loopError });
  }
  return results;
}

module.exports = { paymentLoop, ensureCashLedger, ensureCustomLedger };
