// One-time migration: stops and removes any pre-existing TallyAgent Windows
// Service install (the old node-windows/`install-service.js` model) so it
// doesn't keep polling Tally/the backend alongside the new Electron app,
// which would double-sync every invoice/bill/payment.
//
// Deliberately uses plain `sc.exe` instead of the `node-windows` package —
// the old service's daemon wrapper files may already be gone, and this way
// the Electron app doesn't need node-windows as a runtime dependency just
// for a one-time migration step.
//
// Usage:
//   node migrate-from-service.js            — run migration, print JSON result
//   require('./migrate-from-service')        — programmatic use (see exports)
//
// Requires admin privileges to stop/delete a Windows Service. When invoked
// from the NSIS installer's customInstall hook, the installer step running
// this should request elevation; when invoked from the running Electron app
// (fallback, in case the installer skipped it or ran unelevated), failures
// are logged and swallowed rather than blocking app startup.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function listTallyAgentServices() {
  let output;
  try {
    output = execFileSync('sc', ['query', 'state=', 'all'], { encoding: 'utf8' });
  } catch (err) {
    console.error('[migrate] sc query failed:', err.message);
    return [];
  }
  const names = [];
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/SERVICE_NAME:\s*(TallyAgent-\S+)/i);
    if (m) names.push(m[1]);
  }
  return names;
}

function stopAndDeleteService(name) {
  try {
    execFileSync('sc', ['stop', name], { encoding: 'utf8' });
  } catch (err) {
    // Not running is fine — sc returns non-zero if already stopped.
  }
  try {
    execFileSync('sc', ['delete', name], { encoding: 'utf8' });
    return { name, removed: true };
  } catch (err) {
    return { name, removed: false, error: err.message };
  }
}

// The old installer.iss defaulted to {pf}\TallyAgent (DefaultDirName).
function findLegacyEnv() {
  const candidates = [
    process.env['ProgramFiles'] && path.join(process.env['ProgramFiles'], 'TallyAgent', '.env'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'TallyAgent', '.env'),
  ].filter(Boolean);

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const caKeyMatch = content.match(/^CA_KEY=(.*)$/m);
      const serverUrlMatch = content.match(/^SERVER_URL=(.*)$/m);
      return {
        envPath,
        caKey: caKeyMatch ? caKeyMatch[1].trim() : null,
        serverUrl: serverUrlMatch ? serverUrlMatch[1].trim() : null,
      };
    }
  }
  return null;
}

function migrate() {
  const services = listTallyAgentServices();
  const results = services.map(stopAndDeleteService);
  const legacyConfig = findLegacyEnv();
  return { servicesFound: services.length, results, legacyConfig };
}

module.exports = { migrate, listTallyAgentServices, findLegacyEnv };

if (require.main === module) {
  const result = migrate();
  console.log(JSON.stringify(result, null, 2));
}
