const axios = require('axios');
const { extractLineError } = require('../tally/tallyClient');
const {
  categoryToLedger, buildExpenseLedgerXML, buildBankLedgerXML, buildGSTInputLedgerXML,
  buildTDSPayableLedgerXML, buildExpenseXML,
} = require('../tally/xmlBuilders');
const { fetchTallyExpenseVoucherNumber } = require('../tally/voucherLookup');
const { reportSyncStatus } = require('../reporting');
const { ensureCashLedger, ensureCustomLedger } = require('./paymentLoop');

// `ledgerNames` (Phase 2, optional) — see invoiceLoop.js's ensureMasterData
// for why a mapped role skips the corresponding default-ledger creation.
// `expense.category_ledger_name`/`expense.payment_ledger_name` (Phase 2b,
// optional) are even more specific — this expense's own mapped accounts.
// `expense.category_create_name`/`payment_create_name` (Phase 2c, optional):
// when the respective account has no Tally mapping at all, create a ledger
// under its own Timber name instead of the categoryToLedger()/Cash/Bank
// default — see buildInvoiceXML's comment for why matching the name matters.
async function ensureExpenseMasterData(expense, tallyUrl, ledgerNames = {}) {
  if (expense.category_ledger_name) {
    // already exists in Tally under a CA-confirmed mapping — nothing to do
  } else if (expense.category_create_name) {
    await ensureCustomLedger(tallyUrl, expense.category_create_name, expense.category_create_parent, 'Indirect Expenses');
  } else {
    const ledgerName = categoryToLedger(expense.category);
    try {
      const res = await axios.post(tallyUrl, buildExpenseLedgerXML(ledgerName), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) console.log(`⚠️ Expense ledger "${ledgerName}":`, err);
    } catch (e) { console.log('⚠️ Expense ledger error:', e.message); }
  }

  // Which default master (Cash vs Bank) to ensure is decided by payment
  // mode regardless of what the resolved display ledger ends up being —
  // ensureCashLedger already no-ops when ledgerNames.cash is set; the bank
  // branch here mirrors that same skip for the company-wide "bank" role.
  if (expense.payment_ledger_name) {
    // already exists in Tally under a CA-confirmed mapping — nothing to do
  } else if (expense.payment_create_name) {
    await ensureCustomLedger(tallyUrl, expense.payment_create_name, expense.payment_create_parent, 'Bank Accounts');
  } else if (expense.mode === 'cash') {
    await ensureCashLedger(tallyUrl, ledgerNames);
  } else if (!ledgerNames.bank) {
    try {
      const res = await axios.post(tallyUrl, buildBankLedgerXML(), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) console.log('⚠️ Bank ledger:', err);
    } catch (e) { console.log('⚠️ Bank ledger error:', e.message); }
  }

  const inputLedgers = [];
  if (expense.cgst > 0 && !ledgerNames.input_cgst) inputLedgers.push({ name: 'CGST Input', head: 'Central Tax' });
  if (expense.sgst > 0 && !ledgerNames.input_sgst) inputLedgers.push({ name: 'SGST Input', head: 'State Tax' });
  if (expense.igst > 0 && !ledgerNames.input_igst) inputLedgers.push({ name: 'IGST Input', head: 'Integrated Tax' });
  for (const l of inputLedgers) {
    try {
      const res = await axios.post(tallyUrl, buildGSTInputLedgerXML(l.name, l.head), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) console.log(`⚠️ ${l.name}:`, err);
    } catch (e) { console.log(`⚠️ ${l.name} error:`, e.message); }
  }

  if (expense.has_tds && expense.tds_amount > 0 && !ledgerNames.tds_payable) {
    try {
      const res = await axios.post(tallyUrl, buildTDSPayableLedgerXML(), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) console.log('⚠️ TDS Payable ledger:', err);
    } catch (e) { console.log('⚠️ TDS Payable ledger error:', e.message); }
  }
}

// Syncs pending expenses for every company.
async function expenseLoop({ companies, serverUrl, caKey, apiKey, tallyUrl }) {
  const results = [];
  for (const company of companies) {
    const { company_id } = company;
    const auth = { serverUrl, caKey, apiKey };
    let succeeded = 0, failed = 0, loopError = null;
    try {
      const res = await axios.post(`${serverUrl}/webhook`, {
        ...(caKey ? { caKey } : { apiKey }),
        company_id,
        event: 'expense-sync-request'
      });
      const expenses = res.data.expenses || [];
      const ledgerNames = res.data.ledger_names || {};
      for (const expense of expenses) {
        try {
          await ensureExpenseMasterData(expense, tallyUrl, ledgerNames);
          const xml = buildExpenseXML(expense, ledgerNames);
          const tallyRes = await axios.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });
          if (tallyRes.data.includes('Unknown Request')) throw new Error('Tally rejected: Unknown Request');
          const lineError = extractLineError(tallyRes.data);
          if (lineError) throw new Error(`Expense creation failed: ${lineError}`);
          const exceptionsMatch = tallyRes.data.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          if (exceptionsMatch && parseInt(exceptionsMatch[1]) > 0) {
            const detail = (tallyRes.data.match(/<ERROR>(.*?)<\/ERROR>/i) || [])[1] || 'no detail';
            throw new Error(`Expense had exceptions: ${detail}`);
          }
          const rawDate = expense.date || new Date().toISOString();
          const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
            .split('T')[0].replace(/-/g, '');
          const tallyVoucherNumber = await fetchTallyExpenseVoucherNumber(dateStr, expense.total, tallyUrl);
          await reportSyncStatus(auth, 'expense-sync-status', company_id, { expenseId: expense.id, status: 'success', error: '', tallyVoucherNumber });
          succeeded++;
        } catch (err) {
          console.error(`❌ Expense ${expense.id} failed:`, err.message);
          await reportSyncStatus(auth, 'expense-sync-status', company_id, { expenseId: expense.id, status: 'error', error: err.message, tallyVoucherNumber: null });
          failed++;
        }
      }
    } catch (err) {
      loopError = err.response?.data?.message || err.message;
      console.error(`❌ Expense loop [${company_id}] error:`, loopError);
    }
    results.push({ company_id, succeeded, failed, error: loopError });
  }
  return results;
}

module.exports = { expenseLoop, ensureExpenseMasterData };
