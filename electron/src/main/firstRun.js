const store = require('./config-store');
const { agentInit } = require('../sync-engine/agentInit');
const { DEFAULT_TALLY_URL } = require('../sync-engine/tally/tallyClient');

// Validates an Agent Key against the backend before persisting it, so a typo
// fails fast in the setup screen instead of silently failing on the first
// sync cycle (which is what agentInit's own catch block did in the old code).
async function submitAgentKey(caKey) {
  const trimmed = (caKey || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Agent Key is required.' };
  }

  const serverUrl = store.get('serverUrl');
  try {
    await agentInit({ serverUrl, caKey: trimmed, tallyUrl: DEFAULT_TALLY_URL });
  } catch (err) {
    return { ok: false, error: err.response?.data?.error || err.message || 'Could not validate Agent Key.' };
  }

  store.set('caKey', trimmed);
  store.set('hasCompletedSetup', true);
  return { ok: true };
}

function hasCompletedSetup() {
  return store.get('hasCompletedSetup');
}

module.exports = { submitAgentKey, hasCompletedSetup };
