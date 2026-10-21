const { dialog, Menu, app } = require('electron');
const { getMainWindow, markQuitting } = require('./window');
const { hasCompletedSetup } = require('./firstRun');
const store = require('./config-store');

// Asks for confirmation, then forgets the Agent Key on this computer, stops
// syncing and sends the window back to the setup screen. Nothing is deleted
// in Timber or Tally — the same key (or a new one) connects again.
async function performLogout(engine) {
  const win = getMainWindow();
  const options = {
    type: 'question',
    buttons: ['Log out', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Log out',
    message: 'Log out of Timber TallyAgent?',
    detail:
      'Syncing will stop and the Agent Key will be removed from this computer. ' +
      'Your data in Timber and Tally is not affected. Enter an Agent Key to connect again.',
  };
  const { response } = win && !win.isDestroyed()
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (response !== 0) return { ok: false, cancelled: true };

  engine.logout();
  store.set('caKey', '');
  store.set('hasCompletedSetup', false);
  store.set('companies', []);
  store.set('pullCursors', {}); // a different account must not inherit this one's progress
  store.set('loggedOut', true);

  const current = getMainWindow();
  if (current && !current.isDestroyed()) {
    current.webContents.send('auth:logged-out');
    current.show();
    current.focus();
  }
  return { ok: true };
}

// Native overflow menu behind the title bar's ⋮ button.
function showAppMenu(engine) {
  const loggedIn = hasCompletedSetup();
  const menu = Menu.buildFromTemplate([
    { label: 'Refresh company list', enabled: loggedIn, click: () => engine.refresh() },
    { type: 'separator' },
    { label: 'Log out…', enabled: loggedIn, click: () => performLogout(engine) },
    { type: 'separator' },
    {
      label: 'Quit Timber TallyAgent',
      click: () => {
        markQuitting();
        app.quit();
      },
    },
  ]);
  const win = getMainWindow();
  menu.popup(win && !win.isDestroyed() ? { window: win } : undefined);
}

module.exports = { performLogout, showAppMenu };
