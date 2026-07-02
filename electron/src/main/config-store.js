const Store = require('electron-store');

const store = new Store({
  name: 'config',
  schema: {
    caKey: { type: 'string', default: '' },
    // Matches the SERVER_URL the old installer.iss wrote into .env — this is
    // the real webhook endpoint the backend exposes, not a placeholder.
    serverUrl: { type: 'string', default: 'http://localhost:6010/api/v1/user/webhook/tally' },
    hasCompletedSetup: { type: 'boolean', default: false },
    companies: { type: 'array', default: [] },
    windowBounds: { type: 'object', default: {} },
  },
});

module.exports = store;
