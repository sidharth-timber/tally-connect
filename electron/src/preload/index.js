const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tallyAgent', {
  getState: () => ipcRenderer.invoke('sync:get-state'),
  refresh: () => ipcRenderer.invoke('sync:refresh'),
  syncCompany: (companyId) => ipcRenderer.invoke('sync:company', companyId),
  onStateChanged: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('sync:state', handler);
    return () => ipcRenderer.removeListener('sync:state', handler);
  },

  getLogs: () => ipcRenderer.invoke('logs:get'),
  openLogFile: () => ipcRenderer.invoke('logs:open-file'),
  onLogEntry: (cb) => {
    const handler = (_e, entry) => cb(entry);
    ipcRenderer.on('logs:entry', handler);
    return () => ipcRenderer.removeListener('logs:entry', handler);
  },

  hasCompletedSetup: () => ipcRenderer.invoke('setup:has-completed'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  showMenu: () => ipcRenderer.send('menu:show'),
  onLoggedOut: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('auth:logged-out', handler);
    return () => ipcRenderer.removeListener('auth:logged-out', handler);
  },
  submitAgentKey: (key) => ipcRenderer.invoke('setup:submit-key', key),

  onUpdateStatus: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  quitAndInstall: () => ipcRenderer.send('update:quit-and-install'),

  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),

});
