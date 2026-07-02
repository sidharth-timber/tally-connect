const axios = require('axios');
const { extractLineError } = require('../tally/tallyClient');
const {
  buildPurchaseAccountXML, buildUnitXML, buildItemXML, buildGSTInputLedgerXML,
  buildVendorLedgerXML, buildPurchaseXML,
} = require('../tally/xmlBuilders');
const { fetchTallyPurchaseVoucherNumber } = require('../tally/voucherLookup');
const { reportSyncStatus } = require('../reporting');

async function ensurePurchaseMasterData(bill, tallyUrl) {
  const vendorName = bill.vendor_name || 'Unknown Vendor';
  const lineItems = (bill.line_items || []).filter(i => i.qty > 0 || i.amount > 0);

  try {
    const res = await axios.post(tallyUrl, buildPurchaseAccountXML(), { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) console.log('⚠️ Purchase Account ledger:', err);
  } catch (e) { console.log('⚠️ Purchase Account error:', e.message); }

  try {
    const res = await axios.post(tallyUrl, buildUnitXML(), { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) console.log('⚠️ Unit PIECES:', err);
  } catch (e) { console.log('⚠️ Unit PIECES error:', e.message); }

  const itemsToCreate = lineItems.length > 0
    ? lineItems.map(i => ({
        name: i.name || i.sku || i.product_name || bill.description || 'Purchase',
        gstRate: i.gst_rate || bill.gst_rate || 0,
        hsn: i.hsn_code || i.hsn || ''
      }))
    : [{ name: bill.description || bill.bill_no || 'Purchase', gstRate: bill.gst_rate || 0, hsn: '' }];

  for (const item of itemsToCreate) {
    try {
      const itemXML = buildItemXML(item.name, item.gstRate, item.hsn);
      const itemRes = await axios.post(tallyUrl, itemXML, { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(itemRes.data);
      if (err && !err.toLowerCase().includes('already exists')) console.log(`⚠️ Item "${item.name}":`, err);
    } catch (e) { console.log(`⚠️ Item "${item.name}" error:`, e.message); }
  }

  const inputLedgers = [];
  if (bill.cgst > 0) inputLedgers.push({ name: 'CGST Input', head: 'Central Tax' });
  if (bill.sgst > 0) inputLedgers.push({ name: 'SGST Input', head: 'State Tax' });
  if (bill.igst > 0) inputLedgers.push({ name: 'IGST Input', head: 'Integrated Tax' });
  for (const l of inputLedgers) {
    try {
      const res = await axios.post(tallyUrl, buildGSTInputLedgerXML(l.name, l.head), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) console.log(`⚠️ ${l.name} ledger:`, err);
    } catch (e) { console.log(`⚠️ ${l.name} error:`, e.message); }
  }

  try {
    const res = await axios.post(tallyUrl, buildVendorLedgerXML(vendorName), { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) console.log(`⚠️ Vendor ledger "${vendorName}":`, err);
  } catch (e) { console.log('⚠️ Vendor ledger error:', e.message); }
}

// Syncs pending vendor bills (purchases) for every company.
async function billLoop({ companies, serverUrl, caKey, apiKey, tallyUrl }) {
  const results = [];
  for (const company of companies) {
    const { company_id } = company;
    const auth = { serverUrl, caKey, apiKey };
    let succeeded = 0, failed = 0, loopError = null;
    try {
      const res = await axios.post(`${serverUrl}/webhook`, {
        ...(caKey ? { caKey } : { apiKey }),
        company_id,
        event: 'bill-sync-request'
      });
      const bills = res.data.bills || [];
      for (const bill of bills) {
        try {
          await ensurePurchaseMasterData(bill, tallyUrl);
          const xml = buildPurchaseXML(bill);
          const tallyRes = await axios.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });
          if (tallyRes.data.includes('Unknown Request')) throw new Error('Tally rejected: Unknown Request');
          const lineError = extractLineError(tallyRes.data);
          if (lineError) throw new Error(`Purchase creation failed: ${lineError}`);
          const exceptionsMatch = tallyRes.data.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          if (exceptionsMatch && parseInt(exceptionsMatch[1]) > 0) {
            const detail = (tallyRes.data.match(/<ERROR>(.*?)<\/ERROR>/i) || [])[1] || 'no detail';
            throw new Error(`Purchase had exceptions: ${detail}`);
          }
          const rawDate = bill.bill_date || new Date().toISOString();
          const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
            .split('T')[0].replace(/-/g, '');
          const tallyVoucherNumber = await fetchTallyPurchaseVoucherNumber(dateStr, bill.vendor_name, bill.total_amount, tallyUrl);
          await reportSyncStatus(auth, 'bill-sync-status', company_id, { billId: bill.id, status: 'success', error: '', tallyVoucherNumber });
          succeeded++;
        } catch (err) {
          console.error(`❌ Bill ${bill.id} failed:`, err.message);
          await reportSyncStatus(auth, 'bill-sync-status', company_id, { billId: bill.id, status: 'error', error: err.message, tallyVoucherNumber: null });
          failed++;
        }
      }
    } catch (err) {
      loopError = err.response?.data?.message || err.response?.data?.error || err.message;
      console.error(`❌ Bill loop [${company_id}] error:`, loopError);
    }
    results.push({ company_id, succeeded, failed, error: loopError });
  }
  return results;
}

module.exports = { billLoop, ensurePurchaseMasterData };
