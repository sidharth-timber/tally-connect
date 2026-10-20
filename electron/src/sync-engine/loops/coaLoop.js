const axios = require('axios');
const logger = require('../logger');
const { fetchCOA } = require('../tally/coaExport');

// Exports the chart of accounts (group + ledger masters) from Tally for one
// company and pushes the full snapshot to the backend. Always sends the whole
// COA — the backend upsert is idempotent, so no agent-side diffing.
async function fetchAndPushCOA({ serverUrl, caKey, apiKey, tallyUrl, company, trigger = 'auto' }) {
  const authPayload = caKey ? { caKey } : { apiKey };
  try {
    const { groups, ledgers } = await fetchCOA({
      tallyUrl,
      tallyCompanyName: company.tally_company_name,
    });
    if (ledgers.length === 0) {
      // An empty ledger list means the collection request failed silently or
      // the wrong company is open — don't wipe the backend snapshot.
      return { company_id: company.company_id, succeeded: 0, failed: 0, error: 'No ledgers returned from Tally' };
    }
    await axios.post(`${serverUrl}/webhook`, {
      ...authPayload,
      company_id: company.company_id,
      event: 'tally-coa-import',
      data: { groups, ledgers, trigger },
    });
    return { company_id: company.company_id, succeeded: ledgers.length, failed: 0, error: null };
  } catch (e) {
    const msg = e.response?.data?.error || e.message;
    logger.error(`[coa] import for company ${company.company_id} failed:`, msg);
    return { company_id: company.company_id, succeeded: 0, failed: 1, error: msg };
  }
}

// COA export for every company — run as the first step of a manual sync cycle
// so newly created Tally ledgers surface before vouchers referencing them.
async function coaLoop({ companies, serverUrl, caKey, apiKey, tallyUrl }, trigger = 'manual') {
  const results = [];
  for (const company of companies) {
    results.push(await fetchAndPushCOA({ serverUrl, caKey, apiKey, tallyUrl, company, trigger }));
  }
  return results;
}

module.exports = { coaLoop, fetchAndPushCOA };
