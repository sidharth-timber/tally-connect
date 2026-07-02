// Runs the sync engine standalone under plain Node, no Electron required.
// Lets Phase 1 (extracting agent.js into sync-engine/**) be verified against
// a real Tally Prime instance + the dev mock backend (src/server.js) before
// any Electron code exists.
//
// Usage: SERVER_URL=http://localhost:3000 CA_KEY=xxx node scripts/sync-engine-cli.js
require('dotenv').config();
const { createSyncEngine } = require('../src/sync-engine');

const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
const caKey = process.env.CA_KEY;

if (!caKey) {
  console.error('Set CA_KEY in the environment (or electron/.env) before running this harness.');
  process.exit(1);
}

const engine = createSyncEngine({ serverUrl, caKey, agentVersion: require('../package.json').version });

engine.on('state-changed', (state) => {
  console.log('--- state-changed ---');
  console.log(JSON.stringify(state, null, 2));
});

engine.start().catch((err) => {
  console.error('Failed to start sync engine:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  engine.stop();
  process.exit(0);
});
