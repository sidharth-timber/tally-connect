const { autoUpdater } = require('electron-updater');
const { getMainWindow, markQuitting } = require('./window');

function send(channel, payload) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// No real update feed is hosted yet (package.json's publish.url is a
// placeholder — see plan's auto-update section: repointing it at a real
// static host is backend work that hasn't happened). Checking automatically
// on every launch would mean every user hits a guaranteed DNS failure for a
// domain that doesn't exist, so this only wires up listeners; the actual
// network check happens on demand (see checkForUpdates), e.g. when the user
// clicks the "Update App" pill.
function initAutoUpdate() {
  autoUpdater.autoDownload = false;

  autoUpdater.on('checking-for-update', () => send('update:status', { status: 'checking' }));
  autoUpdater.on('update-available', (info) => send('update:status', { status: 'available', info }));
  autoUpdater.on('update-not-available', () => send('update:status', { status: 'idle' }));
  autoUpdater.on('download-progress', (progress) => send('update:status', { status: 'downloading', progress }));
  autoUpdater.on('update-downloaded', () => send('update:status', { status: 'ready' }));
  autoUpdater.on('error', (err) => send('update:status', { status: 'error', error: err.message }));
}

async function checkForUpdates() {
  try {
    return await autoUpdater.checkForUpdates();
  } catch (err) {
    console.error('[auto-update] check failed (no update feed configured yet?):', err.message);
    send('update:status', { status: 'error', error: err.message });
    return null;
  }
}

function downloadUpdate() {
  return autoUpdater.downloadUpdate();
}

function quitAndInstall() {
  markQuitting();
  autoUpdater.quitAndInstall();
}

module.exports = { initAutoUpdate, checkForUpdates, downloadUpdate, quitAndInstall };
