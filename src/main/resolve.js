// Résolution d'une liste de noms (anglais ou français) en cartes complètes.
// Étapes : cache -> /cards/collection (lots de 75) -> recherche multilingue -> recherche approximative
// -> impression anglaise -> impression française (visuels VF) -> jetons.

import { normalizeName } from '../shared/parser.js';
import { normalizeCard, normalizeToken } from '../shared/normalize.js';

const CARD_TTL = 7 * 24 * 3600 * 1000;

export function itemKey(it) {
  return `${normalizeName(it.name)}|${(it.set || '').toLowerCase()}|${it.cn || ''}`;
}

function namesOf(raw) {
  const n = new Set();
  const add = (s) => { if (s) n.add(normalizeName(s)); };
  add(raw.name);
  for (const part of String(raw.name || '').split(' // ')) add(part);
  for (const f of raw.card_faces || []) { add(f.name); add(f.printed_name); }
  add(raw.printed_name);
  return n;
}

function frontName(name) { return String(name).split(' // ')[0].trim(); }

/** Cache mémoire simple ; le processus principal fournit une version persistée. */
export class MemoryCache {
  constructor() { this.lookup = new Map(); this.cards = new Map(); this.tokens = new Map(); }
  getLookup(k) { return this.lookup.get(k); }
  setLookup(k, v) { this.lookup.set(k, v); }
  getCard(id) { return this.cards.get(id); }
  setCard(c) { this.cards.set(c.oracleId + (c._printKey ? `@${c._printKey}` : ''), c); }
  getToken(id) { return this.tokens.get(id); }
  setToken(t) { this.tokens.set(t.id, t); }
  async flush() {}
}

/**
 * @param {import('./scryfall.js').ScryfallClient} client
 * @param {Array<{name:string,set?:string,cn?:string}>} items
 * @param {{wantFr:boolean, cache:any, onProgress?:Function, force?:boolean}} opts
 * @returns {Promise<{resolved: Map<string, object>, unresolved: string[], viaFrench: number}>}
 */
export async function resolveItems(client, items, { wantFr = false, cache, onProgress = () => {}, force = false } = {}) {
  const unique = new Map();
  for (const it of items) unique.set(itemKey(it), { name: it.name.trim(), set: it.set ? it.set.toLowerCase() : null, cn: it.cn || null, sid: it.sid || null });

  const resolved = new Map(); // itemKey -> carte normalisée
  const pending = new Map(); // itemKey -> { en?, fr? }
  const now = Date.now();

  // 0. Cache
  for (const [k, it] of unique) {
    if (force) break;
    const ref = cache.getLookup(k);
    if (!ref) continue;
    const c = cache.getCard(ref);
    if (c && now - Date.parse(c.fetchedAt || 0) < CARD_TTL && (!wantFr || c.frChecked)) resolved.set(k, c);
  }
  let todo = [...unique.keys()].filter((k) => !resolved.has(k));
  const total = todo.length;
  onProgress({ stage: 'lookup', done: 0, total, label: 'Recherche des cartes' });

  // 1. /cards/collection
  const runCollection = async (keys, mkId) => {
    const ids = keys.map((k) => mkId(unique.get(k)));
    const { data } = await client.collection(ids, (d, t) => onProgress({ stage: 'lookup', done: d, total: t, label: 'Recherche des cartes' }));
    const found = [];
    for (const k of keys) {
      const it = unique.get(k);
      let hit = null;
      if (mkId === idWithSid) {
        hit = data.find((d) => d.id === it.sid);
      } else if (it.set && it.cn && mkId === idWithPrint) {
        hit = data.find((d) => d.set === it.set && String(d.collector_number).toLowerCase() === String(it.cn).toLowerCase());
      } else {
        const want = normalizeName(it.name);
        const wantFront = normalizeName(frontName(it.name));
        hit = data.find((d) => (!it.set || mkId !== idWithSet || d.set === it.set) && (namesOf(d).has(want) || namesOf(d).has(wantFront)));
      }
      if (hit) { pending.set(k, { en: hit.lang === 'en' ? hit : null, fr: hit.lang === 'fr' ? hit : null, base: hit }); found.push(k); }
    }
    return found;
  };
  const idWithSid = (it) => ({ id: it.sid });
  const idWithPrint = (it) => ({ set: it.set, collector_number: String(it.cn) });
  const idWithSet = (it) => ({ name: it.name, set: it.set });
  const idName = (it) => ({ name: it.name });

  const withSid = todo.filter((k) => unique.get(k).sid);
  if (withSid.length) await runCollection(withSid, idWithSid);
  todo = todo.filter((k) => !pending.has(k));
  const withPrint = todo.filter((k) => unique.get(k).set && unique.get(k).cn);
  const withSet = todo.filter((k) => unique.get(k).set && !unique.get(k).cn);
  if (withPrint.length) await runCollection(withPrint, idWithPrint);
  if (withSet.length) await runCollection(withSet, idWithSet);
  todo = todo.filter((k) => !pending.has(k));
  if (todo.length) await runCollection(todo, idName);
  todo = todo.filter((k) => !pending.has(k));
  // Doubles faces écrites avec le seul nom de face avant ou complet : nouvel essai sur la face avant
  const dfc = todo.filter((k) => unique.get(k).name.includes(' // '));
  if (dfc.length) await runCollection(dfc, (it) => ({ name: frontName(it.name) }));
  todo = todo.filter((k) => !pending.has(k));

  // 2. Noms étrangers (français) : d'abord par lots, puis carte par carte, puis recherche approximative
  let viaFrench = 0;
  const batchable = todo.filter((k) => !unique.get(k).name.includes('"'));
  for (let j = 0; j < batchable.length; j += 15) {
    onProgress({ stage: 'foreign', done: Math.min(j + 15, batchable.length), total: batchable.length, label: 'Recherche des noms français' });
    const group = batchable.slice(j, j + 15);
    const q = `(${group.map((k) => `!"${unique.get(k).name}"`).join(' or ')}) lang:fr`;
    let res = [];
    try { res = await client.search(q, { unique: 'prints', multilingual: true, maxPages: 2 }); } catch { res = []; }
    for (const k of group) {
      const it = unique.get(k);
      const want = normalizeName(it.name);
      const hit = res.find((d) => namesOf(d).has(want));
      if (hit) { viaFrench += hit.lang !== 'en' ? 1 : 0; pending.set(k, { en: hit.lang === 'en' ? hit : null, fr: hit.lang === 'fr' ? hit : null, base: hit }); }
    }
  }
  todo = todo.filter((k) => !pending.has(k));
  let i = 0;
  for (const k of todo) {
    i++;
    onProgress({ stage: 'foreign', done: i, total: todo.length, label: 'Recherche des noms français' });
    const it = unique.get(k);
    const want = normalizeName(it.name);
    const wantFront = normalizeName(frontName(it.name));
    const matches = (d) => namesOf(d).has(want) || namesOf(d).has(wantFront);
    let hit = null;
    const safe = it.name.replace(/"/g, '');
    const queries = [
      { q: `!"${safe}" lang:fr`, multilingual: true },
      { q: `${safe} lang:fr`, multilingual: true },
      { q: `!"${safe}" lang:any`, multilingual: true },
      { q: `${safe} lang:any`, multilingual: true },
    ];
    for (const qq of queries) {
      const res = await client.search(qq.q, { unique: 'prints', multilingual: qq.multilingual, maxPages: 1 });
      hit = res.find(matches) || null;
      if (hit) break;
    }
    if (hit) {
      viaFrench += hit.lang !== 'en' ? 1 : 0;
      pending.set(k, { en: hit.lang === 'en' ? hit : null, fr: hit.lang === 'fr' ? hit : null, base: hit });
      continue;
    }
    const fz = await client.named(it.name);
    if (fz) pending.set(k, { en: fz.lang === 'en' ? fz : null, fr: null, base: fz });
  }

  // 3. Impression anglaise pour les cartes trouvées via un nom étranger
  const needEn = [...pending.entries()].filter(([, v]) => !v.en);
  if (needEn.length) {
    onProgress({ stage: 'english', done: 0, total: needEn.length, label: 'Données anglaises' });
    const { data } = await client.collection(needEn.map(([, v]) => ({ name: v.base.name })));
    for (const [, v] of needEn) {
      v.en = data.find((d) => d.oracle_id === v.base.oracle_id) || v.base;
    }
  }

  // 4. Impressions françaises (visuels et noms VF)
  if (wantFr) {
    const needFr = [...pending.values()].filter((v) => !v.fr && v.en && !String(v.en.name).includes('"'));
    const byOracle = new Map();
    for (const v of needFr) {
      const oid = v.en.oracle_id;
      if (!byOracle.has(oid)) byOracle.set(oid, []);
      byOracle.get(oid).push(v);
    }
    const oids = [...byOracle.keys()];
    const chunk = 15;
    for (let j = 0; j < oids.length; j += chunk) {
      onProgress({ stage: 'french', done: Math.min(j + chunk, oids.length), total: oids.length, label: 'Visuels en français' });
      const group = oids.slice(j, j + chunk);
      const q = `(${group.map((o) => `!"${frontName(byOracle.get(o)[0].en.name)}"`).join(' or ')}) lang:fr`;
      let res = [];
      try { res = await client.search(q, { unique: 'cards', multilingual: true, maxPages: 2 }); } catch { res = []; }
      for (const r of res) {
        if (r.lang !== 'fr' || !byOracle.has(r.oracle_id)) continue;
        for (const v of byOracle.get(r.oracle_id)) if (!v.fr) v.fr = r;
      }
    }
  }

  // 5. Jetons
  const tokenIds = new Set();
  for (const v of pending.values()) {
    for (const p of v.en.all_parts || []) {
      if (p.component === 'token' && p.id !== v.en.id && !/^emblem/i.test(p.type_line || '') && !cache.getToken(p.id)) tokenIds.add(p.id);
    }
  }
  if (tokenIds.size) {
    onProgress({ stage: 'tokens', done: 0, total: tokenIds.size, label: 'Jetons' });
    const { data } = await client.collection([...tokenIds].map((id) => ({ id })));
    for (const t of data) cache.setToken(normalizeToken(t));
  }

  // 6. Normalisation
  for (const [k, v] of pending) {
    const card = normalizeCard(v.en, v.fr, []);
    card.tokens = card.tokenRefs.map((id) => cache.getToken(id)).filter(Boolean);
    card.frChecked = wantFr;
    const it = unique.get(k);
    const printKey = it.set && it.cn ? `${it.set}:${it.cn}` : null;
    if (printKey) card._printKey = printKey;
    cache.setCard(card);
    cache.setLookup(k, card.oracleId + (printKey ? `@${printKey}` : ''));
    if (!printKey) cache.setLookup(itemKey({ name: card.name }), card.oracleId);
    resolved.set(k, card);
  }
  await cache.flush();
  const unresolved = [...unique.keys()].filter((k) => !resolved.has(k));
  onProgress({ stage: 'done', done: total, total, label: 'Terminé' });
  return { resolved, unresolved, viaFrench };
}
