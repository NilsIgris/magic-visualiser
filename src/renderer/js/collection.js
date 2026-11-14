// Inventaire (cartes possédées) : données, import, répartition entre les decks, ajout à un deck.
import { el, modal, toast, icon, confirmDialog, debounce } from './ui.js';
import { state, emit, on, setSetting, setView, mutate, refreshDecks, closeDeck } from './store.js';
import { parseDeckText } from '../../shared/parser.js';
import { itemKey } from './importer.js';
import { displayName } from '../../shared/normalize.js';
import { usageIndex, deckOwnership, shoppingList, fitsIdentity } from '../../shared/inventory.js';
import { applyImport, relink, identityOf, ZONE_LABELS } from './deckops.js';
import { nameOf } from './cardview.js';

const api = window.mtg;

// ------------------------------------------------------------------ données
export async function loadCollection() {
  try { state.collection = await api.collection.get(); } catch { state.collection = { cards: {}, unresolved: [] }; }
  emit('collection');
}

export async function refreshUsage() {
  try { state.usageDecks = await api.decks.usage(); } catch { state.usageDecks = state.usageDecks || []; }
  emit('usage');
}
on('decks', () => { refreshUsage(); });

/** Utilisation des cartes par tous les decks, avec le deck ouvert tel qu'il est en mémoire. */
export function currentUsage() {
  const open = state.deck;
  const decks = (state.usageDecks || []).filter((d) => !open || d.id !== open.id);
  if (open) decks.push({ id: open.id, name: open.name, built: !!open.built, identity: null, entries: open.entries, cards: open.cards });
  const { byCard, cardInfo } = usageIndex(decks);
  return { byCard, cardInfo, decks };
}

export function hasCollection() { return !!(state.collection && Object.keys(state.collection.cards || {}).length); }

export function collectionStats() {
  const cards = Object.values((state.collection && state.collection.cards) || {});
  return { distinct: cards.length, total: cards.reduce((s, c) => s + (c.qty || 0), 0) };
}

const basicsOwned = () => state.settings.basicsOwned !== false;

/** Situation de chaque carte du deck (libre, partagée, dans un deck monté, manquante). */
export function deckRows(deck) {
  if (!hasCollection() || !deck) return [];
  return deckOwnership(deck, state.collection, currentUsage().byCard, { basicsOwned: basicsOwned() });
}

export function deckShopping(deck) {
  const u = currentUsage();
  return shoppingList(state.collection, u.byCard, u.cardInfo, { deckId: deck.id, basicsOwned: basicsOwned() });
}

export function missingText(rows) {
  return rows.map((r) => `${r.missing} ${r.name}`).join('\n') + '\n';
}

/** Carte affichable d'une entrée d'inventaire (données complètes, ou données d'un deck à défaut). */
export function entryCard(oracleId, entry) {
  if (entry && entry.card) return entry.card;
  const info = currentUsage().cardInfo.get(oracleId);
  if (info) return info;
  return { oracleId, name: (entry && entry.name) || '?', printedName: (entry && entry.printedName) || null, typeLine: '', images: null, colors: [], colorIdentity: [], cmc: 0 };
}

// ------------------------------------------------------------------ modifications (enregistrement différé)
const persist = debounce(async () => {
  try { await api.collection.save(state.collection); } catch (e) { toast(`Inventaire non enregistré : ${e.message}`, { kind: 'error' }); }
}, 500);
export function flushCollection() { return persist.flush(); }

export function updateCollection(fn) {
  fn(state.collection);
  state.collection.updatedAt = new Date().toISOString();
  persist();
  emit('collection');
}

/** @param card données de carte : complètes (avec texte Oracle) ou réduites (nom seul gardé, complété plus tard) */
export function setOwned(oracleId, qty, card = null) {
  const full = card && card.oracleText !== undefined ? card : null;
  updateCollection((c) => {
    const q = Math.max(0, Math.min(999, Math.round(qty)));
    if (!q) { delete c.cards[oracleId]; return; }
    const prev = c.cards[oracleId];
    c.cards[oracleId] = prev
      ? { ...prev, qty: q, card: prev.card || full }
      : { qty: q, card: full, name: card ? card.name : entryCard(oracleId, null).name, addedAt: new Date().toISOString() };
  });
}

export function removeOwned(oracleId) {
  const prev = state.collection.cards[oracleId];
  if (!prev) return;
  setOwned(oracleId, 0);
  toast(`« ${nameOf(entryCard(oracleId, prev))} » retirée de l'inventaire.`, { action: { label: 'Annuler', fn: () => updateCollection((c) => { c.cards[oracleId] = prev; }) } });
}

const clean = (card) => { const c = { ...card }; delete c._printKey; return c; };

// ------------------------------------------------------------------ import
export function openImport() {
  const st = collectionStats();
  const ta = el('textarea', { class: 'input import-text', rows: '10', spellcheck: 'false', placeholder: '1 Sol Ring\n4 Forest\n1 Artiste sanguinaire\n…\n\nou un export CSV (colonnes Name, Quantity, éventuellement Set code et Scryfall ID)', 'aria-label': 'Liste des cartes possédées' });
  let mode = 'add';
  const status = el('div', { class: 'coll-status', 'aria-live': 'polite' });
  const body = el('div', { class: 'coll' },
    el('p', { class: 'coll-info', text: st.distinct ? `Ton inventaire contient ${st.distinct} cartes différentes (${st.total} exemplaires).` : 'Importe la liste des cartes que tu possèdes : export de ManaBox, Moxfield, Delver Lens, Dragon Shield, ou simple liste « quantité nom ».' }),
    el('div', { class: 'import-left-head' }, el('span', { class: 'field-label', text: 'Colle ta liste ou ouvre un fichier' }),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: async () => { try { const f = await api.files.openText(); if (f) { ta.value = f.content; toast(`${f.name} chargé.`); } } catch (e) { toast(e.message, { kind: 'error' }); } } } }, icon('folder', 16), 'Ouvrir un fichier…')),
    ta,
    st.distinct ? el('div', { class: 'radio-row', role: 'radiogroup', 'aria-label': 'Mode d\'import' }, [['add', 'Ajouter les quantités à mon inventaire'], ['replace', 'Remplacer tout mon inventaire']].map(([k, l]) => el('label', { class: 'radio' },
      el('input', { type: 'radio', name: 'cmode', value: k, checked: k === mode, on: { change: () => { mode = k; } } }), el('span', { text: l })))) : null,
    el('p', { class: 'muted small', text: 'Les cartes sont comptées par nom, toutes éditions confondues. Une colonne « Scryfall ID » (ManaBox) ou « Set code » + « Collector number » donne l\'illustration exacte.' }),
    status);
  const m = modal({
    title: 'Importer dans l\'inventaire', width: 680, body,
    actions: [
      { label: 'Annuler', kind: 'ghost' },
      { label: 'Importer', kind: 'primary', onClick: async () => {
        const parsed = parseDeckText(ta.value, { format: 'collection' });
        if (!parsed.items.length) { toast('Aucune carte reconnue dans la liste.', { kind: 'error' }); return false; }
        const btns = m.footer.querySelectorAll('button'); btns.forEach((b) => { b.disabled = true; });
        const off = api.scryfall.onProgress((p) => { status.textContent = p.total ? `${p.label} (${p.done}/${p.total})` : p.label; });
        try {
          const items = parsed.items.map(({ name, set, cn, sid, qty }) => ({ name, set, cn, sid, qty }));
          const wantFr = state.settings.imageLang === 'fr' || state.settings.nameLang === 'fr';
          const res = await api.scryfall.resolve(items.map(({ name, set, cn, sid }) => ({ name, set, cn, sid })), { wantFr });
          const resolved = new Map(res.resolved);
          const unresolved = [];
          let lines = 0; let copies = 0;
          const now = new Date().toISOString();
          updateCollection((c) => {
            if (mode === 'replace') c.cards = {};
            for (const it of items) {
              const card = resolved.get(itemKey(it));
              if (!card) { unresolved.push(`${it.qty} ${it.name}`); continue; }
              const prev = c.cards[card.oracleId];
              c.cards[card.oracleId] = { qty: (prev ? prev.qty : 0) + it.qty, card: prev && prev.card ? prev.card : clean(card), name: card.name, addedAt: prev ? prev.addedAt : now };
              lines++; copies += it.qty;
            }
            c.unresolved = unresolved;
          });
          await flushCollection();
          m.close('done');
          toast(unresolved.length ? `${copies} exemplaires ajoutés, ${unresolved.length} ligne${unresolved.length > 1 ? 's' : ''} non reconnue${unresolved.length > 1 ? 's' : ''}.` : `${copies} exemplaires ajoutés à l'inventaire (${lines} lignes).`, { kind: unresolved.length ? 'warn' : 'ok' });
        } catch (e) {
          status.textContent = `Import impossible : ${e.message}`;
          btns.forEach((b) => { b.disabled = false; });
        } finally { off(); }
        return false;
      } },
    ],
  });
}

export async function clearCollection() {
  const ok = await confirmDialog({ title: 'Vider l\'inventaire', message: 'Toutes les cartes de ton inventaire seront retirées. Tes decks ne sont pas modifiés.', confirmLabel: 'Vider', danger: true });
  if (!ok) return;
  updateCollection((c) => { c.cards = {}; c.unresolved = []; });
  await flushCollection();
  toast('Inventaire vidé.');
}

/** Complète les entrées importées avec une ancienne version (nom seulement, sans visuel ni type). */
let completing = false;
export async function completeData({ silent = false } = {}) {
  if (completing || !state.collection) return;
  const todo = Object.entries(state.collection.cards).filter(([, e]) => !e.card && e.name);
  if (!todo.length) return;
  completing = true;
  const t = silent ? null : toast(`Récupération des données de ${todo.length} cartes de l'inventaire…`, { timeout: 60000 });
  try {
    const wantFr = state.settings.imageLang === 'fr' || state.settings.nameLang === 'fr';
    const res = await api.scryfall.resolve(todo.map(([, e]) => ({ name: e.name })), { wantFr });
    const resolved = new Map(res.resolved);
    updateCollection((c) => {
      for (const [id, e] of todo) {
        const card = resolved.get(itemKey({ name: e.name }));
        if (card && card.oracleId === id && c.cards[id]) c.cards[id] = { ...c.cards[id], card: clean(card) };
      }
    });
  } catch (e) { if (!silent) toast(`Données non récupérées : ${e.message}`, { kind: 'error' }); } finally { completing = false; if (t) t.remove(); }
}

// ------------------------------------------------------------------ export
const csvCell = (v) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function inventoryCsv(rows) {
  const lines = [['Quantity', 'Name', 'Nom affiché', 'Set code', 'Collector number', 'Utilisée dans', 'Disponibles']];
  for (const r of rows) {
    const c = entryCard(r.oracleId, r.entry);
    lines.push([r.owned, c.name, displayName(c, state.settings.nameLang), c.set || '', c.collectorNumber || '', r.decks.map((d) => `${d.name} (${d.qty})`).join(' / '), r.available]);
  }
  return '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\n') + '\n';
}

// ------------------------------------------------------------------ decks
/** Marque un deck comme monté (cartes physiquement rangées dedans) ou non. */
export async function setDeckBuilt(deckId, built) {
  if (state.deck && state.deck.id === deckId) {
    mutate((d) => { d.built = built; }, { reason: 'built' });
  } else {
    const d = await api.decks.load(deckId);
    d.built = built;
    d.updatedAt = new Date().toISOString();
    await api.decks.save(d);
    await refreshDecks();
  }
  toast(built ? 'Deck marqué comme monté : ses cartes lui sont réservées.' : 'Deck marqué comme non monté.', { kind: 'ok' });
}

async function fullCard(oracleId) {
  const e = state.collection.cards[oracleId];
  if (e && e.card) return e.card;
  const info = currentUsage().cardInfo.get(oracleId);
  if (info && info.oracleText !== undefined) return info;
  const name = (e && e.name) || (info && info.name);
  if (!name) return null;
  const res = await api.scryfall.resolve([{ name }], { wantFr: state.settings.imageLang === 'fr' || state.settings.nameLang === 'fr' });
  const card = new Map(res.resolved).get(itemKey({ name }));
  return card ? clean(card) : null;
}

/** Ajoute une carte à un deck (ouvert ou non). */
export async function addCardToDeck(oracleId, deckId, zone = 'main', qty = 1) {
  const card = await fullCard(oracleId);
  if (!card) { toast('Données de la carte introuvables.', { kind: 'error' }); return false; }
  const item = { qty, name: card.name, zone, set: null, cn: null, pile: null };
  const resolved = new Map([[itemKey(item), card]]);
  if (state.deck && state.deck.id === deckId) {
    mutate((d) => applyImport(d, [item], resolved, [], 'add', itemKey), { relink: true, reason: 'add' });
  } else {
    const d = await api.decks.load(deckId);
    applyImport(d, [item], resolved, [], 'add', itemKey);
    relink(d);
    d.updatedAt = new Date().toISOString();
    await api.decks.save(d);
    await refreshDecks();
  }
  const deckName = (state.decks.find((x) => x.id === deckId) || {}).name || 'le deck';
  toast(`« ${nameOf(card)} » ajoutée à « ${deckName} » (${ZONE_LABELS[zone]}).`, { kind: 'ok' });
  return true;
}

/** Fenêtre « Ajouter à un deck… » depuis l'inventaire. */
export function openAddToDeck(oracleId) {
  const entry = state.collection.cards[oracleId];
  const card = entryCard(oracleId, entry);
  if (!state.decks.length) { toast('Crée d\'abord un deck.', { kind: 'warn' }); return; }
  const u = currentUsage();
  const usedIn = new Map((u.byCard.get(oracleId) || []).map((d) => [d.deckId, d.qty]));
  const deckSel = el('select', { class: 'select select-wide', 'aria-label': 'Deck' },
    state.decks.map((d) => el('option', { value: d.id, selected: state.deck ? d.id === state.deck.id : false }, `${d.name}${usedIn.has(d.id) ? ` (déjà ${usedIn.get(d.id)})` : ''}`)));
  const zoneSel = el('select', { class: 'select', 'aria-label': 'Zone' }, ['main', 'maybe', 'side'].map((z) => el('option', { value: z }, ZONE_LABELS[z])));
  const info = el('div', { class: 'atd-info', 'aria-live': 'polite' });
  const drawInfo = () => {
    const id = deckSel.value;
    const ud = (state.usageDecks || []).find((d) => d.id === id);
    const ident = state.deck && state.deck.id === id ? identityOf(state.deck) : ud && ud.identity ? new Set(ud.identity) : null;
    const owned = entry ? entry.qty : 0;
    const need = [...usedIn.values()].reduce((a, b) => a + b, 0);
    const lines = [];
    if (usedIn.has(id)) lines.push(el('p', { class: 'warn-txt', text: `Ce deck contient déjà ${usedIn.get(id)} exemplaire${usedIn.get(id) > 1 ? 's' : ''} (format singleton).` }));
    if (!fitsIdentity(card, ident)) lines.push(el('p', { class: 'warn-txt', text: 'Hors de l\'identité couleur du commandant de ce deck.' }));
    if (!usedIn.has(id) && owned <= need && need > 0) lines.push(el('p', { class: 'warn-txt', text: `Tes ${owned} exemplaire${owned > 1 ? 's sont déjà utilisés' : ' est déjà utilisé'} par ${[...usedIn.keys()].map((k) => `« ${(state.decks.find((x) => x.id === k) || {}).name} »`).join(', ')} : l'ajouter ici créera un manque ailleurs.` }));
    if (!lines.length) lines.push(el('p', { class: 'muted small', text: owned > need ? `${owned - need} exemplaire${owned - need > 1 ? 's' : ''} libre${owned - need > 1 ? 's' : ''} dans ton inventaire.` : '' }));
    info.replaceChildren(...lines);
  };
  deckSel.addEventListener('change', drawInfo);
  drawInfo();
  modal({
    title: `Ajouter « ${nameOf(card)} » à un deck`, width: 520,
    body: el('div', {}, el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Deck' }), deckSel), el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Zone' }), zoneSel), info),
    actions: [{ label: 'Annuler', kind: 'ghost' }, { label: 'Ajouter', kind: 'primary', onClick: async () => { try { await addCardToDeck(oracleId, deckSel.value, zoneSel.value); } catch (e) { toast(e.message, { kind: 'error' }); return false; } return true; } }],
  });
}

// ------------------------------------------------------------------ navigation (compatibilité des menus)
export async function goInventory() {
  if (state.deck) await closeDeck();
  setView('inventory');
}
export const openCollection = goInventory;
export function openMissing() { setView('collection'); }
export function setBasicsOwned(v) { setSetting({ basicsOwned: v }); emit('collection'); }
