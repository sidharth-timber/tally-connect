const axios = require('axios');
const logger = require('../logger');
const { describeError } = require('../tally/errors');
const { extractLineError, extractVoucherId, tallyHttp } = require('../tally/tallyClient');
const {
  buildPurchaseAccountXML, buildUnitXML, buildItemXML, buildGSTInputLedgerXML,
  buildVendorLedgerXML, buildPurchaseXML,
} = require('../tally/xmlBuilders');
const { fetchTallyPurchaseVoucherNumber, fetchTallyVoucherNumberById } = require('../tally/voucherLookup');
const { reportSyncStatus } = require('../reporting');
const { ensureCustomLedger } = require('./paymentLoop');

// `ledgerNames` (Phase 2, optional) — see invoiceLoop.js's ensureMasterData
// for why a mapped role skips the corresponding default-ledger creation.
async function ensurePurchaseMasterData(bill, tallyUrl, ledgerNames = {}) {
  const vendorName = bill.vendor_name || 'Unknown Vendor';
  const lineItems = (bill.line_items || []).filter(i => i.qty > 0 || i.amount > 0);

  if (!ledgerNames.purchase) {
    try {
      const res = await tallyHttp.post(tallyUrl, buildPurchaseAccountXML(), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) logger.log('⚠️ Purchase Account ledger:', err);
    } catch (e) { logger.log('⚠️ Purchase Account error:', e.message); }
  }

  try {
    const res = await tallyHttp.post(tallyUrl, buildUnitXML(), { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) logger.log('⚠️ Unit PIECES:', err);
  } catch (e) { logger.log('⚠️ Unit PIECES error:', e.message); }

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
      const itemRes = await tallyHttp.post(tallyUrl, itemXML, { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(itemRes.data);
      if (err && !err.toLowerCase().includes('already exists')) logger.log(`⚠️ Item "${item.name}":`, err);
    } catch (e) { logger.log(`⚠️ Item "${item.name}" error:`, e.message); }
  }

  // Under RCM the voucher never uses CGST/SGST/IGST Input — it posts to the
  // RCM Payable/"not due" ledgers instead (see the block below).
  if (!bill.rcm) {
    const inputLedgers = [];
    if (bill.cgst > 0 && !ledgerNames.input_cgst) inputLedgers.push({ name: 'CGST Input', head: 'Central Tax' });
    if (bill.sgst > 0 && !ledgerNames.input_sgst) inputLedgers.push({ name: 'SGST Input', head: 'State Tax' });
    if (bill.igst > 0 && !ledgerNames.input_igst) inputLedgers.push({ name: 'IGST Input', head: 'Integrated Tax' });
    for (const l of inputLedgers) {
      try {
        const res = await tallyHttp.post(tallyUrl, buildGSTInputLedgerXML(l.name, l.head), { headers: { 'Content-Type': 'application/xml' } });
        const err = extractLineError(res.data);
        if (err && !err.toLowerCase().includes('already exists')) logger.log(`⚠️ ${l.name} ledger:`, err);
      } catch (e) { logger.log(`⚠️ ${l.name} error:`, e.message); }
    }
  }

  // RCM Payable (liability) ledgers, plus the "not due" holding account when
  // the tax will eventually become claimable. Skipped per-role when already
  // mapped to a real Tally ledger — same pattern as the input-ledger block.
  // Parent is 'Duties & Taxes' (a real Tally built-in group, same as the
  // Input CGST/SGST/IGST ledgers above) rather than Timber's own COA
  // sub-group "RCM GST Payable" — that grouping only exists in Timber's
  // chart of accounts, not as an actual Tally group, so creating a ledger
  // under it fails with "Group 'RCM GST Payable' does not exist!".
  if (bill.rcm) {
    if (bill.cgst > 0 && !ledgerNames.rcm_cgst_payable) {
      await ensureCustomLedger(tallyUrl, 'RCM CGST Payable', null, 'Duties & Taxes');
    }
    if (bill.sgst > 0 && !ledgerNames.rcm_sgst_payable) {
      await ensureCustomLedger(tallyUrl, 'RCM SGST Payable', null, 'Duties & Taxes');
    }
    if (bill.igst > 0 && !ledgerNames.rcm_igst_payable) {
      await ensureCustomLedger(tallyUrl, 'RCM IGST Payable', null, 'Duties & Taxes');
    }
    const hasRcmTax = bill.cgst > 0 || bill.sgst > 0 || bill.igst > 0;
    if (bill.itc_eligible !== false && hasRcmTax && !ledgerNames.rcm_itc_not_due) {
      await ensureCustomLedger(tallyUrl, 'Reverse Charge Tax Input but not due', null, 'Sundry Debtors');
    }
  }

  try {
    const res = await tallyHttp.post(tallyUrl, buildVendorLedgerXML(vendorName), { headers: { 'Content-Type': 'application/xml' } });
    const err = extractLineError(res.data);
    if (err && !err.toLowerCase().includes('already exists')) logger.log(`⚠️ Vendor ledger "${vendorName}":`, err);
  } catch (e) { logger.log('⚠️ Vendor ledger error:', e.message); }
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
      const ledgerNames = res.data.ledger_names || {};
      for (const bill of bills) {
        try {
          await ensurePurchaseMasterData(bill, tallyUrl, ledgerNames);
          await ensureCustomLedger(tallyUrl, bill.account_create_name, bill.account_create_parent, 'Indirect Expenses');
          const xml = buildPurchaseXML(bill, ledgerNames);
          const tallyRes = await tallyHttp.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });
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
          const tallyVoucherNumber = await fetchTallyVoucherNumberById(dateStr, extractVoucherId(tallyRes.data), tallyUrl)
            || await fetchTallyPurchaseVoucherNumber(dateStr, bill.vendor_name, bill.total_amount, tallyUrl);
          await reportSyncStatus(auth, 'bill-sync-status', company_id, { billId: bill.id, status: 'success', error: '', tallyMasterId: extractVoucherId(tallyRes.data), voucherDate: dateStr, tallyVoucherNumber });
          succeeded++;
        } catch (err) {
          logger.error(`❌ Bill ${bill.id} failed:`, err.message);
          await reportSyncStatus(auth, 'bill-sync-status', company_id, { billId: bill.id, status: 'error', error: describeError(err), tallyVoucherNumber: null });
          failed++;
        }
      }
    } catch (err) {
      loopError = err.response?.data?.message || err.response?.data?.error || err.message;
      logger.error(`❌ Bill loop [${company_id}] error:`, loopError);
    }
    results.push({ company_id, succeeded, failed, error: loopError });
  }
  return results;
}

module.exports = { billLoop, ensurePurchaseMasterData };
