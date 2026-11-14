// Processus principal Electron : fenêtre, protocoles, stockage, Scryfall.

import { app, BrowserWindow, ipcMain, protocol, net, dialog, shell, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Storage, CardCache } from './storage.js';
import { ImageCache } from './images.js';
import { ScryfallClient } from './scryfall.js';
import { resolveItems, MemoryCache } from './resolve.js';
import { SpellbookClient, slimSpellbook } from './spellbook.js';
import { initUpdater } from './updater.js';
import { imagesOf } from '../shared/normalize.js';
import { normalizeName } from '../shared/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..');

if (process.env.MTG_USERDATA) app.setPath('userData', process.env.MTG_USERDATA);
const API_BASE = process.env.MTG_SCRYFALL_BASE || 'https://api.scryfall.com';
const CSB_BASE = process.env.MTG_CSB_BASE || 'https://backend.commanderspellbook.com';
const IMAGE_ALLOWED = ['scryfall.io', 'scryfall.com', ...(process.env.MTG_IMAGE_ORIGINS ? process.env.MTG_IMAGE_ORIGINS.split(',') : [])];

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'mtgimg', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let storage; let cardCache; let images; let client; let spellbook; let updater;
let closeReady = false;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function registerProtocols() {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(SRC, rel));
    const okRoots = [path.join(SRC, 'renderer'), path.join(SRC, 'shared')];
    if (!okRoots.some((r) => file.startsWith(r + path.sep))) return new Response('Interdit', { status: 403 });
    try {
      const body = await fs.readFile(file);
      return new Response(body, { headers: { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' } });
    } catch { return new Response('Introuvable', { status: 404 }); }
  });
  protocol.handle('mtgimg', async (req) => {
    const u = new URL(req.url).searchParams.get('u');
    try {
      const { body, type } = await images.get(u);
      return new Response(body, { headers: { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=31536000' } });
    } catch (e) {
      return new Response('', { status: e.status || 502, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1024, minHeight: 640,
    backgroundColor: '#1D2433',
    title: 'MTG Deck Lab',
    show: false,
    icon: path.join(SRC, 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(SRC, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => { if (!process.env.MTG_E2E_HIDDEN) win.show(); });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  win.on('close', (e) => {
    if (closeReady) return;
    e.preventDefault();
    win.webContents.send('app:before-close');
    setTimeout(() => { closeReady = true; if (win && !win.isDestroyed()) win.close(); }, 4000);
  });
  win.loadURL('app://bundle/renderer/index.html');
}

function openExternalSafe(u) {
  try {
    const url = new URL(u);
    const ok = ['scryfall.com', 'commanderspellbook.com', 'github.com'].some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
    if (url.protocol === 'https:' && ok) shell.openExternal(u);
  } catch { /* ignoré */ }
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { return { ok: true, value: await fn(event, ...args) }; } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });
}

function registerIpc() {
  handle('app:info', () => ({ version: app.getVersion(), dataPath: app.getPath('userData'), platform: process.platform }));
  handle('app:close-ready', () => { closeReady = true; setImmediate(() => win && !win.isDestroyed() && win.close()); return true; });
  handle('settings:get', () => storage.getSettings());
  handle('settings:set', (_e, patch) => storage.setSettings(patch));

  handle('decks:list', () => storage.listDecks());
  handle('decks:load', (_e, id) => storage.loadDeck(id));
  handle('decks:save', (_e, deck) => storage.saveDeck(deck));
  handle('decks:newId', () => storage.newId());
  handle('decks:delete', (_e, id) => storage.deleteDeck(id, (f) => shell.trashItem(f)));
  handle('decks:importFile', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Importer un deck', filters: [{ name: 'Deck MTG Deck Lab', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const raw = JSON.parse(await fs.readFile(r.filePaths[0], 'utf8'));
    if (!raw || !Array.isArray(raw.entries) || typeof raw.cards !== 'object') throw new Error("Ce fichier n'est pas un deck MTG Deck Lab.");
    const existing = await storage.listDecks();
    const deck = { ...raw, id: storage.newId(), updatedAt: new Date().toISOString() };
    if (existing.some((d) => d.name === deck.name)) deck.name = `${deck.name} (importé)`;
    return storage.saveDeck(deck);
  });

  handle('dialog:openText', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Ouvrir une liste de cartes',
      filters: [{ name: 'Listes de cartes', extensions: ['txt', 'csv', 'dek', 'dec', 'tsv'] }, { name: 'Tous les fichiers', extensions: ['*'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const st = await fs.stat(r.filePaths[0]);
    if (st.size > 5 * 1024 * 1024) throw new Error('Fichier trop volumineux (5 Mo maximum).');
    return { name: path.basename(r.filePaths[0]), content: await fs.readFile(r.filePaths[0], 'utf8') };
  });
  handle('file:save', async (_e, { defaultName, filters, content, encoding }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, encoding === 'base64' ? Buffer.from(content, 'base64') : content, encoding === 'base64' ? undefined : 'utf8');
    return path.basename(r.filePath);
  });

  handle('shell:openExternal', (_e, u) => { openExternalSafe(u); return true; });
  handle('shell:openDataFolder', () => shell.openPath(app.getPath('userData')));

  handle('cache:info', () => storage.imagesCacheSize());
  handle('cache:clear', async () => { await storage.clearImages(); await cardCache.clear(); return true; });

  handle('scryfall:resolve', async (event, items, opts = {}) => {
    const r = await resolveItems(client, items, {
      wantFr: !!opts.wantFr, force: !!opts.force, cache: cardCache,
      onProgress: (p) => { if (!event.sender.isDestroyed()) event.sender.send('scryfall:progress', p); },
    });
    return { resolved: [...r.resolved.entries()], unresolved: r.unresolved, viaFrench: r.viaFrench };
  });
  handle('scryfall:autocomplete', (_e, q) => (q && q.trim().length >= 2 ? client.autocomplete(q.trim()) : []));
  handle('cache:searchNames', (_e, q) => {
    const n = normalizeName(q || '');
    if (n.length < 2) return [];
    const seen = new Set(); const starts = []; const contains = [];
    for (const c of Object.values(cardCache.data.cards)) {
      if (seen.has(c.oracleId)) continue;
      for (const label of [c.printedName, c.name]) {
        if (!label) continue;
        const ln = normalizeName(label);
        if (ln.startsWith(n)) { starts.push({ name: c.name, label }); seen.add(c.oracleId); break; }
        if (ln.includes(n)) { contains.push({ name: c.name, label }); seen.add(c.oracleId); break; }
      }
    }
    return [...starts, ...contains].slice(0, 8);
  });
  handle('scryfall:prints', async (_e, { oracleId, printsUri }) => {
    if (!/^[0-9a-f-]{36}$/i.test(String(oracleId))) throw new Error('Carte invalide');
    let base = `${API_BASE}/cards/search?order=released&unique=prints&q=${encodeURIComponent(`oracleid:${oracleId}`)}`;
    if (printsUri && String(printsUri).startsWith(`${API_BASE}/`)) base = printsUri;
    const withLang = new URL(base);
    withLang.searchParams.set('include_multilingual', 'true');
    withLang.searchParams.set('q', `${withLang.searchParams.get('q')} (lang:en or lang:fr)`);
    let list = await client.pages(withLang.toString(), 4);
    if (!list.length) { const u = new URL(base); u.searchParams.set('include_multilingual', 'true'); list = await client.pages(u.toString(), 4); }
    return list.filter((c) => c.lang === 'en' || c.lang === 'fr').map((c) => ({
      id: c.id, oracleId: c.oracle_id, lang: c.lang, set: c.set, setName: c.set_name, cn: c.collector_number, released: c.released_at || '',
      printedName: c.printed_name || (c.card_faces || []).map((f) => f.printed_name).filter(Boolean).join(' // ') || null,
      images: imagesOf(c),
    })).filter((p) => p.images && p.images.length && p.oracleId === oracleId);
  });
  handle('spellbook:analyze', async (_e, deckRequest) => {
    const clean = {
      main: (deckRequest.main || []).slice(0, 250).map((c) => ({ card: String(c.card), quantity: Math.max(1, Math.min(250, Number(c.quantity) || 1)) })),
      commanders: (deckRequest.commanders || []).slice(0, 2).map((c) => ({ card: String(c.card), quantity: 1 })),
    };
    const combos = await spellbook.findMyCombos(clean);
    let bracket = null;
    try { bracket = await spellbook.estimateBracket(clean); } catch { bracket = null; }
    return slimSpellbook(combos, bracket);
  });
  handle('versions:list', (_e, deckId) => storage.listVersions(deckId));
  handle('versions:save', (_e, deckId, payload) => storage.saveVersion(deckId, payload));
  handle('versions:load', (_e, deckId, vid) => storage.loadVersion(deckId, vid));
  handle('versions:delete', (_e, deckId, vid) => storage.deleteVersion(deckId, vid));
  handle('collection:get', () => storage.getCollection());
  handle('decks:usage', () => storage.deckUsage());
  handle('collection:save', (_e, c) => storage.saveCollection(c));
  handle('update:support', () => ({ ...updater.support, version: app.getVersion() }));
  handle('update:check', () => updater.check());
  handle('update:download', () => updater.download());
  handle('update:install', () => { updater.install(); return true; });
  handle('scryfall:symbology', async () => {
    const file = path.join(storage.cacheDir, 'symbology.json');
    try {
      const c = JSON.parse(await fs.readFile(file, 'utf8'));
      if (Date.now() - c.at < 30 * 24 * 3600 * 1000 && c.base === API_BASE) return c.map;
    } catch { /* à télécharger */ }
    const list = await client.symbology();
    const map = Object.fromEntries(list.filter((s) => s.svg_uri).map((s) => [s.symbol, s.svg_uri]));
    await fs.writeFile(file, JSON.stringify({ at: Date.now(), base: API_BASE, map }));
    return map;
  });
  handle('scryfall:diagnose', async () => {
    const steps = [];
    const t0 = Date.now();
    const step = async (label, fn) => {
      const t = Date.now();
      try { const detail = await fn(); steps.push({ label, ok: true, detail, ms: Date.now() - t }); } catch (e) { steps.push({ label, ok: false, detail: e.message, ms: Date.now() - t }); }
    };
    const mem = new MemoryCache();
    await step('Connexion à Scryfall et recherche par nom anglais (Lightning Bolt)', async () => {
      const { data } = await client.collection([{ name: 'Lightning Bolt' }]);
      if (!data.length) throw new Error('Carte non trouvée');
      return `${data[0].name} (${data[0].set.toUpperCase()})`;
    });
    await step('Impression française d\'une carte anglaise', async () => {
      const res = await client.search('!"Lightning Bolt" lang:fr', { unique: 'prints', multilingual: true, maxPages: 1 });
      const fr = res.find((c) => c.lang === 'fr');
      if (!fr) throw new Error('Aucune impression française renvoyée');
      return `Nom imprimé : ${fr.printed_name || '(absent)'}`;
    });
    await step('Recherche par nom français (Foudre)', async () => {
      const r = await resolveItems(client, [{ name: 'Foudre' }], { wantFr: false, cache: mem });
      const c = [...r.resolved.values()][0];
      if (!c) throw new Error('Le nom français n\'a pas été reconnu');
      return `Foudre → ${c.name}`;
    });
    return { steps, ms: Date.now() - t0 };
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  storage = new Storage(app.getPath('userData'));
  await storage.init();
  cardCache = new CardCache(storage.cacheDir);
  await cardCache.load();
  client = new ScryfallClient({ fetchImpl: (u, o) => net.fetch(u, o), base: API_BASE, userAgent: `MTGDeckLab/${app.getVersion()}` });
  spellbook = new SpellbookClient({ fetchImpl: (u, o) => net.fetch(u, o), base: CSB_BASE, userAgent: `MTGDeckLab/${app.getVersion()}` });
  updater = initUpdater({ app, fetchImpl: (u, o) => net.fetch(u, o), send: (s) => { if (win && !win.isDestroyed()) win.webContents.send('update:event', s); } });
  images = new ImageCache({ dir: storage.imagesDir, fetchImpl: (u) => net.fetch(u, { headers: { 'User-Agent': `MTGDeckLab/${app.getVersion()}`, Accept: 'image/*' } }), allowedHosts: IMAGE_ALLOWED });
  registerProtocols();
  registerIpc();
  createWindow();
  storage.getSettings().then((s) => {
    if (s.autoUpdateCheck !== false && updater.support.ok && !process.env.MTG_E2E) setTimeout(() => updater.check(), 8000);
  }).catch(() => {});
  if (process.env.MTG_E2E) {
    const mod = await import(pathToFileURL(path.resolve(process.env.MTG_E2E)).href);
    win.webContents.once('did-finish-load', () => mod.default({ win, app }).catch((e) => { console.error('E2E', e); app.exit(1); }));
  }
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', async () => { try { await cardCache.flush(); } catch { /* ignoré */ } app.quit(); });
