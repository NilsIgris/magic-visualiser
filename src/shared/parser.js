// Parseur de listes de cartes : liste simple, export Arena/MTGO, CSV.
// Module pur (aucune dépendance), utilisé par l'interface et par les tests.

export const ZONES = ['commander', 'main', 'side', 'maybe'];

const HEADER_ZONES = [
  [/^(commander|commandant|commanders|commandants)$/, 'commander'],
  [/^(deck|main|mainboard|main deck|maindeck|bibliothèque|bibliotheque|cartes)$/, 'main'],
  [/^(sideboard|side|réserve|reserve|sb)$/, 'side'],
  [/^(maybeboard|maybe|considering|peut-être|peut-etre|à tester|a tester)$/, 'maybe'],
  [/^(companion|compagnon)$/, 'side'],
];

/** Normalise un nom pour comparaison : minuscules, sans accents, apostrophes unifiées. */
export function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function headerZone(line) {
  let t = line.trim().replace(/^\/\/\s*/, '').replace(/^#+\s*/, '').replace(/:$/, '').trim().toLowerCase();
  // "Commander (1)" / "Deck (99)" style
  t = t.replace(/\s*\(\d+\)\s*$/, '').trim();
  for (const [re, zone] of HEADER_ZONES) if (re.test(t)) return zone;
  return null;
}

/**
 * Analyse une ligne de carte. Renvoie null si la ligne n'est pas une carte.
 * Exemples acceptés :
 *   4 Lightning Bolt
 *   4x Lightning Bolt
 *   1 Sol Ring (C21) 263
 *   1 Delver of Secrets // Insectile Aberration (ISD) 51 *F*
 *   SB: 2 Duress
 *   1x Sol Ring (c21) 263 [Ramp]
 *   1 Atraxa, Praetors' Voice *CMDR*
 *   Sol Ring           (quantité 1 implicite)
 */
export function parseCardLine(raw) {
  let line = String(raw).replace(/ /g, ' ').trim();
  if (!line) return null;
  let zone = null;
  if (/^sb:\s*/i.test(line)) { zone = 'side'; line = line.replace(/^sb:\s*/i, ''); }

  let qty = 1;
  const m = line.match(/^(\d{1,3})\s*[xX]?\s+(.+)$/);
  if (m) { qty = parseInt(m[1], 10); line = m[2]; }
  else if (/^\d+$/.test(line)) return null;

  let pile = null;
  // Catégories Archidekt : [Ramp] ou [Commander{top}] ; tags Moxfield : #Ramp
  const cat = line.match(/\s*\[([^\]]*)\]\s*$/);
  if (cat) {
    line = line.slice(0, cat.index);
    const catName = cat[1].replace(/\{[^}]*\}/g, '').split(',')[0].trim();
    if (/^(commander|commandant)$/i.test(catName)) zone = 'commander';
    else if (/^(maybeboard|maybe)$/i.test(catName)) zone = 'maybe';
    else if (/^(sideboard)$/i.test(catName)) zone = 'side';
    else if (catName) pile = catName;
  }
  // Marqueurs de fin : *F* (foil), *E* (étched), *CMDR*
  let changed = true;
  while (changed) {
    changed = false;
    const mk = line.match(/\s+\*([A-Za-z]+)\*\s*$/);
    if (mk) {
      if (/^cmdr$/i.test(mk[1])) zone = 'commander';
      line = line.slice(0, mk.index); changed = true;
    }
    const tag = line.match(/\s+#[^\s#]+\s*$/);
    if (tag) { line = line.slice(0, tag.index); changed = true; }
  }
  line = line.trim();

  let set = null, cn = null;
  const sc = line.match(/^(.*?)\s+\(([A-Za-z0-9]{2,6})\)\s+([0-9A-Za-z][0-9A-Za-z\-★†\/]*)$/);
  if (sc) { line = sc[1]; set = sc[2].toLowerCase(); cn = sc[3]; }
  else {
    const s2 = line.match(/^(.*?)\s+\(([A-Za-z0-9]{2,6})\)$/);
    if (s2) { line = s2[1]; set = s2[2].toLowerCase(); }
    else {
      // Format "Nom [SET]" déjà retiré plus haut ; format "Nom | SET"
      const s3 = line.match(/^(.*?)\s+\|\s*([A-Za-z0-9]{2,6})$/);
      if (s3) { line = s3[1]; set = s3[2].toLowerCase(); }
    }
  }
  // Doubles faces écrites "A/B" ou "A // B" : normaliser en " // "
  let name = line.replace(/\s*\/\/?\s*(?=[A-ZÀ-Ý])/g, (mm) => (mm.includes('/') ? ' // ' : mm)).trim();
  name = name.replace(/\s+/g, ' ');
  if (!name || qty < 1) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(name)) return null;
  return { qty, name, set, cn, zone, pile };
}

/** Découpe une ligne CSV en respectant les guillemets. */
export function splitCsvLine(line, delim) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const CSV_COLS = {
  name: ['name', 'card name', 'card', 'nom', 'nom de la carte', 'cardname', 'card_name'],
  qty: ['count', 'quantity', 'qty', 'quantité', 'quantite', 'qté', 'qte', 'amount', 'nombre', 'nb'],
  set: ['set', 'set code', 'edition', 'édition', 'set_code', 'setcode', 'extension', 'edition code'],
  cn: ['collector number', 'collector_number', 'number', 'cn', 'card number', 'numéro', 'numero', 'collector #'],
  zone: ['board', 'section', 'zone', 'category', 'catégorie', 'categorie', 'type de board'],
  sid: ['scryfall id', 'scryfall_id', 'scryfallid', 'scryfall uuid'],
};

function detectCsv(lines) {
  const first = lines.find((l) => l.trim());
  if (!first) return null;
  for (const delim of [',', ';', '\t']) {
    if (!first.includes(delim)) continue;
    const cols = splitCsvLine(first, delim).map((c) => normalizeName(c.replace(/^﻿/, '')));
    const idx = {};
    for (const [key, names] of Object.entries(CSV_COLS)) {
      const i = cols.findIndex((c) => names.includes(c));
      if (i >= 0) idx[key] = i;
    }
    if (idx.name !== undefined) return { delim, idx };
  }
  return null;
}

function zoneFromLabel(label) {
  const t = normalizeName(label);
  if (!t) return null;
  if (/^(commander|commandant|commanders)$/.test(t)) return 'commander';
  if (/^(sideboard|side|reserve)$/.test(t)) return 'side';
  if (/^(maybeboard|maybe|considering|peut-etre)$/.test(t)) return 'maybe';
  if (/^(main|mainboard|deck|maindeck)$/.test(t)) return 'main';
  return null;
}

/**
 * Analyse un texte complet (liste ou CSV).
 * @returns {{format:string, items:Array, ignored:Array<{line:number,text:string}>}}
 */
export function parseDeckText(text, { format = 'commander' } = {}) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const lines = src.split('\n');
  const csv = detectCsv(lines);
  const ignored = [];
  let items = [];

  if (csv) {
    const { delim, idx } = csv;
    let headerSeen = false;
    lines.forEach((l, n) => {
      if (!l.trim()) return;
      if (!headerSeen) { headerSeen = true; return; }
      const cells = splitCsvLine(l, delim);
      const name = (cells[idx.name] || '').trim();
      if (!name) { ignored.push({ line: n + 1, text: l }); return; }
      let qty = 1;
      if (idx.qty !== undefined) {
        const q = parseInt(cells[idx.qty], 10);
        if (Number.isFinite(q) && q > 0) qty = q; else if (cells[idx.qty]) { ignored.push({ line: n + 1, text: l }); return; }
      }
      const zoneCell = idx.zone !== undefined ? zoneFromLabel(cells[idx.zone]) : null;
      const pileCell = idx.zone !== undefined && !zoneCell && cells[idx.zone] ? cells[idx.zone].trim() : null;
      items.push({
        qty,
        name: name.replace(/\s*\/\/?\s*/g, (mm) => (mm.includes('/') ? ' // ' : mm)).replace(/\s+/g, ' '),
        set: idx.set !== undefined && cells[idx.set] ? cells[idx.set].toLowerCase() : null,
        cn: idx.cn !== undefined && cells[idx.cn] ? cells[idx.cn] : null,
        sid: idx.sid !== undefined && /^[0-9a-f-]{36}$/i.test(cells[idx.sid] || '') ? cells[idx.sid].toLowerCase() : null,
        zone: zoneCell || 'main',
        pile: pileCell,
        line: n + 1,
      });
    });
    return { format: 'csv', items: mergeItems(items), ignored };
  }

  // Liste texte (simple / Arena / MTGO / Moxfield)
  let zone = 'main';
  let sawHeader = false;
  const blocks = [[]]; // blocs séparés par lignes vides (si aucun en-tête)
  let detected = 'simple';
  lines.forEach((raw, n) => {
    const l = raw.trim();
    if (!l) { if (!sawHeader && blocks[blocks.length - 1].length) blocks.push([]); return; }
    if (/^(about|name)\b/i.test(l) && !/^\d/.test(l)) {
      // Arena : "About" / "Name Mon deck"
      if (/^about$/i.test(l) || /^name\s+/i.test(l)) { detected = 'arena'; return; }
    }
    const hz = headerZone(l);
    if (hz && !/^\d/.test(l)) { zone = hz; sawHeader = true; detected = detected === 'simple' ? 'arena' : detected; return; }
    if (/^(\/\/|#)/.test(l)) { ignored.push({ line: n + 1, text: raw }); return; }
    const card = parseCardLine(l);
    if (!card) { ignored.push({ line: n + 1, text: raw }); return; }
    if (card.set && detected === 'simple') detected = 'arena';
    const item = { ...card, zone: card.zone || zone, line: n + 1, _explicitZone: !!card.zone || sawHeader };
    if (!sawHeader) blocks[blocks.length - 1].push(item);
    items.push(item);
  });

  if (!sawHeader) {
    const nonEmpty = blocks.filter((b) => b.length);
    if (nonEmpty.length >= 2) {
      // Convention MTGO/Moxfield : le dernier bloc est le commandant (format Commander, 1-2 cartes)
      // ou la réserve sinon.
      const last = nonEmpty[nonEmpty.length - 1];
      const lastQty = last.reduce((s, it) => s + it.qty, 0);
      const target = format === 'commander' && lastQty <= 2 ? 'commander' : 'side';
      for (const it of last) if (!it._explicitZone) it.zone = target;
    }
  }
  items.forEach((it) => delete it._explicitZone);
  return { format: detected, items: mergeItems(items), ignored };
}

function mergeItems(items) {
  const map = new Map();
  const out = [];
  for (const it of items) {
    const key = `${normalizeName(it.name)}|${it.zone}|${it.set || ''}|${it.cn || ''}`;
    if (map.has(key)) { map.get(key).qty += it.qty; continue; }
    const copy = { ...it };
    map.set(key, copy);
    out.push(copy);
  }
  return out;
}
