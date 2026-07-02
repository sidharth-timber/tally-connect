// Deletes the app's persisted config + Chromium cache so the next launch
// shows the first-run setup screen again. Mirrors Electron's own userData
// path resolution (%APPDATA%\<productName> on Windows) rather than
// hardcoding it, so it stays correct if productName ever changes.
const fs = require('fs');
const path = require('path');
const os = require('os');

const pkg = require('../package.json');
const appName = pkg.productName || pkg.name;

function resolveUserDataDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName);
  }
  return path.join(os.homedir(), '.config', appName);
}

const userDataDir = resolveUserDataDir();

if (!userDataDir.includes(appName)) {
  console.error('Refusing to delete — resolved path looks wrong:', userDataDir);
  process.exit(1);
}

if (!fs.existsSync(userDataDir)) {
  console.log('Nothing to reset — no userData folder found at', userDataDir);
  process.exit(0);
}

fs.rmSync(userDataDir, { recursive: true, force: true });
console.log('Reset complete — deleted', userDataDir);
console.log('Next launch will show the first-run setup screen again.');
