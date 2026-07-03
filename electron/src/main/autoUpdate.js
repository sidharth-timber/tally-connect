const { app } = require('electron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { markQuitting } = require('./window');

// Updates don't use electron-updater / a static latest.yml feed: the admin
// uploads the new installer exe to storage, and the backend hands its URL to
// the agent in the agent-init response (agent_download_url → state.downloadUrl).
// This downloads that exe and, on "Restart to Update", runs it silently —
// same flow the legacy service agent used (see src/templates/agent.js).

let downloadedInstallerPath = null;
let downloading = false;

// onStatus receives the same payload shape the renderer's update pill expects:
// { status: 'downloading'|'ready'|'error', progress?, error? }
async function downloadUpdate(downloadUrl, onStatus = () => {}) {
  if (downloading) return { ok: false, error: 'Download already in progress' };
  if (!downloadUrl) {
    const error = 'No download URL provided by server yet.';
    onStatus({ status: 'error', error });
    return { ok: false, error };
  }

  downloading = true;
  const dir = path.join(app.getPath('userData'), 'updates');
  const dest = path.join(dir, 'TallyAgent-Setup.exe');
  try {
    fs.mkdirSync(dir, { recursive: true });
    onStatus({ status: 'downloading', progress: { percent: 0 } });

    const res = await axios.get(downloadUrl, { responseType: 'stream', timeout: 10 * 60 * 1000 });
    const total = parseInt(res.headers['content-length'], 10) || 0;
    let transferred = 0;
    let lastPercent = -1;

    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(dest);
      res.data.on('data', (chunk) => {
        transferred += chunk.length;
        if (total > 0) {
          const percent = Math.floor((transferred / total) * 100);
          if (percent !== lastPercent) {
            lastPercent = percent;
            onStatus({ status: 'downloading', progress: { percent, transferred, total } });
          }
        }
      });
      res.data.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      res.data.pipe(out);
    });

    downloadedInstallerPath = dest;
    onStatus({ status: 'ready' });
    return { ok: true, path: dest };
  } catch (err) {
    try { fs.unlinkSync(dest); } catch (_) {}
    console.error('[auto-update] download failed:', err.message);
    onStatus({ status: 'error', error: err.message });
    return { ok: false, error: err.message };
  } finally {
    downloading = false;
  }
}

function quitAndInstall() {
  if (!downloadedInstallerPath) return;
  markQuitting();
  // electron-builder NSIS installers accept /S (silent) and --force-run
  // (relaunch the app once the install finishes).
  spawn(downloadedInstallerPath, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

module.exports = { downloadUpdate, quitAndInstall };
