// Activity log: what the agent is doing and why something failed. History comes from the main
// process (seeded from sync.log, so it survives restarts); new lines stream in while it's open.
const MAX_LINES = 1000;

let entries = [];
let filter = 'all'; // 'all' | 'issues'
let unsubscribe = null;

const panelEl = () => document.getElementById('logs-panel');
const listEl = () => document.getElementById('logs-list');

function pad(n) { return String(n).padStart(2, '0'); }

function timeOf(ts) {
  const d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function dayOf(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function visible(entry) {
  return filter === 'all' || entry.level === 'error' || entry.level === 'warn';
}

function lineEl(entry) {
  const row = document.createElement('div');
  row.className = 'log-line ' + entry.level;
  const t = document.createElement('span');
  t.className = 'log-time';
  t.textContent = timeOf(entry.ts);
  t.title = dayOf(entry.ts) + ' ' + timeOf(entry.ts);
  const m = document.createElement('span');
  m.className = 'log-msg';
  m.textContent = entry.message;
  row.append(t, m);
  return row;
}

function atBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 24;
}

function renderAll() {
  const list = listEl();
  list.innerHTML = '';
  const shown = entries.filter(visible);
  if (shown.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'log-empty';
    empty.textContent = filter === 'issues'
      ? 'No errors or warnings.'
      : 'Nothing logged yet. Click Sync on a company to see activity here.';
    list.appendChild(empty);
    return;
  }
  for (const e of shown) list.appendChild(lineEl(e));
  list.scrollTop = list.scrollHeight;
}

function addEntry(entry) {
  entries.push(entry);
  if (entries.length > MAX_LINES) entries.shift();
  if (panelEl().classList.contains('hidden') || !visible(entry)) return;
  const list = listEl();
  const stick = atBottom(list);
  if (list.querySelector('.log-empty')) list.innerHTML = '';
  list.appendChild(lineEl(entry));
  while (list.childElementCount > MAX_LINES) list.removeChild(list.firstChild);
  if (stick) list.scrollTop = list.scrollHeight;
}

function asText() {
  return entries.filter(visible).map(e => e.ts + ' [' + e.level + '] ' + e.message).join('\n');
}

export function initLogsPanel({ onClose }) {
  document.getElementById('logs-back').addEventListener('click', onClose);
  document.getElementById('logs-filter').addEventListener('change', (ev) => {
    filter = ev.target.value;
    renderAll();
  });
  document.getElementById('logs-copy').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    try { await navigator.clipboard.writeText(asText()); btn.textContent = 'Copied'; }
    catch { btn.textContent = 'Copy failed'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
  document.getElementById('logs-open').addEventListener('click', () => window.tallyAgent.openLogFile());
  document.getElementById('logs-clear').addEventListener('click', () => { entries = []; renderAll(); });
}

export async function showLogsPanel(show) {
  panelEl().classList.toggle('hidden', !show);
  if (!show) {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    return;
  }
  entries = await window.tallyAgent.getLogs();
  renderAll();
  if (!unsubscribe) unsubscribe = window.tallyAgent.onLogEntry(addEntry);
}
