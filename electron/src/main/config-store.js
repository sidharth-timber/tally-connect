const Store = require('electron-store');

const store = new Store({
  name: 'config',
  schema: {
    caKey: { type: 'string', default: '' },
    // Matches the SERVER_URL the old installer.iss wrote into .env — this is
    // the real webhook endpoint the backend exposes, not a placeholder.
    serverUrl: { type: 'string', default: 'http://localhost:6010/api/v1/user/webhook/tally' },
    hasCompletedSetup: { type: 'boolean', default: false },
    // Set by an explicit logout so the startup legacy-service migration does
    // not quietly re-import an old key and log the user straight back in.
    loggedOut: { type: 'boolean', default: false },
    companies: { type: 'array', default: [] },
    // Per Timber company: the last date (YYYYMMDD) whose Tally vouchers have been imported, so the
    // pull only reads what is new instead of re-reading history.
    pullCursors: { type: 'object', default: {} },
    windowBounds: { type: 'object', default: {} },
  },
});

module.exports = store;
