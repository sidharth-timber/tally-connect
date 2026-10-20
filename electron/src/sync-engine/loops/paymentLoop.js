const axios = require('axios');
const { extractLineError } = require('../tally/tallyClient');
const { buildReceiptXML, buildCustomLedgerXML } = require('../tally/xmlBuilders');
const { fetchTallyReceiptNumber } = require('../tally/voucherLookup');
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
      console.log(`⚠️ Ledger "${name}" creation failed:`, err);
    }
  } catch (e) {
    console.log(`⚠️ Ledger "${name}" creation error:`, e.message);
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
    const res = await axios.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) {
      console.log('⚠️ Cash ledger creation failed:', err);
    }
  } catch (e) {
    console.log('⚠️ Cash ledger creation error:', e.message);
  }
}

// Syncs pending customer payments (receipts) for every company.
async function paymentLoop({ companies, serverUrl, caKey, apiKey, tallyUrl }) {
  const results = [];
  for (const company of companies) {
    const { company_id } = company;
    const auth = { serverUrl, caKey, apiKey };
    let succeeded = 0, failed = 0, loopError = null;
    try {
      const res = await axios.post(`${serverUrl}/webhook`, {
        ...(caKey ? { caKey } : { apiKey }),
        company_id,
        event: 'payment-sync-request'
      });

      const payments = res.data.payments || [];
      const ledgerNames = res.data.ledger_names || {};
      for (const p of payments) {
        try {
          await ensureCashLedger(tallyUrl, ledgerNames);
          await ensureCustomLedger(tallyUrl, p.account_create_name, p.account_create_parent, 'Bank Accounts');
          const xml = buildReceiptXML(p, ledgerNames);
          const tallyRes = await axios.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });

          if (tallyRes.data.includes('Unknown Request')) throw new Error('Tally rejected receipt: Unknown Request');
          const lineError = extractLineError(tallyRes.data);
          if (lineError) throw new Error(`Receipt creation failed: ${lineError}`);

          const exceptionsMatch = tallyRes.data.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          if (exceptionsMatch && parseInt(exceptionsMatch[1]) > 0) {
            const detail = (tallyRes.data.match(/<ERROR>(.*?)<\/ERROR>/i) || tallyRes.data.match(/<ERRLISTEX>([\s\S]*?)<\/ERRLISTEX>/i) || [])[1] || 'no detail';
            throw new Error(`Receipt creation had exceptions: ${detail}`);
          }

          const rawDate = p.date || new Date().toISOString();
          const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
            .split('T')[0].replace(/-/g, '');
          const receiptNumber = await fetchTallyReceiptNumber(dateStr, p.customer_name, p.amount, tallyUrl);
          await reportSyncStatus(auth, 'payment-sync-status', company_id, { paymentId: p.id, status: 'success', error: '', receiptNumber });
          succeeded++;
        } catch (err) {
          console.error(`❌ Payment ${p.id} failed:`, err.message);
          await reportSyncStatus(auth, 'payment-sync-status', company_id, { paymentId: p.id, status: 'error', error: err.message, receiptNumber: null });
          failed++;
        }
      }
    } catch (err) {
      loopError = err.response?.data?.message || err.message;
      console.error(`❌ Payment loop [${company_id}] error:`, loopError);
    }
    results.push({ company_id, succeeded, failed, error: loopError });
  }
  return results;
}

module.exports = { paymentLoop, ensureCashLedger, ensureCustomLedger };
