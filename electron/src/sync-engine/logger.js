// The packaged app has no visible console, so failures during a sync
// (a ledger Tally refused, a request that never answered) used to vanish.
// Everything goes to the console AND to <userData>/sync.log (rotated at 2 MB).
const fs = require('fs');
const path = require('path');

function logFile() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'sync.log');
  } catch {
    return null; // CLI / tests: console only
  }
}

function format(a) {
  if (typeof a === 'string') return a;
  if (a && a.message) return a.message;
  try { return JSON.stringify(a); } catch { return String(a); }
}

function write(level, args) {
  (level === 'error' ? console.error : console.log)(...args);
  const file = logFile();
  if (!file) return;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + '.1');
    fs.appendFileSync(file, new Date().toISOString() + ' [' + level + '] ' + args.map(format).join(' ') + '\n');
  } catch {
    // never let logging break a sync
  }
}

module.exports = {
  log: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
};
