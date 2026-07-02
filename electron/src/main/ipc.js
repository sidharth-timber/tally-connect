const { ipcMain, shell } = require('electron');
const { getMainWindow } = require('./window');
const { submitAgentKey, hasCompletedSetup } = require('./firstRun');
const { checkForUpdates, downloadUpdate, quitAndInstall } = require('./autoUpdate');
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

  // The renderer calls this for both "Download App" (idle, first check) and
  // "Update App" (already know one's available) — check first since
  // electron-updater needs a resolved checkForUpdates() before downloadUpdate()
  // knows what to fetch.
  ipcMain.handle('update:download', async () => {
    const result = await checkForUpdates();
    if (result?.updateInfo && result.isUpdateAvailable !== false) {
      return downloadUpdate();
    }
    return null;
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
