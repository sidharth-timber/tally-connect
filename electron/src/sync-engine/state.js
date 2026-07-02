// Shape of the state object exposed to the renderer via IPC (see electron/src/main/ipc.js).
function createInitialState(agentVersion) {
  return {
    connection: { tallyReachable: false, tallyVersion: null, lastCheckedAt: null },
    companies: [],
    agentVersion,
    latestVersion: null,
    downloadUrl: null,
    updateStatus: 'idle', // 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
  };
}

module.exports = { createInitialState };
