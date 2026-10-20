const EventEmitter = require('events');
const { agentInit } = require('./agentInit');
const { checkTallyStatus, DEFAULT_TALLY_URL } = require('./tally/tallyClient');
const { createInitialState } = require('./state');
const { invoiceLoop } = require('./loops/invoiceLoop');
const { paymentLoop } = require('./loops/paymentLoop');
const { billLoop } = require('./loops/billLoop');
const { paymentMadeLoop } = require('./loops/paymentMadeLoop');
const { expenseLoop } = require('./loops/expenseLoop');
const { creditNoteLoop, debitNoteLoop } = require('./loops/noteLoop');
const { pullLoop } = require('./loops/pullLoop');
const { coaLoop, fetchAndPushCOA } = require('./loops/coaLoop');

const AGENT_INIT_INTERVAL_MS = 5 * 60 * 1000;
const STATUS_CHECK_INTERVAL_MS = 60 * 1000;
// Backend clears coa_refresh_requested / flips coa_mapping_status when a COA
// import lands, but its state can lag one agent-init poll — don't re-post the
// same snapshot within this window.
const COA_AUTO_IMPORT_COOLDOWN_MS = 2 * 60 * 1000;

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
  const coaImportedAt = new Map(); // company_id -> epoch ms of last auto COA import
  let timers = [];
  let auth = { serverUrl, caKey, apiKey };

  function loopCtx() {
    return { companies: [...companiesById.values()], serverUrl: auth.serverUrl, caKey: auth.caKey, apiKey: auth.apiKey, tallyUrl };
  }

  function emitState() {
    state.companies = [...companiesById.values()];
    emitter.emit('state-changed', state);
  }

  // One status per company for the whole cycle: the worst outcome of any loop
  // wins. (Previously each loop overwrote the last, so the final loop's
  // success hid earlier failures and the UI said "Synced" after every
  // document had failed.)
  function applyLoopResults(resultsArrays) {
    const now = new Date().toISOString();
    const rank = { success: 0, partial: 1, error: 2 };
    const worst = new Map();
    for (const results of resultsArrays) {
      for (const r of results) {
        const status = r.error ? 'error' : r.failed > 0 ? 'partial' : 'success';
        const prev = worst.get(r.company_id);
        if (!prev || rank[status] > rank[prev.status]) {
          worst.set(r.company_id, { status, error: r.error || null });
        }
      }
    }
    for (const [companyId, { status, error }] of worst) {
      const company = companiesById.get(companyId);
      if (!company) continue;
      company.lastSyncedAt = now;
      company.lastSyncStatus = status;
      company.lastSyncError = error;
    }
  }

  // Runs one pass of all six sync loops against an explicit subset of
  // companies (never "whatever's in companiesById" implicitly) — this is the
  // only thing that actually talks to the backend/Tally beyond company-list
  // and connection-status metadata. It only ever runs on demand (see
  // syncCompany), never on a timer — see the "not automatic" note on start().
  async function runSyncCycle(companies) {
    if (companies.length === 0) return;
    // COA snapshot first, so ledgers created in Tally since the last sync are
    // known to the backend before vouchers referencing them arrive.
    await coaLoop({ ...loopCtx(), companies }, 'manual');
    for (const c of companies) coaImportedAt.set(c.company_id, Date.now());
    // Data loops only for sync-enabled companies — the backend lists
    // configured-but-disabled companies solely for the COA import (their
    // mapping must be confirmed before sync can be enabled) and rejects
    // voucher events for them.
    const enabled = companies.filter(c => c.sync_enabled !== false);
    if (enabled.length === 0) return;
    const ctx = { ...loopCtx(), companies: enabled };
    // SEQUENTIAL, not Promise.all: Tally Prime's XML server is single-
    // threaded and crashes outright (Software Exception c0000005) when
    // several imports land simultaneously — eight concurrent loops made that
    // near-certain. Serializing costs little (Tally was the bottleneck
    // anyway) and buys correct ordering for free: documents push before the
    // notes/payments that reference them, and pullLoop reads the Day Book
    // last, after everything this cycle pushed is already in it.
    const resultsArrays = [];
    for (const loop of [
      invoiceLoop, paymentLoop, billLoop,
      paymentMadeLoop, expenseLoop,
      creditNoteLoop, debitNoteLoop, pullLoop,
    ]) {
      resultsArrays.push(await loop(ctx));
    }
    applyLoopResults(resultsArrays);
  }

  // First-connect / on-demand COA import: agent-init tells us which companies
  // have never had their chart of accounts imported (or have a pending
  // refresh request from the CA's matching page) — push a snapshot without
  // waiting for a manual sync click. Read-only towards Tally, so it's safe to
  // run from the automatic agent-init cycle.
  async function autoImportCOA() {
    const now = Date.now();
    const due = [...companiesById.values()].filter(c =>
      c.tally_company_name &&
      (c.coa_mapping_status === 'not_imported' || c.coa_refresh_requested) &&
      now - (coaImportedAt.get(c.company_id) || 0) > COA_AUTO_IMPORT_COOLDOWN_MS
    );
    for (const company of due) {
      coaImportedAt.set(company.company_id, Date.now());
      const result = await fetchAndPushCOA({ ...loopCtx(), company, trigger: 'auto' });
      if (!result.error) {
        // Optimistic local update so the next poll's stale response (if the
        // backend lags) doesn't retrigger; the backend remains authoritative.
        company.coa_refresh_requested = false;
        if (company.coa_mapping_status === 'not_imported') company.coa_mapping_status = 'needs_review';
      }
    }
  }

  // Triggered only by the renderer's per-company "Sync" button — the sole
  // way real invoice/bill/payment/expense/pull webhook calls happen. Company
  // list + Tally connection status still refresh automatically (read-only
  // metadata), but no data is pushed/pulled without an explicit click.
  async function syncCompany(companyId) {
    const company = companiesById.get(companyId);
    if (!company) return { ok: false, error: 'Unknown company' };
    if (company.syncing) return { ok: false, error: 'Already syncing' };

    // Refuse to push anything unless Tally is reachable and has THIS client's
    // company open — otherwise every document errors one by one (or worse,
    // posts into whichever other company happens to be loaded).
    const tally = await checkTallyStatus(tallyUrl);
    let preflightError = null;
    if (!tally.connected) {
      preflightError = 'Tally Prime is not reachable. Open Tally with the company loaded (XML server enabled) and sync again.';
    } else if (company.tally_company_name && tally.currentCompany && tally.currentCompany !== company.tally_company_name) {
      preflightError = 'Tally has "' + tally.currentCompany + '" open, but this client is mapped to "' + company.tally_company_name + '". Open the right company and sync again.';
    }
    if (preflightError) {
      company.lastSyncStatus = 'error';
      company.lastSyncError = preflightError;
      emitState();
      return { ok: false, error: preflightError };
    }

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
      await autoImportCOA();
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
