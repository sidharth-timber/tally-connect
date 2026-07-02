const axios = require('axios');
const { extractLineError } = require('../tally/tallyClient');
const {
  buildUnitXML, buildStockGroupXML, buildSalesLedgerXML, buildGSTLedgerXML,
  buildLedgerXML, buildItemXML, buildInvoiceXML,
} = require('../tally/xmlBuilders');
const { fetchTallyVoucherNumber } = require('../tally/voucherLookup');
const { reportSyncStatus } = require('../reporting');

// 🛠 Ensures master data exists: Unit + Stock Group + Customer Ledger + Items + Sales Ledger + GST ledgers
async function ensureMasterData(invoice, tallyUrl) {
  const unitXML = buildUnitXML();
  const unitRes = await axios.post(tallyUrl, unitXML, { headers: { 'Content-Type': 'application/xml' } });
  const unitError = extractLineError(unitRes.data);
  if (unitError && !unitError.toLowerCase().includes('already exists')) {
    throw new Error(`Unit creation failed: ${unitError}`);
  }

  try {
    const stockGroupRes = await axios.post(tallyUrl, buildStockGroupXML(), { headers: { 'Content-Type': 'application/xml' } });
    const stockGroupError = extractLineError(stockGroupRes.data);
    if (stockGroupError && !stockGroupError.toLowerCase().includes('already exists')) {
      console.log("⚠️ Primary stock group creation failed, will try without parent group");
    }
  } catch (err) {
    console.log('⚠️ Stock group creation error, will try items without parent group');
  }

  try {
    const salesLedgerRes = await axios.post(tallyUrl, buildSalesLedgerXML(), { headers: { 'Content-Type': 'application/xml' } });
    const salesLedgerError = extractLineError(salesLedgerRes.data);
    if (salesLedgerError && !salesLedgerError.toLowerCase().includes('already exists')) {
      console.log('⚠️ Sales ledger creation failed:', salesLedgerError);
    }
  } catch (err) {
    console.log('⚠️ Sales ledger creation error:', err.message);
  }

  const gstLedgers = [];
  if (invoice.cgst > 0) gstLedgers.push({ name: 'CGST', head: 'Central Tax' });
  if (invoice.sgst > 0) gstLedgers.push({ name: 'SGST', head: 'State Tax' });
  if (invoice.igst > 0) gstLedgers.push({ name: 'IGST', head: 'Integrated Tax' });
  for (const gst of gstLedgers) {
    try {
      const gstRes = await axios.post(tallyUrl, buildGSTLedgerXML(gst.name, gst.head), { headers: { 'Content-Type': 'application/xml' } });
      const gstError = extractLineError(gstRes.data);
      if (gstError && !gstError.toLowerCase().includes('already exists')) {
        console.log(`⚠️ ${gst.name} ledger creation failed:`, gstError);
      }
    } catch (err) {
      console.log(`⚠️ ${gst.name} ledger creation error:`, err.message);
    }
  }

  const customerName = invoice.customer?.name || invoice.customerName || 'Unknown Customer';
  const ledgerRes = await axios.post(tallyUrl, buildLedgerXML(customerName), { headers: { 'Content-Type': 'application/xml' } });
  const ledgerError = extractLineError(ledgerRes.data);
  if (ledgerError && !ledgerError.toLowerCase().includes('already exists')) {
    throw new Error(`Customer creation failed: ${ledgerError}`);
  }

  for (const item of invoice.items) {
    const itemName = item.title || item.name || 'Unknown Item';
    const itemXML = buildItemXML(itemName, item.gst_rate || 0, item.hsn || '');
    const itemRes = await axios.post(tallyUrl, itemXML, { headers: { 'Content-Type': 'application/xml' } });

    const itemError = extractLineError(itemRes.data);
    if (itemError && itemError.toLowerCase().includes('already exists')) {
      const alterXML = itemXML.replace(
        `<STOCKITEM NAME="${itemName}" RESERVEDNAME="">`,
        `<STOCKITEM NAME="${itemName}" RESERVEDNAME="" ACTION="Alter">`
      );
      const alterRes = await axios.post(tallyUrl, alterXML, { headers: { 'Content-Type': 'application/xml' } });
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
      for (const invoice of invoices) {
        try {
          await ensureMasterData(invoice, tallyUrl);

          const xml = buildInvoiceXML(invoice, { gstin, state });
          const tallyRes = await axios.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });

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
          const tallyVoucherNumber = await fetchTallyVoucherNumber(dateStr, partyName, invoice.total, tallyUrl);
          await reportSyncStatus(auth, 'sync-status', company_id, { invoiceId: invoice.id, status: 'success', error: '', tallyVoucherNumber });
          succeeded++;
        } catch (err) {
          console.error(`❌ Failed to sync invoice ${invoice.id}: ${err.message}`);
          await reportSyncStatus(auth, 'sync-status', company_id, { invoiceId: invoice.id, status: 'error', error: err.message, tallyVoucherNumber: null });
          failed++;
        }
      }
    } catch (err) {
      loopError = err.response?.data?.message || err.message;
      console.error(`❌ Invoice loop [${company_id}] error:`, loopError);
    }
    results.push({ company_id, succeeded, failed, error: loopError });
  }
  return results;
}

module.exports = { invoiceLoop, ensureMasterData };
