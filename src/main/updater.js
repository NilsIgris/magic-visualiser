// Mises à jour automatiques via GitHub Releases (electron-updater).
// Actives seulement dans la version installée (installateur Windows ou AppImage Linux)
// et si le build a été configuré avec un dépôt (release.config.json → app-update.yml).

import fs from 'node:fs';
import path from 'node:path';
import updaterPkg from 'electron-updater';
import { newerVersion } from '../shared/version.js';

const { autoUpdater } = updaterPkg;

export function updateSupport(app) {
  if (!app.isPackaged) return { ok: false, reason: 'dev', text: 'Les mises à jour ne concernent que la version installée.' };
  const yml = path.join(process.resourcesPath, 'app-update.yml');
  if (!fs.existsSync(yml)) return { ok: false, reason: 'unconfigured', text: 'Aucun dépôt de mise à jour n\'est configuré dans cette version (voir LISEZMOI, section Mises à jour).' };
  if (process.platform === 'win32') {
    const dir = path.dirname(process.execPath);
    const installed = fs.readdirSync(dir).some((f) => /^Uninstall .*\.exe$/i.test(f));
    if (!installed) return { ok: true, install: false, reason: 'portable', text: 'Version portable : les nouvelles versions sont signalées, à installer avec l\'installateur.' };
    return { ok: true, install: true };
  }
  if (process.platform === 'linux') {
    if (!process.env.APPIMAGE) return { ok: true, install: false, reason: 'portable', text: 'Archive Linux : les nouvelles versions sont signalées. L\'AppImage se met à jour seule.' };
    return { ok: true, install: true };
  }
  return { ok: true, install: false, reason: 'platform', text: '' };
}

/** Dépôt configuré dans app-update.yml (écrit par electron-builder). */
function repoInfo() {
  try {
    const t = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const get = (k) => ((t.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1] || '').trim().replace(/^['"]|['"]$/g, '');
    return get('provider') === 'github' && get('owner') && get('repo') ? { owner: get('owner'), repo: get('repo') } : null;
  } catch { return null; }
}


export function initUpdater({ app, send, fetchImpl }) {
  const support = updateSupport(app);
  // Versions portables (archive Linux) : electron-updater ne vérifie pas, on interroge directement GitHub.
  const manualCheck = async () => {
    const repo = repoInfo();
    if (!repo) return { state: 'unsupported', text: support.text };
    const res = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `MTGDeckLab/${app.getVersion()}` } });
    if (res.status === 404) return { state: 'error', message: 'Aucune version publiée n\'a été trouvée sur le dépôt.' };
    if (!res.ok) return { state: 'error', message: `GitHub a répondu ${res.status}.` };
    const j = await res.json();
    const v = String(j.tag_name || '').replace(/^v/, '');
    const out = newerVersion(v, app.getVersion()) ? { state: 'available', version: v, canInstall: false, url: j.html_url } : { state: 'none', version: v };
    if (out.state === 'available') send(out);
    return out;
  };
  let lastInfo = null;
  if (support.ok) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;
    autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
    autoUpdater.on('update-available', (info) => {
      lastInfo = info;
      const repo = repoInfo();
      send({ state: 'available', version: info.version, canInstall: support.install, releaseName: info.releaseName || '', url: repo ? `https://github.com/${repo.owner}/${repo.repo}/releases/latest` : null });
    });
    autoUpdater.on('update-not-available', (info) => send({ state: 'none', version: info.version }));
    autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }));
    autoUpdater.on('error', (e) => send({ state: 'error', message: friendly(e) }));
  }
  return {
    support,
    async check() {
      if (!support.ok) return { state: 'unsupported', text: support.text };
      try {
        const r = await autoUpdater.checkForUpdates();
        if (!r) return await manualCheck();
        const v = r.updateInfo ? r.updateInfo.version : null;
        return { state: v && newerVersion(v, app.getVersion()) ? 'available' : 'none', version: v };
      } catch (e) { return { state: 'error', message: friendly(e) }; }
    },
    async download() {
      if (!support.ok || !support.install) throw new Error(support.text || 'Mise à jour automatique indisponible.');
      await autoUpdater.downloadUpdate();
      return true;
    },
    install() { if (support.ok && support.install) autoUpdater.quitAndInstall(false, true); },
    lastInfo: () => lastInfo,
  };
}

function friendly(e) {
  const m = String((e && e.message) || e);
  if (/404|Cannot find latest|No published versions/i.test(m)) return 'Aucune version publiée n\'a été trouvée sur le dépôt.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/i.test(m)) return 'Pas de connexion au serveur de mises à jour.';
  return m.split('\n')[0].slice(0, 200);
}
