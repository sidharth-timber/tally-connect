const { Tray, Menu, app } = require('electron');
const path = require('path');
const { getMainWindow, markQuitting } = require('./window');

let tray = null;

function showAndFocus() {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray(engine) {
  tray = new Tray(path.join(__dirname, '../renderer/assets/tray-icon.png'));
  tray.setToolTip('Timber TallyAgent');

  function buildMenu() {
    const state = engine.getState();
    const statusLabel = state.connection.tallyReachable ? 'Tally: Connected' : 'Tally: Not detected';
    return Menu.buildFromTemplate([
      { label: 'Open TallyAgent', click: showAndFocus },
      { label: 'Refresh Company List', click: () => engine.refresh() },
      { type: 'separator' },
      { label: statusLabel, enabled: false },
      { type: 'separator' },
      {
        label: 'Quit Timber TallyAgent',
        click: () => {
          markQuitting();
          app.quit();
        },
      },
    ]);
  }

  tray.setContextMenu(buildMenu());
  tray.on('click', showAndFocus);
  engine.on('state-changed', () => tray.setContextMenu(buildMenu()));

  return tray;
}

module.exports = { createTray };
