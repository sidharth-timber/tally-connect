const axios = require('axios');
const { extractLineError } = require('../tally/tallyClient');
const { buildReceiptXML } = require('../tally/xmlBuilders');
const { fetchTallyReceiptNumber } = require('../tally/voucherLookup');
const { reportSyncStatus } = require('../reporting');

async function ensureCashLedger(tallyUrl) {
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
      for (const p of payments) {
        try {
          await ensureCashLedger(tallyUrl);
          const xml = buildReceiptXML(p);
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

module.exports = { paymentLoop, ensureCashLedger };
