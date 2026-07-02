export function initTitlebar({ onMinimize, onClose, onMenu, onUpdateClick }) {
  document.getElementById('minimize-button').addEventListener('click', onMinimize);
  document.getElementById('close-button').addEventListener('click', onClose);
  document.getElementById('menu-button').addEventListener('click', onMenu);
  document.getElementById('update-button').addEventListener('click', onUpdateClick);
}

// updateStatus: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
export function renderUpdateButton(updateStatus) {
  const btn = document.getElementById('update-button');
  btn.classList.remove('hidden');
  btn.innerHTML = '';

  const labels = {
    idle: 'Download App',
    checking: 'Checking…',
    available: 'Update App',
    downloading: 'Downloading…',
    ready: 'Restart to Update',
    error: 'Update App',
  };
  btn.textContent = labels[updateStatus] || 'Download App';

  if (updateStatus === 'available' || updateStatus === 'ready') {
    const dot = document.createElement('span');
    dot.className = 'dot';
    btn.appendChild(dot);
  }

  btn.disabled = updateStatus === 'checking' || updateStatus === 'downloading';
}
