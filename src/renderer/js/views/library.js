// Accueil : liste des decks enregistrés.
import { el, clear, icon, contextMenu, menuFromButton, promptDialog, confirmDialog, toast, formatDate } from '../ui.js';
import { state, on, openDeck, createDeck, refreshDecks } from '../store.js';
import { proxied, colorPips } from '../cardview.js';
import { preferredImages, displayName } from '../../../shared/normalize.js';

const api = window.mtg;
const root = () => document.getElementById('view-library');

export function initLibrary() {
  on('decks', render);
  on('settings', () => { if (state.view === 'library') render(); });
  on('view', (v) => { if (v === 'library') render(); });
}

export async function newDeckFlow() {
  const name = await promptDialog({ title: 'Nouveau deck', label: 'Nom du deck', placeholder: 'Ex. : Ghave aristocrates', confirmLabel: 'Créer le deck' });
  if (name) await createDeck(name);
}

async function importDeckFile() {
  try {
    const s = await api.decks.importFile();
    if (!s) return;
    await refreshDecks();
    toast(`Deck « ${s.name} » importé.`, { kind: 'ok', action: { label: 'Ouvrir', fn: () => openDeck(s.id) } });
  } catch (e) { toast(e.message, { kind: 'error' }); }
}

function render() {
  const r = clear(root());
  const decks = state.decks;
  r.append(el('div', { class: 'lib-head' },
    el('div', {},
      el('h1', { class: 'lib-title', text: 'Mes decks' }),
      el('p', { class: 'lib-sub', text: decks.length ? `${decks.length} deck${decks.length > 1 ? 's' : ''} enregistré${decks.length > 1 ? 's' : ''} sur cet ordinateur` : 'Tes decks sont enregistrés sur cet ordinateur, sans compte en ligne.' })),
    el('div', { class: 'lib-actions' },
      el('button', { class: 'btn btn-ghost', type: 'button', on: { click: importDeckFile } }, icon('upload'), 'Importer un fichier de deck'),
      el('button', { class: 'btn btn-primary', type: 'button', on: { click: newDeckFlow } }, icon('plus'), 'Nouveau deck'))));

  if (!decks.length) {
    r.append(el('div', { class: 'lib-empty' },
      el('div', { class: 'lib-empty-art', 'aria-hidden': 'true' }, el('span'), el('span'), el('span')),
      el('h2', { text: 'Commence par créer un deck' }),
      el('p', { text: 'Colle ensuite ta liste (format simple, Arena/MTGO ou CSV) : les visuels sont préparés et les interactions entre tes cartes sont proposées automatiquement.' }),
      el('button', { class: 'btn btn-primary btn-lg', type: 'button', on: { click: newDeckFlow } }, icon('plus'), 'Nouveau deck')));
    return;
  }
  const grid = el('div', { class: 'lib-grid', role: 'list' });
  for (const d of decks) grid.append(deckTile(d));
  r.append(grid);
}

function deckTile(d) {
  const cmd = d.commanders[0];
  const imgs = cmd && cmd.images ? preferredImages({ images: cmd.images }, state.settings.imageLang) : null;
  const art = imgs && imgs[0] ? proxied(imgs[0].artCrop || imgs[0].normal) : null;
  const cmdName = cmd ? d.commanders.map((c) => displayName(c, state.settings.nameLang)).join(' & ') : 'Sans commandant';
  const open = () => openDeck(d.id).catch((e) => toast(e.message, { kind: 'error' }));
  const menu = (x, y) => contextMenu(x, y, deckMenu(d));
  const more = el('button', { class: 'icon-btn tile-more', type: 'button', 'aria-label': `Actions pour ${d.name}`, title: 'Actions', on: { click: (e) => { e.stopPropagation(); menuFromButton(e.currentTarget, deckMenu(d)); } } }, icon('more'));
  const cover = el('div', { class: `deck-cover${art ? '' : ' no-art'}` }, art ? el('img', { src: art, alt: '', draggable: 'false', loading: 'lazy' }) : el('span', { class: 'deck-initial', text: (d.name || '?').slice(0, 1).toUpperCase() }));
  const img = cover.querySelector('img');
  if (img) img.addEventListener('error', () => { cover.classList.add('no-art'); img.replaceWith(el('span', { class: 'deck-initial', text: (d.name || '?').slice(0, 1).toUpperCase() })); }, { once: true });
  return el('article', {
    class: 'deck-tile', role: 'listitem', tabindex: '0',
    on: {
      click: open,
      keydown: (e) => { if (e.key === 'Enter') open(); if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { const r = e.currentTarget.getBoundingClientRect(); menu(r.left + 20, r.top + 20); e.preventDefault(); } },
      contextmenu: (e) => { e.preventDefault(); menu(e.clientX, e.clientY); },
    },
  },
  cover,
  el('div', { class: 'deck-info' },
    el('h3', { class: 'deck-name', text: d.name }),
    el('p', { class: 'deck-cmd', text: cmdName }),
    el('div', { class: 'deck-meta' },
      el('span', { class: `deck-count${d.count === 100 ? ' ok' : ''}`, text: `${d.count} / 100` }),
      d.built ? el('span', { class: 'tag tag-built', title: 'Les cartes de ce deck sont physiquement rangées dedans', text: 'Monté' }) : null,
      d.identity.length ? colorPips(d.identity) : null,
      el('span', { class: 'deck-date', text: formatDate(d.updatedAt) }))),
  more);
}

function deckMenu(d) {
  return [
    { label: 'Ouvrir', onClick: () => openDeck(d.id) },
    { label: 'Renommer…', onClick: () => renameDeck(d) },
    { label: d.built ? 'Marquer comme non monté' : 'Marquer comme monté', onClick: () => import('../collection.js').then((m) => m.setDeckBuilt(d.id, !d.built)) },
    { label: 'Dupliquer', onClick: () => duplicateDeck(d) },
    { label: 'Exporter le deck (.json)…', onClick: () => exportDeckJson(d.id) },
    'sep',
    { label: 'Supprimer…', danger: true, onClick: () => deleteDeck(d) },
  ];
}

async function renameDeck(d) {
  const name = await promptDialog({ title: 'Renommer le deck', label: 'Nom du deck', value: d.name, confirmLabel: 'Renommer' });
  if (!name || name === d.name) return;
  const deck = await api.decks.load(d.id);
  deck.name = name; deck.updatedAt = new Date().toISOString();
  await api.decks.save(deck);
  await refreshDecks();
}

export async function duplicateDeck(d) {
  const deck = await api.decks.load(d.id);
  deck.id = await api.decks.newId();
  deck.name = `${d.name} (copie)`;
  deck.createdAt = deck.updatedAt = new Date().toISOString();
  await api.decks.save(deck);
  await refreshDecks();
  toast(`« ${deck.name} » créé.`, { kind: 'ok', action: { label: 'Ouvrir', fn: () => openDeck(deck.id) } });
}

export async function exportDeckJson(id) {
  const deck = await api.decks.load(id);
  const name = await api.files.save({ defaultName: `${safeName(deck.name)}.json`, filters: [{ name: 'Deck MTG Deck Lab', extensions: ['json'] }], content: JSON.stringify(deck, null, 2) });
  if (name) toast(`Deck exporté : ${name}`, { kind: 'ok' });
}

export function safeName(s) { return String(s || 'deck').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'deck'; }

async function deleteDeck(d) {
  const ok = await confirmDialog({ title: 'Supprimer le deck', message: `« ${d.name} » sera placé dans la corbeille de ton ordinateur.`, confirmLabel: 'Supprimer', danger: true });
  if (!ok) return;
  try { await api.decks.remove(d.id); await refreshDecks(); toast(`« ${d.name} » supprimé.`); } catch (e) { toast(e.message, { kind: 'error' }); }
}
