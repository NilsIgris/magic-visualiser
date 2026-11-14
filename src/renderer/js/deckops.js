// Opérations sur le modèle de deck (pures, sans interface).
import { analyzeDeck, mergeLinks, findLoops, LINK_KINDS } from '../../shared/analyzer.js';
import { displayName } from '../../shared/normalize.js';
import { normalizeName } from '../../shared/parser.js';

export const ZONE_LABELS = { commander: 'Commandant', main: 'Deck', side: 'Réserve', maybe: 'Peut-être' };
export const TYPE_ORDER = [
  ['commander', 'Commandant'], ['creature', 'Créatures'], ['planeswalker', 'Planeswalkers'], ['battle', 'Batailles'],
  ['artifact', 'Artefacts'], ['enchantment', 'Enchantements'], ['instant', 'Éphémères'], ['sorcery', 'Rituels'], ['land', 'Terrains'], ['other', 'Autres'],
];
export const COLOR_NAMES = { W: 'Blanc', U: 'Bleu', B: 'Noir', R: 'Rouge', G: 'Vert', C: 'Incolore' };
export { LINK_KINDS };

export function emptyDeck(id, name) {
  const now = new Date().toISOString();
  return { schema: 1, id, name, format: 'commander', createdAt: now, updatedAt: now, entries: [], cards: {}, unresolved: [], links: [], piles: [], notes: '', cardNotes: {} };
}

/** Type principal d'une carte pour le regroupement du board. */
export function mainType(card) {
  const tl = (card.faces && card.faces[0] ? card.faces[0].typeLine : card.typeLine || '').toLowerCase();
  if (tl.includes('land') && !tl.includes('creature')) return 'land';
  for (const t of ['creature', 'planeswalker', 'battle', 'artifact', 'enchantment', 'instant', 'sorcery']) if (tl.includes(t)) return t;
  return 'other';
}

export function isBasicLand(card) { return /\bbasic\b/i.test(card.typeLine || '') && /\bland\b/i.test(card.typeLine || ''); }

export function analyzedEntries(deck) { return deck.entries.filter((e) => e.zone !== 'side'); }

/** Recalcule les suggestions et les fusionne avec les liens existants. */
export function relink(deck) {
  const entries = analyzedEntries(deck);
  const ids = [...new Set(entries.map((e) => e.oracleId))];
  const cards = ids.map((id) => deck.cards[id]).filter(Boolean);
  const commanderIds = deck.entries.filter((e) => e.zone === 'commander').map((e) => e.oracleId);
  const { suggestions, roles } = analyzeDeck(cards, { commanderIds });
  deck.links = mergeLinks(deck.links || [], suggestions, ids);
  return roles;
}

export function computeRoles(deck) {
  const entries = analyzedEntries(deck);
  const ids = [...new Set(entries.map((e) => e.oracleId))];
  const cards = ids.map((id) => deck.cards[id]).filter(Boolean);
  const commanderIds = deck.entries.filter((e) => e.zone === 'commander').map((e) => e.oracleId);
  return analyzeDeck(cards, { commanderIds }).roles;
}

/**
 * Intègre des lignes importées.
 * @param {Array} items lignes analysées { qty, name, zone, pile, set, cn, key }
 * @param {Map} resolved itemKey -> carte
 * @param {'add'|'replace'} mode
 */
export function applyImport(deck, items, resolved, unresolvedKeys, mode, keyOf) {
  if (mode === 'replace') { deck.entries = []; deck.unresolved = []; }
  const unresolved = new Set(unresolvedKeys);
  for (const it of items) {
    const k = keyOf(it);
    const card = resolved.get(k);
    if (!card) {
      if (unresolved.has(k)) {
        const ex = deck.unresolved.find((u) => normalizeName(u.name) === normalizeName(it.name) && u.zone === it.zone);
        if (ex) ex.qty += it.qty; else deck.unresolved.push({ name: it.name, qty: it.qty, zone: it.zone, set: it.set || null, cn: it.cn || null, pile: it.pile || null });
      }
      continue;
    }
    const clean = { ...card };
    delete clean._printKey;
    const prev = deck.cards[card.oracleId];
    // ne pas écraser une impression choisie précédemment par une recherche générique
    if (!prev || (it.set && !prev.chosenPrint)) deck.cards[card.oracleId] = clean;
    let pileId = null;
    if (it.pile) pileId = ensurePile(deck, it.pile);
    const zone = it.zone || 'main';
    const e = deck.entries.find((x) => x.oracleId === card.oracleId && x.zone === zone);
    if (e) { e.qty += it.qty; if (pileId && !e.pile) e.pile = pileId; } else deck.entries.push({ oracleId: card.oracleId, qty: it.qty, zone, pile: pileId });
  }
  pruneCards(deck);
}

export function ensurePile(deck, name) {
  const ex = deck.piles.find((p) => normalizeName(p.name) === normalizeName(name));
  if (ex) return ex.id;
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  deck.piles.push({ id, name: name.trim() });
  return id;
}

/** Retire de deck.cards les cartes qui ne sont plus dans aucune zone. */
export function pruneCards(deck) {
  const used = new Set(deck.entries.map((e) => e.oracleId));
  for (const id of Object.keys(deck.cards)) if (!used.has(id)) delete deck.cards[id];
  for (const id of Object.keys(deck.cardNotes || {})) if (!used.has(id)) delete deck.cardNotes[id];
}

export function uniqueCardIds(deck, zones = null) {
  return [...new Set(deck.entries.filter((e) => !zones || zones.includes(e.zone)).map((e) => e.oracleId))];
}

export function commanders(deck) { return deck.entries.filter((e) => e.zone === 'commander').map((e) => deck.cards[e.oracleId]).filter(Boolean); }

export function identityOf(deck) {
  const cmd = commanders(deck);
  if (!cmd.length) return null;
  return new Set(cmd.flatMap((c) => c.colorIdentity || []));
}

export function stats(deck) {
  const playing = deck.entries.filter((e) => e.zone === 'commander' || e.zone === 'main');
  const total = playing.reduce((s, e) => s + e.qty, 0);
  const curve = new Array(8).fill(0);
  let lands = 0; let creatures = 0; let mvSum = 0; let mvCount = 0;
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const e of playing) {
    const c = deck.cards[e.oracleId];
    if (!c) continue;
    const t = mainType(c);
    if (t === 'land') { lands += e.qty; continue; }
    if (t === 'creature') creatures += e.qty;
    const mv = Math.round(Number(c.cmc) || 0);
    curve[Math.min(mv, 7)] += e.qty;
    mvSum += mv * e.qty; mvCount += e.qty;
    const cost = c.manaCost || '';
    for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
      const sym = m[1];
      for (const k of Object.keys(pips)) if (sym === k || sym.split('/').includes(k)) pips[k] += e.qty;
    }
  }
  return { total, lands, creatures, avgMv: mvCount ? mvSum / mvCount : 0, curve, pips };
}

/** Problèmes de construction (format Commander). */
export function validate(deck) {
  const issues = [];
  const s = stats(deck);
  const cmd = commanders(deck);
  if (!cmd.length && deck.entries.length) issues.push({ level: 'warn', text: 'Aucun commandant défini. Clic droit sur une carte → « Définir comme commandant ».' });
  if (deck.entries.length && s.total !== 100) issues.push({ level: 'warn', text: `${s.total} cartes au lieu de 100 (commandant inclus).` });
  const ident = identityOf(deck);
  for (const e of deck.entries) {
    if (e.zone === 'side' || e.zone === 'maybe') continue;
    const c = deck.cards[e.oracleId];
    if (!c) continue;
    if (ident && e.zone !== 'commander' && (c.colorIdentity || []).some((x) => !ident.has(x))) {
      issues.push({ level: 'error', cardId: c.oracleId, text: `Hors de l'identité couleur du commandant (${(c.colorIdentity || []).join('')}).` });
    }
    if (c.legalCommander === 'banned') issues.push({ level: 'error', cardId: c.oracleId, text: 'Bannie en Commander.' });
    else if (c.legalCommander === 'not_legal') issues.push({ level: 'error', cardId: c.oracleId, text: 'Non légale en Commander.' });
    const allowMany = isBasicLand(c) || /any number of cards named/i.test(c.oracleText || '');
    const limit = (/up to (\w+) cards named/i.exec(c.oracleText || '') || [])[1];
    const qtyAll = deck.entries.filter((x) => x.oracleId === e.oracleId && (x.zone === 'main' || x.zone === 'commander')).reduce((a, x) => a + x.qty, 0);
    const words = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const max = allowMany ? Infinity : limit ? words[limit.toLowerCase()] || Number(limit) || 1 : 1;
    if (qtyAll > max && e.zone === 'main') issues.push({ level: 'error', cardId: c.oracleId, text: `${qtyAll} exemplaires (singleton : ${max === 1 ? '1 maximum' : `${max} maximum`}).` });
  }
  for (const u of deck.unresolved || []) issues.push({ level: 'warn', unresolved: u, text: `Carte non trouvée : « ${u.name} ».` });
  return issues;
}

export function displayed(card, settings) { return displayName(card, settings.nameLang); }

// ------------------------------------------------------------------ export
function lineName(c) { return c.name; }

export function exportArena(deck) {
  const out = [];
  const cmd = deck.entries.filter((e) => e.zone === 'commander');
  const main = deck.entries.filter((e) => e.zone === 'main');
  const side = deck.entries.filter((e) => e.zone === 'side');
  const line = (e) => {
    const c = deck.cards[e.oracleId];
    return c.set && c.collectorNumber ? `${e.qty} ${lineName(c)} (${c.set.toUpperCase()}) ${c.collectorNumber}` : `${e.qty} ${lineName(c)}`;
  };
  if (cmd.length) out.push('Commander', ...cmd.map(line), '');
  out.push('Deck', ...main.map(line));
  if (side.length) out.push('', 'Sideboard', ...side.map(line));
  return out.join('\n') + '\n';
}

export function exportSimple(deck, settings) {
  const byZone = (z) => deck.entries.filter((e) => e.zone === z).map((e) => `${e.qty} ${displayName(deck.cards[e.oracleId], settings.nameLang)}`);
  const parts = [];
  if (byZone('commander').length) parts.push('// Commandant', ...byZone('commander'), '');
  parts.push('// Deck', ...byZone('main'));
  if (byZone('side').length) parts.push('', '// Réserve', ...byZone('side'));
  if (byZone('maybe').length) parts.push('', '// Peut-être', ...byZone('maybe'));
  return parts.join('\n') + '\n';
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function exportCsv(deck, settings) {
  const pileName = (id) => (deck.piles.find((p) => p.id === id) || {}).name || '';
  const rows = [['Quantity', 'Name', 'Nom affiché', 'Set code', 'Collector number', 'Board', 'Pile', 'Mana value', 'Type']];
  for (const e of deck.entries) {
    const c = deck.cards[e.oracleId];
    rows.push([e.qty, c.name, displayName(c, settings.nameLang), c.set, c.collectorNumber, ZONE_LABELS[e.zone], pileName(e.pile), c.cmc, c.typeLine]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function exportLinksCsv(deck, settings, describe) {
  const rows = [['Source', 'Type', 'Cible', 'Statut', 'Origine', 'Explication', 'Note']];
  const st = { accepted: 'Validé', pending: 'Suggestion', rejected: 'Rejeté' };
  for (const l of deck.links) {
    const a = deck.cards[l.from]; const b = deck.cards[l.to];
    if (!a || !b) continue;
    rows.push([displayName(a, settings.nameLang), LINK_KINDS[l.kind] ? LINK_KINDS[l.kind].label : l.kind, displayName(b, settings.nameLang), st[l.status] || l.status, l.origin === 'manual' ? 'Manuel' : 'Automatique', describe(l), l.note || '']);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function loopsOf(deck) {
  const active = deck.links.filter((l) => l.status === 'accepted');
  return findLoops(uniqueCardIds(deck), active);
}

// ------------------------------------------------------------------ rôles, repères, base de mana
import { FUNCTIONS } from '../../shared/analyzer.js';
import { hyperAtLeast, hyperPmf, cardsSeen } from '../../shared/prob.js';
export { FUNCTIONS };

/** Repères du modèle de construction de l'émission The Command Zone (épisode 658, 2025). */
export const BENCHMARKS = [
  { key: 'land', label: 'Terrains', target: 38 },
  { key: 'ramp', label: FUNCTIONS.ramp, target: 10 },
  { key: 'draw', label: FUNCTIONS.draw, target: 12 },
  { key: 'removal', label: FUNCTIONS.removal, target: 12 },
  { key: 'wipe', label: FUNCTIONS.wipe, target: 6 },
];

/** Rôles d'une carte : correction manuelle du joueur si elle existe, sinon détection automatique. */
export function effectiveFunctions(deck, oracleId, roles) {
  const o = deck.cardRoles && deck.cardRoles[oracleId];
  if (Array.isArray(o)) return o;
  const r = roles && roles[oracleId];
  return r && r.functions ? r.functions.map((f) => f.key) : [];
}

export function roleCounts(deck, roles) {
  const counts = Object.fromEntries([...Object.keys(FUNCTIONS), 'land'].map((k) => [k, { qty: 0, ids: [] }]));
  for (const e of deck.entries) {
    if (e.zone !== 'main' && e.zone !== 'commander') continue;
    const c = deck.cards[e.oracleId];
    if (!c) continue;
    const keys = mainType(c) === 'land' ? ['land'] : effectiveFunctions(deck, e.oracleId, roles);
    for (const k of keys) {
      if (!counts[k]) continue;
      counts[k].qty += e.qty;
      if (!counts[k].ids.includes(e.oracleId)) counts[k].ids.push(e.oracleId);
    }
  }
  return counts;
}

const BASIC_COLOR = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G', wastes: 'C' };

/** Couleurs qu'un terrain peut produire (y compris les terrains qui vont chercher un terrain de base). */
export function landColors(card, identity) {
  const out = new Set(card.producedMana || []);
  const text = (card.oracleText || '').toLowerCase();
  const m = text.match(/search your library for (?:a|an|up to \w+) ([a-z ,]+?) cards?/);
  if (m) {
    const desc = m[1];
    if (/\bbasic land\b/.test(desc) && !Object.keys(BASIC_COLOR).some((b) => desc.includes(b))) for (const c of identity) out.add(c);
    for (const [b, c] of Object.entries(BASIC_COLOR)) if (desc.includes(b)) out.add(c);
  }
  return out;
}

/**
 * Base de mana : symboles demandés et sources par couleur, probabilités d'avoir une source.
 * La bibliothèque = zone « Deck » (le commandant n'y est pas).
 */
export function manaAnalysis(deck, { drawOnFirstTurn = true } = {}) {
  const ident = identityOf(deck) || new Set();
  const colors = ['W', 'U', 'B', 'R', 'G'].filter((c) => ident.has(c));
  const s = stats(deck);
  const main = deck.entries.filter((e) => e.zone === 'main' && deck.cards[e.oracleId]);
  const N = main.reduce((a, e) => a + e.qty, 0);
  const lands = main.filter((e) => mainType(deck.cards[e.oracleId]) === 'land');
  const landCount = lands.reduce((a, e) => a + e.qty, 0);
  const totalPips = colors.reduce((a, c) => a + (s.pips[c] || 0), 0);
  const rows = colors.map((c) => {
    let landSources = 0; let otherSources = 0;
    for (const e of main) {
      const card = deck.cards[e.oracleId];
      if (mainType(card) === 'land') { if (landColors(card, colors).has(c)) landSources += e.qty; } else if ((card.producedMana || []).includes(c)) otherSources += e.qty;
    }
    const byTurn = [1, 2, 3, 4].map((t) => hyperAtLeast(N, landSources, cardsSeen(t, drawOnFirstTurn), 1));
    return { color: c, pips: s.pips[c] || 0, share: totalPips ? (s.pips[c] || 0) / totalPips : 0, landSources, otherSources, byTurn };
  });
  const opening = Array.from({ length: 8 }, (_, k) => hyperPmf(N, landCount, Math.min(7, N), k));
  return { N, landCount, rows, opening, keepable: opening.slice(2, 5).reduce((a, b) => a + b, 0) };
}
