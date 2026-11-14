// Point d'entrée de l'interface.
import { el, clear, icon, toast, menuFromButton, anyModalOpen, closeMenu, confirmDialog, modal } from './ui.js';
import { state, on, emit, refreshDecks, openDeck, closeDeck, setView, select, undo, redo, canUndo, canRedo, saveNow, flushSave, mutate } from './store.js';
import { stats, validate, exportArena, exportSimple, exportCsv, exportLinksCsv, relink } from './deckops.js';
import { initLibrary, newDeckFlow, duplicateDeck, exportDeckJson, safeName } from './views/library.js';
import { initBoard } from './views/board.js';
import { initGraph, graphIsLinking, cancelGraphLinkMode } from './views/graph.js';
import { initLinks } from './views/links.js';
import { initInspector } from './inspector.js';
import { openImporter } from './importer.js';
import { openSettings, refreshDeckCards, initUpdateEvents } from './settings.js';
import { initAnalysis } from './views/analysis.js';
import { focusAddBox } from './addcard.js';
import { openVersions, saveVersionFlow, openCompare } from './versions.js';
import { loadCollection, goInventory, flushCollection } from './collection.js';
import { initInventory } from './views/inventory.js';
import { initDeckCollection } from './views/deckcoll.js';
import { describeLink } from './reasons.js';
import { removeCard } from './actions.js';
import { openLinkDialog } from './linkdialog.js';
import { nameOf } from './cardview.js';

const api = window.mtg;
const $ = (id) => document.getElementById(id);

async function boot() {
  try {
    state.info = await api.info();
    state.settings = await api.settings.get();
  } catch (e) {
    document.body.textContent = `Démarrage impossible : ${e.message}`;
    return;
  }
  document.documentElement.style.setProperty('--tile-w', `${state.settings.tileSize || 150}px`);
  on('view', layout); // avant les vues : la section doit être visible quand elles se dessinent
  initLibrary(); initInventory(); initBoard(); initGraph(); initLinks(); initAnalysis(); initDeckCollection(); initInspector(); on('deck', () => { renderTopbar(); renderStatus(); });
  initUpdateEvents();
  await loadCollection();
  on('save', renderSaveStatus); on('history', renderTopbar);
  on('settings', (p) => { if (p && ('nameLang' in p)) renderStatus(); });
  await refreshDecks();
  const last = state.settings.lastDeckId;
  if (last && state.decks.some((d) => d.id === last)) {
    try { await openDeck(last); } catch { setView('library'); }
  } else setView('library');
  api.scryfall.symbology().then((m) => { state.symbols = m || {}; emit('symbols'); }).catch(() => {});
  api.onBeforeClose(async () => { try { await flushSave(); await flushCollection(); } finally { api.closeReady(); } });
  installKeys();
  installPasteAndDrop();
}

// ------------------------------------------------------------------ mise en page
function layout() {
  const v = state.view;
  const app = $('app');
  app.dataset.view = v;
  for (const id of ['library', 'inventory', 'board', 'graph', 'links', 'analysis', 'collection']) $(`view-${id}`).hidden = id !== v;
  const deckOpen = !!state.deck && v !== 'library' && v !== 'inventory';
  $('inspector').hidden = !deckOpen;
  $('statusbar').hidden = !deckOpen;
  renderTopbar();
  renderStatus();
}

// ------------------------------------------------------------------ barre du haut
const TABS = [['board', 'Board', '1'], ['graph', 'Graphe', '2'], ['links', 'Interactions', '3'], ['analysis', 'Analyse', '4'], ['collection', 'Collection', '5']];
const HOME_TABS = [['library', 'Mes decks'], ['inventory', 'Inventaire']];
let searchInput = null;

function renderTopbar() {
  const bar = clear($('topbar'));
  if (!state.deck || state.view === 'library' || state.view === 'inventory') {
    bar.append(el('div', { class: 'brand' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true' }), el('span', { class: 'brand-name', text: 'MTG Deck Lab' })),
      el('nav', { class: 'tabs main-tabs', role: 'tablist', 'aria-label': 'Sections' }, HOME_TABS.map(([k, l]) => el('button', {
        class: `tab${state.view === k ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(state.view === k), on: { click: () => setView(k) },
      }, l))),
      el('span', { class: 'bar-spacer' }),
      el('button', { class: 'icon-btn', type: 'button', title: 'Réglages', 'aria-label': 'Réglages', on: { click: openSettings } }, icon('gear')));
    return;
  }
  const deck = state.deck;
  const pend = deck.links.filter((l) => l.status === 'pending').length;
  const nameInput = el('input', {
    class: 'deck-title-input', type: 'text', value: deck.name, 'aria-label': 'Nom du deck', spellcheck: 'false',
    on: {
      keydown: (e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = deck.name; e.target.blur(); } },
      blur: (e) => { const v = e.target.value.trim(); if (v && v !== deck.name) mutate((d) => { d.name = v; }, { reason: 'rename' }); else e.target.value = deck.name; },
    },
  });
  searchInput = el('input', {
    class: 'search-input', type: 'search', placeholder: 'Filtrer les cartes (nom, type, texte)', value: state.search, 'aria-label': 'Filtrer les cartes', spellcheck: 'false',
    on: { input: (e) => { state.search = e.target.value; emit('search'); }, keydown: (e) => { if (e.key === 'Escape') { e.target.value = ''; state.search = ''; emit('search'); e.target.blur(); } } },
  });
  bar.append(
    el('button', { class: 'btn btn-ghost btn-sm back-btn', type: 'button', title: 'Retour à la liste des decks', on: { click: () => closeDeck() } }, icon('back', 16), 'Mes decks'),
    nameInput,
    el('nav', { class: 'tabs main-tabs', role: 'tablist', 'aria-label': 'Vues' }, TABS.map(([k, l, key]) => el('button', {
      class: `tab${state.view === k ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(state.view === k), title: `${l} (${key})`,
      on: { click: () => setView(k) },
    }, l, k === 'links' && pend ? el('span', { class: 'tab-n attention', text: String(pend), title: `${pend} suggestions à valider` }) : null))),
    el('div', { class: 'search' }, icon('search', 16), searchInput),
    el('span', { class: 'bar-spacer' }),
    el('button', { class: 'icon-btn', type: 'button', title: 'Annuler (Ctrl+Z)', 'aria-label': 'Annuler', disabled: !canUndo(), on: { click: undo } }, icon('undo')),
    el('button', { class: 'icon-btn', type: 'button', title: 'Rétablir (Ctrl+Y)', 'aria-label': 'Rétablir', disabled: !canRedo(), on: { click: redo } }, icon('redo')),
    el('span', { id: 'save-status', class: 'save-status', 'aria-live': 'polite' }),
    el('button', { class: 'btn btn-primary btn-sm', type: 'button', title: 'Importer des cartes (Ctrl+I)', on: { click: () => openImporter() } }, icon('upload', 16), 'Importer des cartes'),
    el('button', { class: 'icon-btn', type: 'button', title: 'Exporter et autres actions', 'aria-label': 'Exporter et autres actions', on: { click: (e) => menuFromButton(e.currentTarget, deckMenu()) } }, icon('more')),
    el('button', { class: 'icon-btn', type: 'button', title: 'Réglages', 'aria-label': 'Réglages', on: { click: openSettings } }, icon('gear')));
  renderSaveStatus();
}

function renderSaveStatus() {
  const n = document.getElementById('save-status');
  if (!n) return;
  const map = { saving: 'Enregistrement…', saved: 'Enregistré', error: 'Non enregistré', idle: '' };
  n.textContent = map[state.saveStatus] || '';
  n.className = `save-status st-${state.saveStatus}`;
}

async function saveFile(content, name, ext, label) {
  try {
    const f = await api.files.save({ defaultName: `${safeName(state.deck.name)}${name}.${ext}`, filters: [{ name: label, extensions: [ext] }], content });
    if (f) toast(`Fichier enregistré : ${f}`, { kind: 'ok' });
  } catch (e) { toast(e.message, { kind: 'error' }); }
}

function deckMenu() {
  const deck = state.deck;
  const s = state.settings;
  return [
    { heading: 'Exporter' },
    { label: 'Liste Arena / MTGO (.txt)…', onClick: () => saveFile(exportArena(deck), '', 'txt', 'Texte') },
    { label: 'Liste simple, noms affichés (.txt)…', onClick: () => saveFile(exportSimple(deck, s), ' (liste)', 'txt', 'Texte') },
    { label: 'Tableau des cartes (.csv)…', onClick: () => saveFile(exportCsv(deck, s), '', 'csv', 'CSV') },
    { label: 'Tableau des interactions (.csv)…', onClick: () => saveFile(exportLinksCsv(deck, s, (l) => describeLink(l, deck, s.nameLang)), ' - interactions', 'csv', 'CSV') },
    { label: 'Deck complet, réimportable (.json)…', onClick: async () => { await saveNow(); exportDeckJson(deck.id); } },
    { label: 'Copier la liste Arena', onClick: async () => { await navigator.clipboard.writeText(exportArena(deck)); toast('Liste copiée dans le presse-papiers.', { kind: 'ok' }); } },
    'sep',
    { heading: 'Versions' },
    { label: 'Enregistrer une version…', onClick: () => saveVersionFlow() },
    { label: 'Versions du deck…', onClick: () => openVersions() },
    { label: 'Comparer…', onClick: () => openCompare({}) },
    { heading: 'Collection' },
    { label: 'Ce deck et mon inventaire', onClick: () => setView('collection') },
    { label: deck.built ? 'Marquer comme non monté' : 'Marquer comme monté', onClick: () => import('./collection.js').then((m) => m.setDeckBuilt(deck.id, !deck.built)) },
    { label: 'Ouvrir l\'inventaire', onClick: () => goInventory() },
    'sep',
    { label: 'Dupliquer le deck', onClick: async () => { await saveNow(); duplicateDeck({ id: deck.id, name: deck.name }); } },
    { label: 'Actualiser les données des cartes', onClick: () => refreshDeckCards({ force: true }) },
    { label: 'Remettre les suggestions rejetées à valider', onClick: () => mutate((d) => { for (const l of d.links) if (l.status === 'rejected' && l.origin !== 'manual') l.status = 'pending'; }, { reason: 'links' }) },
    'sep',
    { label: 'Supprimer le deck…', danger: true, onClick: async () => {
      const ok = await confirmDialog({ title: 'Supprimer le deck', message: `« ${deck.name} » sera placé dans la corbeille de ton ordinateur.`, confirmLabel: 'Supprimer', danger: true });
      if (!ok) return;
      const id = deck.id;
      await closeDeck();
      await api.decks.remove(id);
      await refreshDecks();
      toast('Deck supprimé.');
    } },
  ];
}

// ------------------------------------------------------------------ barre du bas
function renderStatus() {
  const bar = $('statusbar');
  if (!state.deck || state.view === 'library') return;
  clear(bar);
  const s = stats(state.deck);
  const issues = validate(state.deck);
  const max = Math.max(1, ...s.curve);
  const curve = el('div', { class: 'curve', title: 'Courbe de mana (hors terrains)', 'aria-label': `Courbe de mana : ${s.curve.map((n, i) => `${n} carte${n > 1 ? 's' : ''} à ${i}${i === 7 ? '+' : ''}`).join(', ')}` },
    s.curve.map((n, i) => el('div', { class: 'curve-col' }, el('div', { class: 'curve-bar', style: { height: `${Math.round((n / max) * 100)}%` } }), el('span', { class: 'curve-x', text: i === 7 ? '7+' : String(i) }))));
  const pipNames = { W: 'blanc', U: 'bleu', B: 'noir', R: 'rouge', G: 'vert', C: 'incolore' };
  const pips = el('div', { class: 'pip-counts', title: 'Symboles de mana dans les coûts' },
    Object.entries(s.pips).filter(([, n]) => n > 0).map(([k, n]) => el('span', { class: 'pipc', title: `${n} symbole${n > 1 ? 's' : ''} ${pipNames[k]}` }, el('span', { class: `pip pip-${k.toLowerCase()}` }), String(n))));
  const errs = issues.filter((i) => i.level === 'error').length;
  bar.append(
    el('span', { class: `sb-count${s.total === 100 ? ' ok' : s.total > 100 ? ' over' : ''}`, title: 'Cartes du deck, commandant inclus' }, el('strong', { text: String(s.total) }), ' / 100'),
    el('span', { class: 'sb-item', text: `${s.lands} terrains` }),
    el('span', { class: 'sb-item', text: `${s.creatures} créatures` }),
    el('span', { class: 'sb-item', text: `coût moyen ${s.avgMv.toFixed(2).replace('.', ',')}` }),
    curve, pips,
    el('span', { class: 'bar-spacer' }),
    !state.deck.entries.length ? el('span', { class: 'muted', text: 'Deck vide' })
      : issues.length ? el('button', { class: `sb-issues${errs ? ' has-err' : ''}`, type: 'button', on: { click: showIssues } }, icon('warn', 15), `${issues.length} point${issues.length > 1 ? 's' : ''} à vérifier`) : el('span', { class: 'sb-ok', text: 'Construction conforme au format Commander' }));
}

function showIssues() {
  const deck = state.deck;
  const issues = validate(deck);
  const m = modal({
    title: 'Points à vérifier', width: 560,
    body: el('ul', { class: 'issue-list big' }, issues.map((i) => el('li', { class: `issue issue-${i.level}` },
      i.cardId ? el('button', { class: 'link-btn', type: 'button', on: { click: () => { select(i.cardId); m.close(); } } }, nameOf(deck.cards[i.cardId])) : null,
      el('span', { text: ` ${i.text}` })))),
    actions: [
      deck.unresolved.length ? { label: 'Corriger les noms non trouvés…', kind: 'ghost', onClick: () => import('./importer.js').then((mm) => mm.openFixUnresolved()) } : null,
      { label: 'Fermer', kind: 'primary' },
    ].filter(Boolean),
  });
}

// ------------------------------------------------------------------ clavier, collage, dépôt de fichiers
function typing(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function installKeys() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (anyModalOpen()) return;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); return; }
    if (!state.deck || state.view === 'library') {
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newDeckFlow(); }
      return;
    }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); openImporter(); return; }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); searchInput && searchInput.focus(); return; }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (state.view !== 'board') setView('board'); requestAnimationFrame(() => requestAnimationFrame(focusAddBox)); return; }
    if (typing(e)) return;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'l' && state.selection) { e.preventDefault(); openLinkDialog({ from: state.selection }); return; }
    if (mod) return;
    if (e.key === '1') setView('board');
    else if (e.key === '2') setView('graph');
    else if (e.key === '3') setView('links');
    else if (e.key === '4') setView('analysis');
    else if (e.key === '5') setView('collection');
    else if (e.key === '/') { e.preventDefault(); searchInput && searchInput.focus(); }
    else if (e.key === 'Escape') { closeMenu(); if (graphIsLinking()) cancelGraphLinkMode(); else if (state.selection) select(null); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection) {
      const en = state.deck.entries.find((x) => x.oracleId === state.selection && x.zone !== 'commander') || state.deck.entries.find((x) => x.oracleId === state.selection);
      if (en) removeCard(en.oracleId, en.zone, { confirm: true });
    }
  });
}

function installPasteAndDrop() {
  document.addEventListener('paste', (e) => {
    if (typing(e) || anyModalOpen() || !state.deck || state.view === 'library') return;
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text && text.trim()) { e.preventDefault(); openImporter({ text }); }
  });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!/\.(txt|csv|dek|dec|tsv)$/i.test(f.name)) { toast('Dépose un fichier .txt ou .csv contenant ta liste.', { kind: 'error' }); return; }
    if (!state.deck || state.view === 'library') { toast('Ouvre ou crée un deck avant d\'y déposer une liste.', { kind: 'warn' }); return; }
    if (f.size > 5 * 1024 * 1024) { toast('Fichier trop volumineux (5 Mo maximum).', { kind: 'error' }); return; }
    openImporter({ text: await f.text() });
  });
}

window.addEventListener('error', (e) => console.error(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast(`Erreur : ${e.reason && e.reason.message ? e.reason.message : e.reason}`, { kind: 'error' }); });

boot();

// usage interne (tests)
window.__app = { state, relink, select, undo, redo, saveNow, validate, openLinkDialog, setView, mutate , goInventory, openDeck };
