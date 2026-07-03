import { initTitlebar, renderUpdateButton } from './components/titlebar.js';
import { initStatusRow, renderStatusRow } from './components/statusRow.js';
import { renderCompanyRow } from './components/companyRow.js';
import { renderEmptyState } from './components/emptyState.js';
import { initSetupScreen, showSetupScreen } from './components/setupScreen.js';

const companyListEl = document.getElementById('company-list');
const statusRowEl = document.getElementById('status-row');
const appVersionEl = document.getElementById('app-version');

function renderVersion(agentVersion) {
  appVersionEl.textContent = agentVersion ? `v${agentVersion}` : '';
}

function renderState(state) {
  renderVersion(state.agentVersion);
  const companies = state.companies || [];

  companyListEl.innerHTML = '';
  if (companies.length === 0) {
    companyListEl.classList.add('hidden');
    renderEmptyState(true);
  } else {
    companyListEl.classList.remove('hidden');
    renderEmptyState(false);
    for (const company of companies) {
      companyListEl.appendChild(renderCompanyRow(company, {
        onWebView: (companyId) => window.tallyAgent.openWebView(companyId),
        onSync: (companyId) => window.tallyAgent.syncCompany(companyId),
      }));
    }
  }

  renderStatusRow(state.connection);
  renderUpdateButton(state.updateStatus);
}

function showMainView() {
  showSetupScreen(false);
  statusRowEl.classList.remove('hidden');
}

async function boot() {
  // Shown regardless of setup state — engine.getState() always has
  // agentVersion even before the sync engine itself starts.
  renderVersion((await window.tallyAgent.getState()).agentVersion);

  initTitlebar({
    onMinimize: () => window.tallyAgent.minimize(),
    onClose: () => window.tallyAgent.close(),
    onMenu: () => { /* native overflow menu — fast-follow */ },
    onUpdateClick: async () => {
      const state = await window.tallyAgent.getState();
      if (state.updateStatus === 'ready') {
        window.tallyAgent.quitAndInstall();
      } else if (['available', 'idle', 'error'].includes(state.updateStatus)) {
        window.tallyAgent.downloadUpdate();
      }
    },
  });

  initStatusRow({
    onRefresh: () => window.tallyAgent.refresh(),
  });

  initSetupScreen({
    onSubmit: async (key) => {
      const result = await window.tallyAgent.submitAgentKey(key);
      if (result.ok) {
        showMainView();
        renderState(await window.tallyAgent.getState());
      }
      return result;
    },
  });

  window.tallyAgent.onStateChanged(renderState);
  window.tallyAgent.onUpdateStatus(({ status }) => renderUpdateButton(status));

  const hasCompletedSetup = await window.tallyAgent.hasCompletedSetup();
  if (hasCompletedSetup) {
    showMainView();
    renderState(await window.tallyAgent.getState());
  } else {
    showSetupScreen(true);
  }

  // Keep "Synced X ago" text fresh without waiting for the next sync event.
  setInterval(async () => {
    const state = await window.tallyAgent.getState();
    if (!statusRowEl.classList.contains('hidden')) renderState(state);
  }, 60 * 1000);
}

boot();
