// Stockage local : decks (un fichier JSON par deck), réglages, cache des cartes.
// Écriture atomique (fichier temporaire puis renommage) et copie de secours .bak.

import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DECK_SCHEMA = 1;

export const DEFAULT_SETTINGS = {
  imageLang: 'fr', // 'fr' = visuels VF quand ils existent, sinon VO
  nameLang: 'fr', // noms affichés
  hoverPreview: true,
  groupLinks: true, // regrouper les liens répétitifs
  hideWeak: true, // masquer les suggestions faibles non groupées
  tileSize: 150,
  boardGroup: 'type',
  graph: { layout: 'fcose', hideLands: true, hideIsolated: false, showPending: true, showRejected: false, kinds: null },
  lastDeckId: null,
  sidebarOpen: true,
};

async function atomicWrite(file, content) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  try {
    if (fss.existsSync(file)) await fs.copyFile(file, `${file}.bak`);
  } catch { /* la copie de secours n'est pas bloquante */ }
  await fs.rename(tmp, file);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    // fichier corrompu : tentative avec la copie de secours
    try { return JSON.parse(await fs.readFile(`${file}.bak`, 'utf8')); } catch { return fallback; }
  }
}

export class Storage {
  constructor(root) {
    this.root = root;
    this.decksDir = path.join(root, 'decks');
    this.cacheDir = path.join(root, 'cache');
    this.imagesDir = path.join(root, 'cache', 'images');
    this.settingsFile = path.join(root, 'settings.json');
    this.collectionFile = path.join(root, 'collection.json');
  }

  async init() {
    for (const d of [this.root, this.decksDir, this.cacheDir, this.imagesDir]) await fs.mkdir(d, { recursive: true });
  }

  deckFile(id) {
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) throw new Error('Identifiant de deck invalide');
    return path.join(this.decksDir, `${id}.json`);
  }

  async getSettings() {
    const s = await readJson(this.settingsFile, {});
    return { ...DEFAULT_SETTINGS, ...s, graph: { ...DEFAULT_SETTINGS.graph, ...(s.graph || {}) } };
  }

  async setSettings(patch) {
    const cur = await this.getSettings();
    const next = { ...cur, ...patch, graph: { ...cur.graph, ...(patch.graph || {}) } };
    await atomicWrite(this.settingsFile, JSON.stringify(next, null, 2));
    return next;
  }

  async listDecks() {
    const files = (await fs.readdir(this.decksDir)).filter((f) => f.endsWith('.json'));
    const out = [];
    for (const f of files) {
      const d = await readJson(path.join(this.decksDir, f), null);
      if (!d || !d.id) continue;
      out.push(summarize(d));
    }
    out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return out;
  }

  async loadDeck(id) {
    const d = await readJson(this.deckFile(id), null);
    if (!d) throw new Error('Deck introuvable');
    return d;
  }

  async saveDeck(deck) {
    if (!deck || !deck.id) throw new Error('Deck invalide');
    const d = { ...deck, schema: DECK_SCHEMA };
    await atomicWrite(this.deckFile(deck.id), JSON.stringify(d));
    return summarize(d);
  }

  async deleteDeck(id, trash) {
    const file = this.deckFile(id);
    if (trash) {
      try { await trash(file); } catch { await this.moveToLocalTrash(file); }
    } else await this.moveToLocalTrash(file);
    const vdir = this.versionsDir(id);
    if (fss.existsSync(vdir)) {
      if (trash) { try { await trash(vdir); } catch { await this.moveToLocalTrash(vdir); } } else await this.moveToLocalTrash(vdir);
    }
    for (const extra of [`${file}.bak`]) { try { await fs.unlink(extra); } catch { /* absent */ } }
  }

  async moveToLocalTrash(file) {
    const dir = path.join(this.root, 'corbeille');
    await fs.mkdir(dir, { recursive: true });
    await fs.rename(file, path.join(dir, `${Date.now()}-${path.basename(file)}`));
  }

  newId() { return crypto.randomUUID(); }

  // ---------------------------------------------------------------- versions
  versionsDir(deckId) { this.deckFile(deckId); return path.join(this.decksDir, `${deckId}.versions`); }

  async listVersions(deckId) {
    const dir = this.versionsDir(deckId);
    let files = [];
    try { files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')); } catch { return []; }
    const out = [];
    for (const f of files) {
      const v = await readJson(path.join(dir, f), null);
      if (!v || !v.vid) continue;
      out.push({ vid: v.vid, name: v.name, createdAt: v.createdAt, auto: !!v.auto, count: (v.deck.entries || []).filter((e) => e.zone === 'commander' || e.zone === 'main').reduce((s, e) => s + e.qty, 0) });
    }
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async saveVersion(deckId, { name, deck, auto = false }) {
    const dir = this.versionsDir(deckId);
    await fs.mkdir(dir, { recursive: true });
    const vid = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    const keep = { entries: deck.entries, cards: deck.cards, links: deck.links, piles: deck.piles, notes: deck.notes, cardNotes: deck.cardNotes, cardRoles: deck.cardRoles || {}, unresolved: deck.unresolved, name: deck.name };
    const v = { vid, name: String(name || '').slice(0, 120) || 'Version', createdAt: new Date().toISOString(), auto, deck: keep };
    await atomicWrite(path.join(dir, `${vid}.json`), JSON.stringify(v));
    // les versions automatiques sont limitées aux 10 plus récentes
    if (auto) {
      const all = (await this.listVersions(deckId)).filter((x) => x.auto);
      for (const old of all.slice(10)) await fs.unlink(path.join(dir, `${old.vid}.json`)).catch(() => {});
    }
    return { vid, name: v.name, createdAt: v.createdAt, auto };
  }

  async loadVersion(deckId, vid) {
    if (!/^[a-z0-9]{6,40}$/.test(vid)) throw new Error('Version invalide');
    const v = await readJson(path.join(this.versionsDir(deckId), `${vid}.json`), null);
    if (!v) throw new Error('Version introuvable');
    return v;
  }

  async deleteVersion(deckId, vid) {
    if (!/^[a-z0-9]{6,40}$/.test(vid)) throw new Error('Version invalide');
    await fs.unlink(path.join(this.versionsDir(deckId), `${vid}.json`)).catch(() => {});
    await fs.unlink(path.join(this.versionsDir(deckId), `${vid}.json.bak`)).catch(() => {});
  }

  /** Contenu de tous les decks, réduit à ce que l'inventaire utilise (zones Commandant et Deck). */
  async deckUsage() {
    const files = (await fs.readdir(this.decksDir)).filter((f) => f.endsWith('.json'));
    const out = [];
    for (const f of files) {
      const d = await readJson(path.join(this.decksDir, f), null);
      if (!d || !d.id) continue;
      const entries = (d.entries || []).filter((e) => e.zone === 'main' || e.zone === 'commander').map((e) => ({ oracleId: e.oracleId, qty: e.qty, zone: e.zone }));
      const cards = {};
      for (const e of entries) {
        const c = (d.cards || {})[e.oracleId];
        if (c && !cards[e.oracleId]) cards[e.oracleId] = slimCard(c);
      }
      const cmd = entries.filter((e) => e.zone === 'commander').map((e) => (d.cards || {})[e.oracleId]).filter(Boolean);
      out.push({ id: d.id, name: d.name, built: !!d.built, identity: cmd.length ? [...new Set(cmd.flatMap((c) => c.colorIdentity || []))] : null, entries, cards });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  // ---------------------------------------------------------------- collection
  async getCollection() {
    const c = await readJson(this.collectionFile, null);
    return c && c.cards ? c : { updatedAt: null, cards: {}, unresolved: [] };
  }

  async saveCollection(c) {
    const clean = { updatedAt: new Date().toISOString(), cards: c.cards || {}, unresolved: (c.unresolved || []).slice(0, 2000) };
    await atomicWrite(this.collectionFile, JSON.stringify(clean));
    return clean;
  }

  async imagesCacheSize() {
    let total = 0; let count = 0;
    try {
      for (const f of await fs.readdir(this.imagesDir)) {
        const st = await fs.stat(path.join(this.imagesDir, f));
        total += st.size; count++;
      }
    } catch { /* vide */ }
    return { bytes: total, count };
  }

  async clearImages() {
    for (const f of await fs.readdir(this.imagesDir)) await fs.unlink(path.join(this.imagesDir, f)).catch(() => {});
  }
}

export function summarize(d) {
  const cards = d.cards || {};
  const entries = d.entries || [];
  const count = entries.filter((e) => e.zone === 'commander' || e.zone === 'main').reduce((s, e) => s + (e.qty || 0), 0);
  const commanders = entries.filter((e) => e.zone === 'commander').map((e) => cards[e.oracleId]).filter(Boolean);
  const identity = [...new Set(commanders.flatMap((c) => c.colorIdentity || []))];
  return {
    id: d.id,
    name: d.name,
    updatedAt: d.updatedAt,
    createdAt: d.createdAt,
    count,
    commanders: commanders.map((c) => ({ name: c.name, printedName: c.printedName || null, images: c.images || null })),
    identity,
    linkCount: (d.links || []).filter((l) => l.status === 'accepted').length,
    built: !!d.built,
  };
}

/** Données de carte suffisantes pour l'affichage dans l'inventaire. */
export function slimCard(c) {
  return {
    oracleId: c.oracleId, name: c.name, printedName: c.printedName || null, typeLine: c.typeLine || '', manaCost: c.manaCost || '',
    cmc: c.cmc || 0, colors: c.colors || [], colorIdentity: c.colorIdentity || [], rarity: c.rarity || '', set: c.set || '',
    collectorNumber: c.collectorNumber || '', images: c.images || null, chosenPrint: c.chosenPrint || null, faces: (c.faces || []).map((f) => ({ name: f.name, printedName: f.printedName || null, typeLine: f.typeLine })),
  };
}

/** Cache persistant des cartes Scryfall (JSON unique, écrit en différé). */
export class CardCache {
  constructor(dir) {
    this.file = path.join(dir, 'cards.json');
    this.data = { lookup: {}, cards: {}, tokens: {} };
    this.dirty = false;
  }
  async load() { this.data = await readJson(this.file, this.data); for (const k of ['lookup', 'cards', 'tokens']) this.data[k] = this.data[k] || {}; }
  getLookup(k) { return this.data.lookup[k]; }
  setLookup(k, v) { this.data.lookup[k] = v; this.dirty = true; }
  getCard(id) { return this.data.cards[id]; }
  setCard(c) { this.data.cards[c.oracleId + (c._printKey ? `@${c._printKey}` : '')] = c; this.dirty = true; }
  getToken(id) { return this.data.tokens[id]; }
  setToken(t) { this.data.tokens[t.id] = t; this.dirty = true; }
  async flush() { if (!this.dirty) return; await atomicWrite(this.file, JSON.stringify(this.data)); this.dirty = false; }
  async clear() { this.data = { lookup: {}, cards: {}, tokens: {} }; this.dirty = true; await this.flush(); }
}
