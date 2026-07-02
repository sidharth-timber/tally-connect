const axios = require('axios');
const { fetchTallyCompanies } = require('./tally/tallyClient');

// Fetches the list of companies enabled for this Agent Key, plus latest-version
// info for the update pill. Unlike the original agent.js, this does NOT mutate
// any shared state or perform the update download itself — callers own that.
async function agentInit({ serverUrl, caKey, tallyUrl }) {
  if (!caKey) {
    return { companies: [], latestVersion: null, downloadUrl: null };
  }
  const tally_companies = await fetchTallyCompanies(tallyUrl);
  const res = await axios.post(`${serverUrl}/webhook`, { caKey, event: 'agent-init', tally_companies });
  return {
    companies: res.data.companies || [],
    latestVersion: res.data.latest_version || null,
    downloadUrl: res.data.agent_download_url || null,
  };
}

module.exports = { agentInit };
