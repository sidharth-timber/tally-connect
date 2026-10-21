// The packaged app has no visible console, so failures during a sync
// (a ledger Tally refused, a request that never answered) used to vanish.
// Everything goes to the console, to <userData>/sync.log (rotated at 2 MB) and into an
// in-memory buffer the app's Logs view reads and follows live.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const MAX_BUFFER = 1000;
const TAIL_BYTES = 128 * 1024;

const events = new EventEmitter();
let buffer = [];
let loadedFromFile = false;

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

// First read of the buffer after a restart also shows what happened before it.
function loadTail() {
  if (loadedFromFile) return;
  loadedFromFile = true;
  const file = logFile();
  if (!file) return;
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    if (size > len) lines.shift(); // first line is probably cut off
    const earlier = [];
    for (const line of lines) {
      const m = line.match(/^(\S+) \[(info|warn|error)\] ([\s\S]*)$/);
      if (m) earlier.push({ ts: m[1], level: m[2], message: m[3] });
    }
    buffer = earlier.concat(buffer).slice(-MAX_BUFFER);
  } catch {
    // no log file yet
  }
}

function write(level, args) {
  (level === 'error' ? console.error : console.log)(...args);
  const entry = { ts: new Date().toISOString(), level, message: args.map(format).join(' ') };
  loadTail();
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  try { events.emit('entry', entry); } catch { /* a listener must never break a sync */ }
  const file = logFile();
  if (!file) return;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + '.1');
    fs.appendFileSync(file, entry.ts + ' [' + level + '] ' + entry.message + '\n');
  } catch {
    // never let logging break a sync
  }
}

module.exports = {
  log: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
  events,
  getRecent: () => { loadTail(); return buffer.slice(); },
  getLogFilePath: logFile,
};
