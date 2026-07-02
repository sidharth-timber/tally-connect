function formatRelativeSync(lastSyncedAt) {
  if (!lastSyncedAt) return { text: 'Never synced', cls: 'stale' };
  const diffMs = Date.now() - new Date(lastSyncedAt).getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const mins = Math.floor(diffMs / (60 * 1000));

  let text;
  if (days >= 1) text = `Synced ${days} day${days === 1 ? '' : 's'} ago`;
  else if (hours >= 1) text = `Synced ${hours} hour${hours === 1 ? '' : 's'} ago`;
  else if (mins >= 1) text = `Synced ${mins} min${mins === 1 ? '' : 's'} ago`;
  else text = 'Synced just now';

  const cls = days >= 2 ? 'stale' : 'ok';
  return { text, cls };
}

export function renderCompanyRow(company, { onWebView, onSync }) {
  const row = document.createElement('div');
  row.className = 'company-row';

  const info = document.createElement('div');
  info.className = 'company-info';

  const name = document.createElement('div');
  name.className = 'company-name';
  name.textContent = company.tally_company_name;
  info.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'company-meta';
  meta.textContent = [company.gstin, company.state].filter(Boolean).join(' · ') || 'No GSTIN on file';
  info.appendChild(meta);

  const side = document.createElement('div');
  side.className = 'company-side';

  // The only thing that triggers a real invoice/bill/payment/expense/pull
  // webhook call — nothing syncs automatically in the background anymore.
  const syncBtn = document.createElement('button');
  syncBtn.className = 'pill-button';
  syncBtn.textContent = company.syncing ? 'Syncing…' : '↻ Sync';
  syncBtn.disabled = !!company.syncing;
  syncBtn.addEventListener('click', () => onSync(company.company_id));

  const webViewBtn = document.createElement('button');
  webViewBtn.className = 'pill-button';
  webViewBtn.textContent = '🌐 Web View';
  webViewBtn.addEventListener('click', () => onWebView(company.company_id));

  const menuBtn = document.createElement('button');
  menuBtn.className = 'icon-button';
  menuBtn.textContent = '⋮';

  const syncStatus = company.syncing
    ? { text: 'Syncing…', cls: 'ok' }
    : company.lastSyncStatus === 'error'
      ? { text: 'Sync failed', cls: 'error' }
      : formatRelativeSync(company.lastSyncedAt);

  const syncTime = document.createElement('span');
  syncTime.className = `sync-time ${syncStatus.cls}`;
  syncTime.textContent = syncStatus.text;
  if (company.lastSyncError) syncTime.title = company.lastSyncError;

  side.appendChild(syncBtn);
  side.appendChild(webViewBtn);
  side.appendChild(menuBtn);

  row.appendChild(info);
  row.appendChild(syncTime);
  row.appendChild(side);

  return row;
}
