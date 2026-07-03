const EventEmitter = require('events');
const { agentInit } = require('./agentInit');
const { checkTallyStatus, DEFAULT_TALLY_URL } = require('./tally/tallyClient');
const { createInitialState } = require('./state');
const { invoiceLoop } = require('./loops/invoiceLoop');
const { paymentLoop } = require('./loops/paymentLoop');
const { billLoop } = require('./loops/billLoop');
const { paymentMadeLoop } = require('./loops/paymentMadeLoop');
const { expenseLoop } = require('./loops/expenseLoop');
const { pullLoop } = require('./loops/pullLoop');

const AGENT_INIT_INTERVAL_MS = 5 * 60 * 1000;
const STATUS_CHECK_INTERVAL_MS = 60 * 1000;

// Backend only knows 'never_synced' | 'success' | 'error' (from
// tallyClientConfig.last_sync_status, driven by the pull loop's
// sync-complete report) — map to the same enum used locally.
function mapBackendSyncStatus(status) {
  if (!status || status === 'never_synced') return 'never';
  return status;
}

// True only if `latest` is strictly newer than `current` (numeric semver
// compare, missing parts treated as 0). A plain !== check would offer a
// downgrade whenever the backend's active version lags the installed app.
function isNewerVersion(latest, current) {
  if (!latest || !current) return false;
  const a = String(latest).split('.').map(n => parseInt(n, 10) || 0);
  const b = String(current).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

// The sync engine owns all state and scheduling that used to live as
// module-level `let`s and top-level setInterval calls in agent.js. It has no
// Electron imports, so it can run under plain Node (see the CLI harness) or
// inside Electron's main process (see electron/src/main/index.js).
function createSyncEngine({ serverUrl, caKey, apiKey, tallyUrl = DEFAULT_TALLY_URL, agentVersion = '0.0.0' }) {
  const emitter = new EventEmitter();
  const state = createInitialState(agentVersion);
  const companiesById = new Map();
  let timers = [];
  let auth = { serverUrl, caKey, apiKey };

  function loopCtx() {
    return { companies: [...companiesById.values()], serverUrl: auth.serverUrl, caKey: auth.caKey, apiKey: auth.apiKey, tallyUrl };
  }

  function emitState() {
    state.companies = [...companiesById.values()];
    emitter.emit('state-changed', state);
  }

  function applyLoopResults(resultsArrays) {
    const now = new Date().toISOString();
    for (const results of resultsArrays) {
      for (const r of results) {
        const company = companiesById.get(r.company_id);
        if (!company) continue;
        company.lastSyncedAt = now;
        if (r.error) {
          company.lastSyncStatus = 'error';
          company.lastSyncError = r.error;
        } else if (r.failed > 0) {
          company.lastSyncStatus = 'partial';
          company.lastSyncError = null;
        } else {
          company.lastSyncStatus = 'success';
          company.lastSyncError = null;
        }
      }
    }
  }

  // Runs one pass of all six sync loops against an explicit subset of
  // companies (never "whatever's in companiesById" implicitly) — this is the
  // only thing that actually talks to the backend/Tally beyond company-list
  // and connection-status metadata. It only ever runs on demand (see
  // syncCompany), never on a timer — see the "not automatic" note on start().
  async function runSyncCycle(companies) {
    if (companies.length === 0) return;
    const ctx = { ...loopCtx(), companies };
    const resultsArrays = await Promise.all([
      invoiceLoop(ctx), paymentLoop(ctx), billLoop(ctx),
      paymentMadeLoop(ctx), expenseLoop(ctx), pullLoop(ctx),
    ]);
    applyLoopResults(resultsArrays);
  }

  // Triggered only by the renderer's per-company "Sync" button — the sole
  // way real invoice/bill/payment/expense/pull webhook calls happen. Company
  // list + Tally connection status still refresh automatically (read-only
  // metadata), but no data is pushed/pulled without an explicit click.
  async function syncCompany(companyId) {
    const company = companiesById.get(companyId);
    if (!company) return { ok: false, error: 'Unknown company' };
    if (company.syncing) return { ok: false, error: 'Already syncing' };

    company.syncing = true;
    emitState();
    try {
      await runSyncCycle([company]);
      return { ok: true };
    } catch (err) {
      company.lastSyncStatus = 'error';
      company.lastSyncError = err.message;
      return { ok: false, error: err.message };
    } finally {
      company.syncing = false;
      emitState();
    }
  }

  async function refreshCompanies() {
    try {
      const { companies, latestVersion, downloadUrl } = await agentInit({ serverUrl: auth.serverUrl, caKey: auth.caKey, tallyUrl });
      const nextIds = new Set(companies.map(c => c.company_id));
      for (const id of [...companiesById.keys()]) {
        if (!nextIds.has(id)) companiesById.delete(id);
      }
      // Sync status/timestamp comes from the backend (tallyClientConfig,
      // persisted server-side) so it survives app restarts — a local click
      // on "Sync" updates it immediately in memory too, and wins here until
      // the backend's own record catches up and becomes the newer value.
      for (const c of companies) {
        const { sync_status, last_synced_at, last_error, ...companyFields } = c;
        const existing = companiesById.get(c.company_id);
        const localSyncedAt = existing?.lastSyncedAt ?? null;
        const backendIsNewer = last_synced_at && (!localSyncedAt || new Date(last_synced_at) > new Date(localSyncedAt));

        // Note: fall back to `existing` presence, not `existing.field ?? ...`
        // — a legitimate null (e.g. "no error") must not be treated as
        // "absent" and overwritten by the backend's stale value.
        companiesById.set(c.company_id, {
          ...companyFields,
          lastSyncedAt: backendIsNewer ? last_synced_at : (existing ? localSyncedAt : (last_synced_at ?? null)),
          lastSyncStatus: backendIsNewer ? mapBackendSyncStatus(sync_status) : (existing ? existing.lastSyncStatus : mapBackendSyncStatus(sync_status)),
          lastSyncError: backendIsNewer ? (last_error ?? null) : (existing ? existing.lastSyncError : (last_error ?? null)),
          syncing: existing?.syncing ?? false,
        });
      }
      state.latestVersion = latestVersion;
      state.downloadUrl = downloadUrl;
      // Don't clobber a download in progress (or one waiting for the user to
      // restart) — those statuses are owned by main/autoUpdate.js.
      if (!['downloading', 'ready'].includes(state.updateStatus)) {
        state.updateStatus = isNewerVersion(latestVersion, agentVersion) ? 'available' : 'idle';
      }
      emitter.emit('agent-init', { latestVersion, downloadUrl });
    } catch (err) {
      console.error('[sync-engine] agentInit failed:', err.response?.data || err.message);
    }
    emitState();
  }

  async function refreshTallyStatus() {
    const status = await checkTallyStatus(tallyUrl);
    state.connection = {
      tallyReachable: status.connected,
      tallyVersion: status.version,
      lastCheckedAt: new Date().toISOString(),
    };
    emitState();
  }

  // Only fetches company list + Tally connection status automatically — no
  // invoice/bill/payment/expense/pull sync ever runs on a timer. Actual data
  // syncing is opt-in per company via syncCompany(), triggered by the
  // renderer's "Sync" button.
  async function start() {
    await refreshCompanies();
    await refreshTallyStatus();
    timers.push(setInterval(refreshCompanies, AGENT_INIT_INTERVAL_MS));
    timers.push(setInterval(refreshTallyStatus, STATUS_CHECK_INTERVAL_MS));
  }

  function stop() {
    timers.forEach(clearInterval);
    timers = [];
  }

  // Used by the renderer's "Refresh" link — re-checks company list and Tally
  // connection status only, same as the automatic interval. Does not sync
  // any company's data (see syncCompany for that).
  async function refresh() {
    await refreshCompanies();
    await refreshTallyStatus();
  }

  function getState() {
    return state;
  }

  // Called from main/ipc.js as the installer download progresses, so the
  // engine's state (the renderer's source of truth on every state-changed
  // re-render) agrees with the transient update:status events.
  function setUpdateStatus(status) {
    state.updateStatus = status;
    emitState();
  }

  // Used when the Agent Key is set/changed from the first-run setup screen —
  // updates credentials in place and restarts the loops, without tearing down
  // the EventEmitter instance other modules (tray, IPC) already subscribed to.
  async function updateAuth({ serverUrl: newServerUrl, caKey: newCaKey, apiKey: newApiKey }) {
    stop();
    companiesById.clear();
    auth = {
      serverUrl: newServerUrl ?? auth.serverUrl,
      caKey: newCaKey ?? auth.caKey,
      apiKey: newApiKey ?? auth.apiKey,
    };
    await start();
  }

  return {
    start,
    stop,
    refresh,
    syncCompany,
    getState,
    setUpdateStatus,
    updateAuth,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
  };
}

module.exports = { createSyncEngine };
