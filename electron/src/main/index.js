require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// See the TALLYAGENT_TEST_MODE note below: isolates config-store to a throwaway
// directory so a dev smoke test never reads/writes real persisted credentials.
const TEST_MODE = process.env.TALLYAGENT_TEST_MODE === '1';
if (TEST_MODE) {
  app.setPath('userData', path.join(os.tmpdir(), 'tallyagent-test-userdata'));
}

// This app is meant to run persistently in the background — an uncaught
// exception in Electron's main process otherwise terminates the whole
// process silently, killing the sync engine along with it. Log instead.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaught exception (app kept running):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[main] unhandled rejection (app kept running):', err);
});

const store = require('./config-store');
const { createSyncEngine } = require('../sync-engine');
const { createMainWindow, getMainWindow, markQuitting } = require('./window');
const { createTray } = require('./tray');
const { registerIpcHandlers } = require('./ipc');
const { hasCompletedSetup } = require('./firstRun');

// Prevent a second instance from spawning a duplicate sync engine against the
// same Tally instance/backend.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.on('before-quit', markQuitting);

  app.whenReady().then(() => {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'agent-run-log.txt'),
      `${store.get('serverUrl')} started at ${new Date()}\n`
    );

    // Best-effort fallback migration in case the NSIS installer's elevated
    // customInstall hook (see build/installer.nsh) didn't run — e.g. a dev
    // build, or an install that skipped elevation. Failures here (most
    // commonly: not running as admin, so `sc delete` is refused) are
    // swallowed; the installer-time migration is the primary path.
    //
    // TALLYAGENT_TEST_MODE=1 skips this entirely — set it when smoke-testing
    // the app shell on a machine that has a real TallyAgent install, so a
    // dev run never auto-imports real credentials and starts syncing against
    // production Tally/backend.
    if (!hasCompletedSetup() && !TEST_MODE) {
      try {
        const { migrate } = require('../../scripts/migrate-from-service');
        const result = migrate();
        if (result.servicesFound > 0) {
          console.log('[migrate] legacy service migration result:', result);
        }
        if (result.legacyConfig?.caKey && !store.get('caKey')) {
          store.set('caKey', result.legacyConfig.caKey);
          if (result.legacyConfig.serverUrl) store.set('serverUrl', result.legacyConfig.serverUrl);
          store.set('hasCompletedSetup', true);
        }
      } catch (err) {
        console.log('[migrate] skipped (likely not elevated):', err.message);
      }
    }

    const engine = createSyncEngine({
      serverUrl: store.get('serverUrl'),
      caKey: store.get('caKey'),
      agentVersion: app.getVersion(),
    });

    const mainWindow = createMainWindow();
    registerIpcHandlers(engine);
    createTray(engine);

    mainWindow.once('ready-to-show', () => {
      if (!hasCompletedSetup() || TEST_MODE) mainWindow.show();
    });

    if (hasCompletedSetup() && !TEST_MODE) {
      engine.start();
    }
  });
}
