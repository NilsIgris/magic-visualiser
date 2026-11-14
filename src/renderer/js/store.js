// État global, sauvegarde automatique et historique (annuler / rétablir).
import { debounce, toast } from './ui.js';
import { relink, computeRoles, emptyDeck } from './deckops.js';

const api = window.mtg;

export const state = {
  info: null,
  settings: null,
  decks: [],
  deck: null,
  view: 'library',
  selection: null, // oracleId sélectionné
  selectedLink: null,
  selectedGroup: null,
  search: '',
  saveStatus: 'idle',
  roles: {},
  symbols: {},
};

const subs = new Map();
export function on(evt, fn) {
  if (!subs.has(evt)) subs.set(evt, new Set());
  subs.get(evt).add(fn);
  return () => subs.get(evt).delete(fn);
}
export function emit(evt, payload) {
  for (const fn of subs.get(evt) || []) {
    try { fn(payload); } catch (e) { console.error(`[${evt}]`, e); }
  }
}

// ------------------------------------------------------------ réglages
const persistSettings = debounce((patch) => api.settings.set(patch).catch(() => {}), 300);
let pendingSettings = {};
export function setSetting(patch) {
  state.settings = { ...state.settings, ...patch, graph: { ...state.settings.graph, ...(patch.graph || {}) } };
  pendingSettings = { ...pendingSettings, ...patch, graph: { ...(pendingSettings.graph || {}), ...(patch.graph || {}) } };
  const p = pendingSettings;
  persistSettings(p);
  setTimeout(() => { if (pendingSettings === p) pendingSettings = {}; }, 400);
  emit('settings', patch);
}

// ------------------------------------------------------------ decks
export async function refreshDecks() {
  state.decks = await api.decks.list();
  emit('decks');
}

let history = []; let future = [];
let rev = 0; let savedRev = 0; // révisions du deck courant (sauvegarde fiable)
const snapshot = () => JSON.stringify(state.deck);

export async function openDeck(id) {
  await flushSave();
  const deck = await api.decks.load(id);
  migrate(deck);
  const before = JSON.stringify(deck.links);
  state.roles = relink(deck);
  state.deck = deck;
  history = []; future = [];
  rev = 0; savedRev = 0;
  state.saveStatus = 'saved';
  state.selection = null; state.selectedLink = null; state.search = '';
  setSetting({ lastDeckId: id });
  setView('board');
  emit('deck', { reason: 'open' });
  if (JSON.stringify(deck.links) !== before) { deck.updatedAt = new Date().toISOString(); rev++; scheduleSave(); }
}

function migrate(deck) {
  deck.entries = deck.entries || [];
  deck.cards = deck.cards || {};
  deck.unresolved = deck.unresolved || [];
  deck.links = deck.links || [];
  deck.piles = deck.piles || [];
  deck.cardNotes = deck.cardNotes || {};
  deck.notes = deck.notes || '';
  deck.format = deck.format || 'commander';
}

export async function createDeck(name) {
  await flushSave();
  const id = await api.decks.newId();
  const deck = emptyDeck(id, name);
  await api.decks.save(deck);
  await refreshDecks();
  await openDeck(id);
  return deck;
}

export async function closeDeck() {
  await flushSave();
  state.deck = null; state.selection = null; state.selectedLink = null;
  history = []; future = [];
  setSetting({ lastDeckId: null });
  await refreshDecks();
  setView('library');
  emit('deck', { reason: 'close' });
}

/**
 * Modifie le deck courant.
 * @param {(deck) => void} fn
 * @param {{relink?: boolean, undoable?: boolean, reason?: string}} opts
 */
export function mutate(fn, { relink: doRelink = false, undoable = true, reason = 'edit' } = {}) {
  if (!state.deck) return;
  if (undoable) { history.push(snapshot()); if (history.length > 60) history.shift(); future = []; }
  fn(state.deck);
  if (doRelink) state.roles = relink(state.deck);
  state.deck.updatedAt = new Date().toISOString();
  rev++;
  if (state.selection && !state.deck.cards[state.selection]) state.selection = null;
  if (state.selectedLink && !state.deck.links.some((l) => l.id === state.selectedLink)) state.selectedLink = null;
  scheduleSave();
  emit('deck', { reason });
  emit('history');
}

export function canUndo() { return history.length > 0; }
export function canRedo() { return future.length > 0; }
export function undo() {
  if (!history.length || !state.deck) return;
  future.push(snapshot());
  state.deck = JSON.parse(history.pop());
  state.deck.updatedAt = new Date().toISOString();
  rev++;
  state.roles = computeRoles(state.deck);
  if (state.selection && !state.deck.cards[state.selection]) state.selection = null;
  scheduleSave();
  emit('deck', { reason: 'undo' }); emit('history');
}
export function redo() {
  if (!future.length || !state.deck) return;
  history.push(snapshot());
  state.deck = JSON.parse(future.pop());
  state.deck.updatedAt = new Date().toISOString();
  rev++;
  state.roles = computeRoles(state.deck);
  scheduleSave();
  emit('deck', { reason: 'redo' }); emit('history');
}

// ------------------------------------------------------------ sauvegarde
let saving = null;
async function save() {
  if (!state.deck) return;
  const deck = state.deck;
  const mark = rev;
  state.saveStatus = 'saving'; emit('save');
  const run = (async () => {
    try {
      const summary = await api.decks.save(deck);
      const i = state.decks.findIndex((d) => d.id === summary.id);
      if (i >= 0) state.decks[i] = summary; else state.decks.unshift(summary);
      if (state.deck && state.deck.id === deck.id) savedRev = mark;
      state.saveStatus = pendingSaveScheduled() ? 'saving' : 'saved';
    } catch (e) {
      state.saveStatus = 'error';
      toast(`Échec de l'enregistrement : ${e.message}`, { kind: 'error', action: { label: 'Réessayer', fn: () => scheduleSave.flush() } });
    }
    emit('save');
  })();
  saving = run;
  await run;
  if (saving === run) saving = null;
}
export const scheduleSave = debounce(save, 700);
export async function flushSave() {
  if (saving) await saving;
  if (pendingSaveScheduled()) await scheduleSave.flush();
}
function pendingSaveScheduled() { return !!state.deck && rev !== savedRev; }
export async function saveNow() { await scheduleSave.flush(); }

// ------------------------------------------------------------ navigation
export function setView(view) {
  state.view = view;
  emit('view', view);
}

export function select(oracleId, { linkId = null } = {}) {
  state.selection = oracleId;
  state.selectedLink = linkId;
  state.selectedGroup = null;
  emit('selection');
}

export function selectGroup(groupId) {
  state.selection = null;
  state.selectedLink = null;
  state.selectedGroup = groupId;
  emit('selection');
}
