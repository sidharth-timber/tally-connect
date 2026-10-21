const axios = require('axios');
const logger = require('../logger');
const { describeError } = require('../tally/errors');
const { extractLineError, extractVoucherId, tallyHttp, assertImported } = require('../tally/tallyClient');
const { rollbackVoucher } = require('../tally/deleteVoucher');
const {
  categoryToLedger, buildExpenseLedgerXML, buildBankLedgerXML, buildGSTInputLedgerXML,
  buildTDSPayableLedgerXML, buildExpenseXML,
} = require('../tally/xmlBuilders');
const { fetchTallyExpenseVoucherNumber, fetchTallyVoucherNumberById } = require('../tally/voucherLookup');
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
      const res = await tallyHttp.post(tallyUrl, buildExpenseLedgerXML(ledgerName), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) logger.log(`⚠️ Expense ledger "${ledgerName}":`, err);
    } catch (e) { logger.log('⚠️ Expense ledger error:', e.message); }
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
      const res = await tallyHttp.post(tallyUrl, buildBankLedgerXML(), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) logger.log('⚠️ Bank ledger:', err);
    } catch (e) { logger.log('⚠️ Bank ledger error:', e.message); }
  }

  const inputLedgers = [];
  if (expense.cgst > 0 && !ledgerNames.input_cgst) inputLedgers.push({ name: 'CGST Input', head: 'Central Tax' });
  if (expense.sgst > 0 && !ledgerNames.input_sgst) inputLedgers.push({ name: 'SGST Input', head: 'State Tax' });
  if (expense.igst > 0 && !ledgerNames.input_igst) inputLedgers.push({ name: 'IGST Input', head: 'Integrated Tax' });
  for (const l of inputLedgers) {
    try {
      const res = await tallyHttp.post(tallyUrl, buildGSTInputLedgerXML(l.name, l.head), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) logger.log(`⚠️ ${l.name}:`, err);
    } catch (e) { logger.log(`⚠️ ${l.name} error:`, e.message); }
  }

  if (expense.has_tds && expense.tds_amount > 0 && !ledgerNames.tds_payable) {
    try {
      const res = await tallyHttp.post(tallyUrl, buildTDSPayableLedgerXML(), { headers: { 'Content-Type': 'application/xml' } });
      const err = extractLineError(res.data);
      if (err && !err.toLowerCase().includes('already exists')) logger.log('⚠️ TDS Payable ledger:', err);
    } catch (e) { logger.log('⚠️ TDS Payable ledger error:', e.message); }
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
          const tallyRes = await tallyHttp.post(tallyUrl, xml, { headers: { 'Content-Type': 'application/xml' } });
          if (tallyRes.data.includes('Unknown Request')) throw new Error('Tally rejected: Unknown Request');
          const lineError = extractLineError(tallyRes.data);
          if (lineError) throw new Error(`Expense creation failed: ${lineError}`);
          const exceptionsMatch = tallyRes.data.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/);
          if (exceptionsMatch && parseInt(exceptionsMatch[1]) > 0) {
            const detail = (tallyRes.data.match(/<ERROR>(.*?)<\/ERROR>/i) || [])[1] || 'no detail';
            throw new Error(`Expense had exceptions: ${detail}`);
          }
          assertImported(tallyRes.data, 'Expense');
          const rawDate = expense.date || new Date().toISOString();
          const dateStr = (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString())
            .split('T')[0].replace(/-/g, '');
          const tallyVoucherNumber = await fetchTallyVoucherNumberById(dateStr, extractVoucherId(tallyRes.data), tallyUrl)
            || await fetchTallyExpenseVoucherNumber(
            dateStr,
            [expense.total, expense.total - (expense.has_tds ? expense.tds_amount || 0 : 0)],
            tallyUrl,
            expense.narration || expense.notes
          );
          if (!tallyVoucherNumber) { await rollbackVoucher(tallyUrl, extractVoucherId(tallyRes.data), 'Payment', dateStr); throw new Error('Expense: Tally accepted the voucher but it cannot be found in Tally afterwards — check the open company and period, then sync again'); }
          await reportSyncStatus(auth, 'expense-sync-status', company_id, { expenseId: expense.id, status: 'success', error: '', tallyMasterId: extractVoucherId(tallyRes.data), voucherDate: dateStr, tallyVoucherNumber });
          succeeded++;
        } catch (err) {
          logger.error(`❌ Expense ${expense.id} failed:`, err.message);
          await reportSyncStatus(auth, 'expense-sync-status', company_id, { expenseId: expense.id, status: 'error', error: describeError(err), tallyVoucherNumber: null });
          failed++;
        }
      }
    } catch (err) {
      loopError = err.response?.data?.message || err.message;
      logger.error(`❌ Expense loop [${company_id}] error:`, loopError);
    }
    results.push({ company_id, succeeded, failed, error: loopError });
  }
  return results;
}

module.exports = { expenseLoop, ensureExpenseMasterData };
