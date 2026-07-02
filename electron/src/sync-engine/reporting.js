const axios = require('axios');

// Generic replacement for agent.js's five near-identical reportXxxStatus functions.
// `auth` is { serverUrl, caKey } or { serverUrl, apiKey }.
async function reportSyncStatus(auth, event, companyId, data) {
  try {
    await axios.post(`${auth.serverUrl}/webhook`, {
      ...(auth.caKey ? { caKey: auth.caKey } : { apiKey: auth.apiKey }),
      company_id: companyId,
      event,
      data,
    });
  } catch (err) {
    console.error(`❌ Failed to report ${event}:`, err.message);
  }
}

module.exports = { reportSyncStatus };
