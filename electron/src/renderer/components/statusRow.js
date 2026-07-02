export function initStatusRow({ onRefresh }) {
  document.getElementById('refresh-link').addEventListener('click', onRefresh);
}

export function renderStatusRow(connection) {
  const row = document.getElementById('status-row');
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');

  row.classList.remove('hidden');

  if (connection.tallyReachable) {
    dot.classList.remove('disconnected');
    const versionSuffix = connection.tallyVersion ? ` (${connection.tallyVersion})` : '';
    label.textContent = `TALLY Connected${versionSuffix}`;
  } else {
    dot.classList.add('disconnected');
    label.textContent = 'Tally Not Detected';
  }
}
