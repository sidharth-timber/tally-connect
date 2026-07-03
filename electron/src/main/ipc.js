const { ipcMain, shell } = require('electron');
const { getMainWindow } = require('./window');
const { submitAgentKey, hasCompletedSetup } = require('./firstRun');
const { downloadUpdate, quitAndInstall } = require('./autoUpdate');
const store = require('./config-store');

// Timber's web app — CA Settings → Integrations page. Fixed destination for
// the "Web View" button (not per-company; there's no per-company URL from
// the backend yet).
const INTEGRATIONS_URL = 'http://localhost:5176/ca/settings/integrations';

function registerIpcHandlers(engine) {
  ipcMain.handle('sync:get-state', () => engine.getState());
  // Refreshes company list + Tally connection status only — never triggers
  // an actual invoice/bill/payment/expense/pull sync. See sync:company for
  // the only action that does that.
  ipcMain.handle('sync:refresh', () => engine.refresh());
  ipcMain.handle('sync:company', (_e, companyId) => engine.syncCompany(companyId));

  ipcMain.handle('setup:has-completed', () => hasCompletedSetup());
  ipcMain.handle('setup:submit-key', async (_e, key) => {
    const result = await submitAgentKey(key);
    if (result.ok) {
      await engine.updateAuth({ serverUrl: store.get('serverUrl'), caKey: store.get('caKey') });
    }
    return result;
  });

  // The update installer comes from the backend (agent-init's
  // agent_download_url — the exe the admin uploaded to storage), not from an
  // electron-updater feed. Status updates go to both the engine state and the
  // update:status channel so the pill stays correct across re-renders.
  ipcMain.handle('update:download', async () => {
    const { downloadUrl } = engine.getState();
    return downloadUpdate(downloadUrl, (payload) => {
      engine.setUpdateStatus(payload.status);
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('update:status', payload);
    });
  });
  ipcMain.on('update:quit-and-install', () => quitAndInstall());

  ipcMain.on('window:minimize', () => getMainWindow()?.minimize());
  ipcMain.on('window:close', () => getMainWindow()?.close());

  ipcMain.handle('webview:open', () => {
    shell.openExternal(INTEGRATIONS_URL);
    return { ok: true };
  });

  engine.on('state-changed', (state) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('sync:state', state);
  });
}

module.exports = { registerIpcHandlers };
