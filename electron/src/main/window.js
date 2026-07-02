const { BrowserWindow } = require('electron');
const path = require('path');
const store = require('./config-store');

let mainWindow = null;
let isQuitting = false;

function markQuitting() {
  isQuitting = true;
}

function isAppQuitting() {
  return isQuitting;
}

function createMainWindow() {
  const bounds = store.get('windowBounds');
  mainWindow = new BrowserWindow({
    width: bounds.width || 575,
    height: bounds.height || 520,
    x: bounds.x,
    y: bounds.y,
    resizable: false,
    frame: false,
    show: false,
    icon: path.join(__dirname, '../renderer/assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    } else {
      const { width, height, x, y } = mainWindow.getBounds();
      store.set('windowBounds', { width, height, x, y });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function getMainWindow() {
  return mainWindow;
}

module.exports = { createMainWindow, getMainWindow, markQuitting, isAppQuitting };
