import { initTitlebar, renderUpdateButton } from './components/titlebar.js';
import { initStatusRow, renderStatusRow } from './components/statusRow.js';
import { renderCompanyRow } from './components/companyRow.js';
import { renderEmptyState } from './components/emptyState.js';
import { initLogsPanel, showLogsPanel } from './components/logsPanel.js';
import { initSetupScreen, resetSetupScreen, showSetupScreen } from './components/setupScreen.js';

const companyListEl = document.getElementById('company-list');
const statusRowEl = document.getElementById('status-row');
const appVersionEl = document.getElementById('app-version');
const logsLinkEl = document.getElementById('logs-link');

// The Logs view takes the place of the company list; the status row and footer stay.
let logsOpen = false;
async function setLogsOpen(open) {
  logsOpen = open;
  await showLogsPanel(open);
  companyListEl.classList.toggle('hidden', open || companyListEl.childElementCount === 0);
  if (open) renderEmptyState(false);
  logsLinkEl.textContent = open ? '\u25A4 Companies' : '\u2630 Logs';
}

function renderVersion(agentVersion) {
  appVersionEl.textContent = agentVersion ? `v${agentVersion}` : '';
}

function renderState(state) {
  renderVersion(state.agentVersion);
  const companies = state.companies || [];
  if (logsOpen) {
    renderStatusRow(state.connection);
    renderUpdateButton(state.updateStatus);
    return;
  }

  companyListEl.innerHTML = '';
  if (companies.length === 0) {
    companyListEl.classList.add('hidden');
    renderEmptyState(true);
  } else {
    companyListEl.classList.remove('hidden');
    renderEmptyState(false);
    for (const company of companies) {
      companyListEl.appendChild(renderCompanyRow(company, {
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
  logsLinkEl.classList.remove('hidden');
}

async function boot() {
  // Shown regardless of setup state — engine.getState() always has
  // agentVersion even before the sync engine itself starts.
  renderVersion((await window.tallyAgent.getState()).agentVersion);

  initTitlebar({
    onMinimize: () => window.tallyAgent.minimize(),
    onClose: () => window.tallyAgent.close(),
    onMenu: () => window.tallyAgent.showMenu(),
    onUpdateClick: async () => {
      const state = await window.tallyAgent.getState();
      if (state.updateStatus === 'ready') {
        window.tallyAgent.quitAndInstall();
      } else if (['available', 'idle', 'error'].includes(state.updateStatus)) {
        window.tallyAgent.downloadUpdate();
      }
    },
  });

  initLogsPanel({ onClose: async () => { await setLogsOpen(false); renderState(await window.tallyAgent.getState()); } });
  logsLinkEl.addEventListener('click', async () => {
    await setLogsOpen(!logsOpen);
    if (!logsOpen) renderState(await window.tallyAgent.getState());
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

  // Logout (title-bar menu or tray): drop the company list and go back to the
  // key entry screen.
  window.tallyAgent.onLoggedOut(() => {
    if (logsOpen) setLogsOpen(false);
    logsLinkEl.classList.add('hidden');
    companyListEl.innerHTML = '';
    companyListEl.classList.add('hidden');
    renderEmptyState(false);
    statusRowEl.classList.add('hidden');
    resetSetupScreen();
    showSetupScreen(true);
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
