const axios = require('axios');
const logger = require('../logger');
const { describeError } = require('../tally/errors');
const { extractLineError, extractVoucherId, tallyHttp } = require('../tally/tallyClient');
const {
  buildUnitXML, buildStockGroupXML, buildSalesLedgerXML, buildGSTLedgerXML,
  buildLedgerXML, buildItemXML, buildInvoiceXML,
} = require('../tally/xmlBuilders');
const { fetchTallyVoucherNumber, fetchTallyVoucherNumberById } = require('../tally/voucherLookup');
const { reportSyncStatus } = require('../reporting');
const { ensureCustomLedger } = require('./paymentLoop');

// 🛠 Ensures master data exists: Unit + Stock Group + Customer Ledger + Items + Sales Ledger + GST ledgers
// `ledgerNames` (Phase 2, optional): when a role (sales/output_cgst/etc.) is
// already mapped to a real Tally ledger via the CA's COA mapping, that ledger
// already exists in Tally — skip creating the generic default under that
// role to avoid cluttering the client's chart of accounts with an unused
// duplicate.
async function ensureMasterData(invoice, tallyUrl, ledgerNames = {}) {
  const unitXML = buildUnitXML();
  const unitRes = await tallyHttp.post(tallyUrl, unitXML, { headers: { 'Content-Type': 'application/xml' } });
  const unitError = extractLineError(unitRes.data);
  if (unitError && !unitError.toLowerCase().includes('already exists')) {
    throw new Error(`Unit creation failed: ${unitError}`);
  }

  try {
    const stockGroupRes = await tallyHttp.post(tallyUrl, buildStockGroupXML(), { headers: { 'Content-Type': 'application/xml' } });
    const stockGroupError = extractLineError(stockGroupRes.data);
    if (stockGroupError && !stockGroupError.toLowerCase().includes('already exists')) {
      logger.log("⚠️ Primary stock group creation failed, will try without parent group");
    }
  } catch (err) {
    logger.log('⚠️ Stock group creation error, will try items without parent group');
  }

  if (!ledgerNames.sales) {
    try {
      const salesLedgerRes = await tallyHttp.post(tallyUrl, buildSalesLedgerXML(), { headers: { 'Content-Type': 'application/xml' } });
      const salesLedgerError = extractLineError(salesLedgerRes.data);
      if (salesLedgerError && !salesLedgerError.toLowerCase().includes('already exists')) {
        logger.log('⚠️ Sales ledger creation failed:', salesLedgerError);
      }
    } catch (err) {
      logger.log('⚠️ Sales ledger creation error:', err.message);
    }
  }

  const gstLedgers = [];
  if (invoice.cgst > 0 && !ledgerNames.output_cgst) gstLedgers.push({ name: 'CGST', head: 'Central Tax' });
  if (invoice.sgst > 0 && !ledgerNames.output_sgst) gstLedgers.push({ name: 'SGST', head: 'State Tax' });
  if (invoice.igst > 0 && !ledgerNames.output_igst) gstLedgers.push({ name: 'IGST', head: 'Integrated Tax' });
  if (invoice.cess > 0 && !ledgerNames.output_cess) gstLedgers.push({ name: 'Cess', head: 'Cess' });
  for (const gst of gstLedgers) {
    try {
      const gstRes = await tallyHttp.post(tallyUrl, buildGSTLedgerXML(gst.name, gst.head), { headers: { 'Content-Type': 'application/xml' } });
      const gstError = extractLineError(gstRes.data);
      if (gstError && !gstError.toLowerCase().includes('already exists')) {
        logger.log(`⚠️ ${gst.name} ledger creation failed:`, gstError);
      }
    } catch (err) {
      logger.log(`⚠️ ${gst.name} ledger creation error:`, err.message);
    }
  }

  // Discount / round-off ledgers sit under Indirect Expenses unless the CA mapped them.
  if (invoice.discount_amount > 0 && !ledgerNames.discount) {
    await ensureCustomLedger(tallyUrl, 'Discount Allowed', null, 'Indirect Expenses');
  }
  if (invoice.round_off && !ledgerNames.round_off) {
    await ensureCustomLedger(tallyUrl, 'Round Off', null, 'Indirect Expenses');
  }

  const customerName = invoice.customer?.name || invoice.customerName || 'Unknown Customer';
  const ledgerRes = await tallyHttp.post(tallyUrl, buildLedgerXML(customerName, invoice.customer), { headers: { 'Content-Type': 'application/xml' } });
  const ledgerError = extractLineError(ledgerRes.data);
  if (ledgerError && !ledgerError.toLowerCase().includes('already exists')) {
    throw new Error(`Customer creation failed: ${ledgerError}`);
  }

  for (const item of invoice.items) {
    const itemName = item.title || item.name || 'Unknown Item';
    const itemXML = buildItemXML(itemName, item.gst_rate || 0, item.hsn || '');
    const itemRes = await tallyHttp.post(tallyUrl, itemXML, { headers: { 'Content-Type': 'application/xml' } });

    const itemError = extractLineError(itemRes.data);
    if (itemError && itemError.toLowerCase().includes('already exists')) {
      const alterXML = itemXML.replace(
        `<STOCKITEM NAME="${itemName}" RESERVEDNAME="">`,
        `<STOCKITEM NAME="${itemName}" RESERVEDNAME="" ACTION="Alter">`
      );
      const alterRes = await tallyHttp.post(tallyUrl, alterXML, { headers: { 'Content-Type': 'application/xml' } });
      const alterError = extractLineError(alterRes.data);
      if (alterError) throw new Error(`Item alter failed: ${alterError}`);
    } else if (itemError) {
      throw new Error(`Item '${itemName}' creation failed: ${itemError}`);
    }
  }
}

// Syncs pending sales invoices for every company. Returns per-company results
// so the caller (sync-engine) can update UI-facing sync state.
async function invoiceLoop({ companies, serverUrl, caKey, apiKey, tallyUrl }) {
  const results = [];
  for (const company of companies) {
    const { company_id, gstin, state } = company;
    const auth = { serverUrl, caKey, apiKey };
    let succeeded = 0, failed = 0, loopError = null;
    try {
      const res = await axios.post(`${serverUrl}/webhook`, {
        ...(caKey ? { caKey } : { apiKey }),
        company_id,
        event: 'sync-request',
      });

      const invoices = res.data.invoices || [];
      const ledgerNames = res.data.ledger_names || {};
      for (const invoice of invoices) {
        try {
          await ensureMasterData(invoice, tallyUrl, ledgerNames);
          await ensureCustomLedger(tallyUrl, invoice.account_create_name, invoice.account_create_parent, 'Sales Accounts');

          const xml = buildInvoiceXML(invoice, { gstin, state, ledgerNames });
          const tallyRes = await tallyHttp.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });

          if (tallyRes.data.includes('Unknown Request')) {
            throw new Error('Tally rejected the request: Unknown Request — check XML structure or ensure a company is open in Tally Prime');
          }

          const invoiceError = extractLineError(tallyRes.data);
          if (invoiceError) throw new Error(`Invoice creation failed: ${invoiceError}`);

          const exceptionsMatch = tallyRes.data.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          const exceptions = exceptionsMatch ? parseInt(exceptionsMatch[1]) : 0;
          if (exceptions > 0) {
            const errorMatch = tallyRes.data.match(/<ERROR>(.*?)<\/ERROR>/i);
            const exceptionMatch = tallyRes.data.match(/<EXCEPTION>(.*?)<\/EXCEPTION>/i);
            const errListMatch = tallyRes.data.match(/<ERRLISTEX>([\s\S]*?)<\/ERRLISTEX>/i);
            const detail = errorMatch?.[1] || exceptionMatch?.[1] || errListMatch?.[1]?.trim() || 'no detail returned by Tally';
            throw new Error(`Invoice creation had exceptions: ${detail}`);
          }

          const rawDate = invoice.invoice_date || invoice.issue_date || new Date().toISOString();
          const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
            .split('T')[0].replace(/-/g, '');
          const partyName = invoice.customer?.name || invoice.customerName || '';
          const tallyVoucherNumber = await fetchTallyVoucherNumberById(dateStr, extractVoucherId(tallyRes.data), tallyUrl)
            || await fetchTallyVoucherNumber(dateStr, partyName, invoice.total, tallyUrl);
          await reportSyncStatus(auth, 'sync-status', company_id, { invoiceId: invoice.id, status: 'success', error: '', tallyMasterId: extractVoucherId(tallyRes.data), voucherDate: dateStr, tallyVoucherNumber });
          succeeded++;
        } catch (err) {
          logger.error(`❌ Failed to sync invoice ${invoice.id}: ${err.message}`);
          await reportSyncStatus(auth, 'sync-status', company_id, { invoiceId: invoice.id, status: 'error', error: describeError(err), tallyVoucherNumber: null });
          failed++;
        }
      }
    } catch (err) {
      loopError = err.response?.data?.message || err.message;
      logger.error(`❌ Invoice loop [${company_id}] error:`, loopError);
    }
    results.push({ company_id, succeeded, failed, error: loopError });
  }
  return results;
}

module.exports = { invoiceLoop, ensureMasterData };
