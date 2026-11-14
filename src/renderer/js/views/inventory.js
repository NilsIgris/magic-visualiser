// Onglet Inventaire : cartes possédées, tri et filtres, utilisation par les decks, liste d'achats.
import { el, clear, icon, toast, contextMenu, menuFromButton } from '../ui.js';
import { state, on, openDeck, select, setView } from '../store.js';
import { mainType, TYPE_ORDER } from '../deckops.js';
import { cardImgEl, nameOf, manaCost } from '../cardview.js';
import { attachHover, hide as hideHover } from '../hover.js';
import { inventoryRows, shoppingList } from '../../../shared/inventory.js';
import { normalizeName } from '../../../shared/parser.js';
import {
  currentUsage, entryCard, setOwned, removeOwned, openImport, clearCollection, completeData, inventoryCsv,
  openAddToDeck, collectionStats, setBasicsOwned, missingText, updateCollection,
} from '../collection.js';
import { cardSearch } from '../cardsearch.js';
import { itemKey } from '../importer.js';

const api = window.mtg;
const root = () => document.getElementById('view-inventory');
const ui = { tab: 'cards', q: '', colors: new Set(), type: 'all', usage: 'all', rarity: 'all', sort: 'name', mode: 'list', limit: 200, shopDeck: 'all' };
let bodyEl = null;
let pending = false;
let completedOnce = false;

export function initInventory() {
  const rr = () => { if (state.view === 'inventory') schedule(); };
  on('view', (v) => { if (v === 'inventory') { schedule(true); if (!completedOnce) { completedOnce = true; completeData(); } } });
  on('collection', rr); on('usage', rr); on('decks', rr);
  on('settings', (p) => { if (p && ('nameLang' in p || 'imageLang' in p || 'basicsOwned' in p)) rr(); });
}

let full = true;
function schedule(fullRender = false) {
  full = full || fullRender;
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; if (full || !bodyEl || !root().contains(bodyEl)) render(); else renderBody(); full = false; });
}

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];
const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 5 };
const RARITY_LABEL = { common: 'Commune', uncommon: 'Peu commune', rare: 'Rare', mythic: 'Mythique', special: 'Spéciale', bonus: 'Bonus' };
const TYPE_LABEL = Object.fromEntries(TYPE_ORDER);
const colorKey = (c) => {
  if (mainType(c) === 'land') return 7;
  const cs = c.colors || [];
  if (cs.length > 1) return 5;
  if (!cs.length) return 6;
  return COLOR_ORDER.indexOf(cs[0]);
};

function rowsAll() {
  const u = currentUsage();
  const rows = inventoryRows(state.collection, u.byCard, { basicsOwned: state.settings.basicsOwned !== false, cardOf: (e, id) => entryCard(id, e) });
  return { rows: rows.map((r) => ({ ...r, card: entryCard(r.oracleId, r.entry) })), u };
}

function filtered(rows) {
  const q = normalizeName(ui.q);
  let out = rows.filter((r) => {
    const c = r.card;
    if (q) {
      const hay = normalizeName([c.name, c.printedName, c.typeLine, c.oracleText, ...(c.faces || []).map((f) => `${f.printedName || ''} ${f.printedText || ''}`)].join(' '));
      if (!q.split(' ').every((w) => hay.includes(w))) return false;
    }
    if (ui.colors.size) {
      const cs = c.colors || [];
      const ok = [...ui.colors].some((k) => (k === 'C' ? cs.length === 0 && mainType(c) !== 'land' : k === 'M' ? cs.length > 1 : cs.includes(k)));
      if (!ok) return false;
    }
    if (ui.type !== 'all' && mainType(c) !== ui.type) return false;
    if (ui.rarity !== 'all' && (c.rarity || '') !== ui.rarity) return false;
    if (ui.usage === 'unused' && r.status !== 'unused') return false;
    if (ui.usage === 'used' && r.status === 'unused') return false;
    if (ui.usage === 'conflict' && r.status !== 'conflict') return false;
    if (ui.usage === 'free' && r.available <= 0) return false;
    return true;
  });
  const byName = (a, b) => nameOf(a.card).localeCompare(nameOf(b.card), 'fr');
  const sorts = {
    name: byName,
    color: (a, b) => colorKey(a.card) - colorKey(b.card) || (a.card.cmc || 0) - (b.card.cmc || 0) || byName(a, b),
    type: (a, b) => TYPE_ORDER.findIndex(([k]) => k === mainType(a.card)) - TYPE_ORDER.findIndex(([k]) => k === mainType(b.card)) || byName(a, b),
    cmc: (a, b) => (a.card.cmc || 0) - (b.card.cmc || 0) || byName(a, b),
    rarity: (a, b) => (RARITY_ORDER[b.card.rarity] ?? -1) - (RARITY_ORDER[a.card.rarity] ?? -1) || byName(a, b),
    qty: (a, b) => b.owned - a.owned || byName(a, b),
    available: (a, b) => b.available - a.available || byName(a, b),
    usage: (a, b) => b.decks.length - a.decks.length || b.need - a.need || byName(a, b),
    recent: (a, b) => String(b.entry.addedAt || '').localeCompare(String(a.entry.addedAt || '')) || byName(a, b),
  };
  out.sort(sorts[ui.sort] || byName);
  return out;
}

// ------------------------------------------------------------------ rendu
function render() {
  const r = clear(root());
  hideHover();
  const st = collectionStats();
  const { rows, u } = rowsAll();
  const conflicts = rows.filter((x) => x.status === 'conflict').length;
  const shop = shoppingList(state.collection, u.byCard, u.cardInfo, { basicsOwned: state.settings.basicsOwned !== false });
  const missingCopies = shop.reduce((s, x) => s + x.missing, 0);

  r.append(el('div', { class: 'inv-head' },
    el('div', {},
      el('h1', { class: 'lib-title', text: 'Inventaire' }),
      el('p', { class: 'lib-sub', text: st.distinct ? `${st.distinct} cartes différentes, ${st.total} exemplaires${conflicts ? `, ${conflicts} carte${conflicts > 1 ? 's' : ''} demandée${conflicts > 1 ? 's' : ''} par plus de decks que tu n'as d'exemplaires` : ''}.` : 'Les cartes que tu possèdes, pour savoir ce qui manque à chaque deck et où sont tes exemplaires.' })),
    el('div', { class: 'lib-actions' },
      el('button', { class: 'btn btn-primary', type: 'button', on: { click: openImport } }, icon('upload'), 'Importer des cartes'),
      el('button', { class: 'icon-btn', type: 'button', title: 'Autres actions', 'aria-label': 'Autres actions de l\'inventaire', on: { click: (e) => menuFromButton(e.currentTarget, [
        { label: 'Exporter l\'inventaire (.csv)…', disabled: !st.distinct, onClick: async () => { const f = await api.files.save({ defaultName: 'Inventaire MTG.csv', filters: [{ name: 'CSV', extensions: ['csv'] }], content: inventoryCsv(filtered(rowsAll().rows)) }); if (f) toast(`Fichier enregistré : ${f}`, { kind: 'ok' }); } },
        { label: 'Vider l\'inventaire…', danger: true, disabled: !st.distinct, onClick: clearCollection },
      ]) } }, icon('more')))));

  r.append(el('div', { class: 'inv-tabs' },
    el('div', { class: 'tabs', role: 'tablist' },
      el('button', { class: `tab${ui.tab === 'cards' ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(ui.tab === 'cards'), on: { click: () => { ui.tab = 'cards'; render(); } } }, 'Mes cartes', el('span', { class: 'tab-n', text: String(st.distinct) })),
      el('button', { class: `tab${ui.tab === 'shop' ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(ui.tab === 'shop'), on: { click: () => { ui.tab = 'shop'; render(); } } }, 'À acquérir', el('span', { class: `tab-n${missingCopies ? ' attention' : ''}`, text: String(missingCopies) }))),
    el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: state.settings.basicsOwned !== false, on: { change: (e) => setBasicsOwned(e.target.checked) } }), el('span', { text: 'Terrains de base considérés comme possédés' }))));

  const pendingData = Object.values(state.collection.cards).filter((e) => !e.card).length;
  if (pendingData) r.append(el('p', { class: 'inv-note' }, `${pendingData} carte${pendingData > 1 ? 's' : ''} importée${pendingData > 1 ? 's' : ''} avec une ancienne version n'ont pas encore leur visuel ni leur type. `, el('button', { class: 'link-btn', type: 'button', on: { click: () => completeData() } }, 'Les récupérer')));
  if ((state.collection.unresolved || []).length) {
    r.append(el('details', { class: 'ignored inv-unres' }, el('summary', { text: `${state.collection.unresolved.length} ligne${state.collection.unresolved.length > 1 ? 's' : ''} non reconnue${state.collection.unresolved.length > 1 ? 's' : ''} lors du dernier import` }),
      el('ul', {}, state.collection.unresolved.slice(0, 200).map((t) => el('li', { text: t }))),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => updateCollection((c) => { c.unresolved = []; }) } }, 'Masquer')));
  }

  if (ui.tab === 'shop') { r.append(shopPanel(shop, u)); bodyEl = null; return; }
  if (!st.distinct) {
    r.append(el('div', { class: 'lib-empty' },
      el('div', { class: 'lib-empty-art', 'aria-hidden': 'true' }, el('span'), el('span'), el('span')),
      el('h2', { text: 'Ton inventaire est vide' }),
      el('p', { text: 'Importe l\'export de ton application de collection (ManaBox, Moxfield, Delver Lens…) ou une liste « quantité nom ». Chaque deck indiquera ensuite les cartes qui lui manquent et celles qu\'il partage avec tes autres decks.' }),
      el('button', { class: 'btn btn-primary btn-lg', type: 'button', on: { click: openImport } }, icon('upload'), 'Importer des cartes'),
      el('div', { class: 'empty-add' }, addBox())));
    bodyEl = null;
    return;
  }
  r.append(filterBar());
  bodyEl = el('div', { class: 'inv-body' });
  r.append(bodyEl);
  renderBody();
}

function addBox() {
  const { box } = cardSearch({
    placeholder: 'Ajouter une carte possédée', label: 'Ajouter une carte à l\'inventaire',
    onChoose: async (name, label) => {
      try {
        const wantFr = state.settings.imageLang === 'fr' || state.settings.nameLang === 'fr';
        const res = await api.scryfall.resolve([{ name }], { wantFr });
        const card = new Map(res.resolved).get(itemKey({ name }));
        if (!card) { toast(`Carte introuvable : « ${label} ».`, { kind: 'error' }); return; }
        const c = { ...card }; delete c._printKey;
        const prev = state.collection.cards[card.oracleId];
        setOwned(card.oracleId, (prev ? prev.qty : 0) + 1, c);
        toast(prev ? `« ${nameOf(c)} » : ${prev.qty + 1} exemplaires.` : `« ${nameOf(c)} » ajoutée à l'inventaire.`, { kind: 'ok' });
      } catch (e) { toast(`Ajout impossible : ${e.message}`, { kind: 'error' }); }
    },
  });
  return box;
}

function filterBar() {
  const search = el('input', { class: 'input inv-search', type: 'search', placeholder: 'Filtrer (nom, type, texte)', value: ui.q, 'aria-label': 'Filtrer l\'inventaire', spellcheck: 'false',
    on: { input: (e) => { ui.q = e.target.value; ui.limit = 200; renderBody(); } } });
  const colorBtn = (k, label) => el('button', { class: `color-tg${ui.colors.has(k) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(ui.colors.has(k)), title: label, 'aria-label': label,
    on: { click: (e) => { if (ui.colors.has(k)) ui.colors.delete(k); else ui.colors.add(k); e.currentTarget.classList.toggle('on'); e.currentTarget.setAttribute('aria-pressed', String(ui.colors.has(k))); ui.limit = 200; renderBody(); } } },
  k === 'M' ? el('span', { class: 'pip pip-multi' }) : el('span', { class: `pip pip-${k.toLowerCase()}` }));
  const sel = (key, label, opts) => el('label', { class: 'inline-field' }, el('span', { text: label }), el('select', { class: 'select', on: { change: (e) => { ui[key] = e.target.value; ui.limit = 200; renderBody(); } } },
    opts.map(([v, l]) => el('option', { value: v, selected: ui[key] === v }, l))));
  return el('div', { class: 'inv-bar' },
    el('div', { class: 'inv-bar-row' },
      addBox(),
      search,
      el('div', { class: 'color-tgs', role: 'group', 'aria-label': 'Couleurs' }, [['W', 'Blanc'], ['U', 'Bleu'], ['B', 'Noir'], ['R', 'Rouge'], ['G', 'Vert'], ['C', 'Incolore'], ['M', 'Multicolore']].map(([k, l]) => colorBtn(k, l))),
      el('span', { class: 'bar-spacer' }),
      el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Affichage' },
        [['list', 'Liste'], ['grid', 'Images']].map(([k, l]) => el('button', { class: `seg-btn${ui.mode === k ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(ui.mode === k), on: { click: () => { ui.mode = k; render(); } } }, l)))),
    el('div', { class: 'inv-bar-row' },
      sel('type', 'Type', [['all', 'Tous'], ...TYPE_ORDER.filter(([k]) => k !== 'commander')]),
      sel('rarity', 'Rareté', [['all', 'Toutes'], ...Object.entries(RARITY_LABEL).slice(0, 4)]),
      sel('usage', 'Utilisation', [['all', 'Toutes'], ['free', 'Exemplaires libres'], ['used', 'Dans au moins un deck'], ['conflict', 'Pas assez d\'exemplaires'], ['unused', 'Dans aucun deck']]),
      sel('sort', 'Trier par', [['name', 'Nom'], ['color', 'Couleur'], ['type', 'Type'], ['cmc', 'Coût'], ['rarity', 'Rareté'], ['qty', 'Quantité'], ['available', 'Exemplaires libres'], ['usage', 'Nombre de decks'], ['recent', 'Ajout récent']])));
}

function renderBody() {
  if (!bodyEl) return;
  const top = root().scrollTop;
  clear(bodyEl);
  hideHover();
  const list = filtered(rowsAll().rows);
  const shown = list.slice(0, ui.limit);
  const copies = list.reduce((s, r) => s + r.owned, 0);
  bodyEl.append(el('p', { class: 'inv-count', text: `${list.length} carte${list.length > 1 ? 's' : ''} (${copies} exemplaire${copies > 1 ? 's' : ''})${ui.q || ui.colors.size || ui.type !== 'all' || ui.rarity !== 'all' || ui.usage !== 'all' ? ' correspondent aux filtres' : ''}.` }));
  if (!list.length) { bodyEl.append(el('p', { class: 'links-none', text: 'Aucune carte ne correspond aux filtres.' })); return; }
  const box = el('div', { class: ui.mode === 'grid' ? 'inv-grid' : 'inv-list', role: 'list' });
  for (const r of shown) box.append(ui.mode === 'grid' ? gridItem(r) : listRow(r));
  bodyEl.append(box);
  if (list.length > shown.length) bodyEl.append(el('div', { class: 'inv-more' }, el('button', { class: 'btn btn-ghost', type: 'button', on: { click: () => { ui.limit += 200; renderBody(); } } }, `Afficher ${Math.min(200, list.length - shown.length)} de plus (${list.length - shown.length} restantes)`)));
  root().scrollTop = top;
}

function statusEl(r) {
  if (r.status === 'unused') return el('span', { class: 'inv-st st-unused', text: 'Dans aucun deck' });
  if (r.basic) return el('span', { class: 'inv-st st-unused', title: 'Terrains de base considérés comme possédés sans limite (réglage)', text: 'Terrain de base' });
  if (r.status === 'conflict') return el('span', { class: 'inv-st st-conflict', title: `Tes decks en demandent ${r.need} pour ${r.owned} possédé${r.owned > 1 ? 's' : ''}.` }, icon('warn', 14), `Il en manque ${r.need - r.owned}`);
  return el('span', { class: 'inv-st st-free', text: r.available ? `${r.available} libre${r.available > 1 ? 's' : ''}` : 'Tous utilisés' });
}

function deckChips(r) {
  if (!r.decks.length) return el('span', { class: 'muted small', text: '—' });
  return el('div', { class: 'inv-decks' }, r.decks.map((d) => el('button', {
    class: `deck-chip${d.built ? ' built' : ''}`, type: 'button', title: `${d.name}${d.built ? ' (monté)' : ''} : ${d.qty} exemplaire${d.qty > 1 ? 's' : ''}. Cliquer pour ouvrir le deck sur cette carte.`,
    on: { click: async () => { await openDeck(d.deckId); select(r.oracleId); } },
  }, d.built ? icon('check', 12) : null, el('span', { text: d.name }), d.qty > 1 ? el('span', { class: 'deck-chip-q', text: `×${d.qty}` }) : null)));
}

function stepper(r) {
  return el('div', { class: 'stepper', role: 'group', 'aria-label': `Quantité possédée de ${nameOf(r.card)}` },
    el('button', { class: 'icon-btn icon-sm', type: 'button', 'aria-label': 'Un exemplaire de moins', on: { click: () => (r.owned <= 1 ? removeOwned(r.oracleId) : setOwned(r.oracleId, r.owned - 1)) } }, icon('minus', 14)),
    el('span', { class: 'stepper-v', text: String(r.owned) }),
    el('button', { class: 'icon-btn icon-sm', type: 'button', 'aria-label': 'Un exemplaire de plus', on: { click: () => setOwned(r.oracleId, r.owned + 1) } }, icon('plus', 14)));
}

function rowMenu(x, y, r) {
  contextMenu(x, y, [
    { heading: nameOf(r.card) },
    { label: 'Ajouter à un deck…', onClick: () => openAddToDeck(r.oracleId) },
    { label: 'Un exemplaire de plus', onClick: () => setOwned(r.oracleId, r.owned + 1) },
    { label: 'Un exemplaire de moins', onClick: () => (r.owned <= 1 ? removeOwned(r.oracleId) : setOwned(r.oracleId, r.owned - 1)) },
    'sep',
    { label: 'Ouvrir sur Scryfall', disabled: !r.card.scryfallUri, onClick: () => api.shell.openExternal(r.card.scryfallUri) },
    { label: 'Retirer de l\'inventaire', danger: true, onClick: () => removeOwned(r.oracleId) },
  ]);
}

function listRow(r) {
  const c = r.card;
  const thumb = el('div', { class: 'inv-thumb' }, cardImgEl(c, { size: 'artCrop', className: 'thumb-img' }));
  attachHover(thumb, () => c);
  return el('div', { class: `inv-row st-${r.status}`, role: 'listitem', on: { contextmenu: (e) => { e.preventDefault(); rowMenu(e.clientX, e.clientY, r); } } },
    thumb,
    el('div', { class: 'inv-name' }, el('strong', { text: nameOf(c) }), el('span', { class: 'muted small', text: [c.typeLine, RARITY_LABEL[c.rarity]].filter(Boolean).join(', ') })),
    el('div', { class: 'inv-cost' }, c.manaCost ? manaCost(c.manaCost) : null),
    stepper(r),
    deckChips(r),
    statusEl(r),
    el('div', { class: 'inv-act' },
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Ajouter cette carte à un de tes decks', on: { click: () => openAddToDeck(r.oracleId) } }, icon('plus', 15), 'Deck'),
      el('button', { class: 'icon-btn', type: 'button', title: 'Plus d\'actions', 'aria-label': `Actions pour ${nameOf(c)}`, on: { click: (e) => { const b = e.currentTarget.getBoundingClientRect(); rowMenu(b.left, b.bottom + 4, r); } } }, icon('more'))));
}

function gridItem(r) {
  const c = r.card;
  const img = el('button', { class: 'inv-card', type: 'button', 'aria-label': `${nameOf(c)}, ${r.owned} exemplaire${r.owned > 1 ? 's' : ''}`,
    on: { click: () => openAddToDeck(r.oracleId), contextmenu: (e) => { e.preventDefault(); rowMenu(e.clientX, e.clientY, r); } } },
  cardImgEl(c, { size: 'normal', className: 'card-img' }), el('span', { class: 'badge badge-qty inv-q', text: `×${r.owned}` }));
  attachHover(img, () => c);
  return el('div', { class: `inv-cell st-${r.status}`, role: 'listitem' }, img, el('div', { class: 'inv-cell-foot' }, statusEl(r), stepper(r)), r.decks.length ? el('p', { class: 'inv-cell-decks', text: r.decks.map((d) => d.name).join(', ') }) : null);
}

// ------------------------------------------------------------------ à acquérir
function shopPanel(all, u) {
  const deckOpts = [['all', 'Tous mes decks en même temps'], ...state.decks.map((d) => [d.id, d.name])];
  const list = ui.shopDeck === 'all' ? all : shoppingList(state.collection, u.byCard, u.cardInfo, { deckId: ui.shopDeck, basicsOwned: state.settings.basicsOwned !== false });
  const copies = list.reduce((s, x) => s + x.missing, 0);
  const box = el('div', { class: 'inv-shop' },
    el('div', { class: 'inv-bar-row' },
      el('label', { class: 'inline-field' }, el('span', { text: 'Pour monter' }), el('select', { class: 'select', on: { change: (e) => { ui.shopDeck = e.target.value; render(); } } }, deckOpts.map(([v, l]) => el('option', { value: v, selected: ui.shopDeck === v }, l)))),
      el('span', { class: 'bar-spacer' }),
      list.length ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: async () => { await navigator.clipboard.writeText(missingText(list)); toast('Liste copiée (noms anglais, format importable).', { kind: 'ok' }); } } }, icon('copy', 16), 'Copier la liste') : null),
    el('p', { class: 'muted', text: ui.shopDeck === 'all'
      ? `Pour avoir tous tes decks montés en même temps, il te manque ${copies} exemplaire${copies > 1 ? 's' : ''} (${list.length} carte${list.length > 1 ? 's' : ''}). Les cartes partagées entre decks comptent une fois par deck.`
      : `Pour ce deck seul, il te manque ${copies} exemplaire${copies > 1 ? 's' : ''}, sans défaire tes autres decks.` }));
  if (!state.decks.length) { box.append(el('p', { class: 'links-none', text: 'Crée un deck pour voir ce qui te manque.' })); return box; }
  if (!list.length) { box.append(el('p', { class: 'links-none', text: 'Tu possèdes tout ce qu\'il faut.' })); return box; }
  const rows = el('div', { class: 'inv-list', role: 'list' });
  for (const s of list) {
    const c = u.cardInfo.get(s.oracleId) || { name: s.name };
    const thumb = el('div', { class: 'inv-thumb' }, cardImgEl(c, { size: 'artCrop', className: 'thumb-img' }));
    attachHover(thumb, () => c);
    rows.append(el('div', { class: 'inv-row shop-row', role: 'listitem' },
      thumb,
      el('div', { class: 'inv-name' }, el('strong', { text: nameOf(c) }), el('span', { class: 'muted small', text: s.owned ? `Tu en as ${s.owned}, il en faut ${s.need}` : `Il en faut ${s.need}` })),
      el('span', { class: 'shop-miss', text: `${s.missing} à acquérir` }),
      deckChips({ ...s, decks: s.decks }),
      el('div', { class: 'inv-act' }, el('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Ajoute ces exemplaires à ton inventaire', on: { click: () => { setOwned(s.oracleId, s.owned + s.missing, c); toast(`${s.missing} « ${nameOf(c)} » ajouté${s.missing > 1 ? 's' : ''} à l'inventaire.`, { kind: 'ok' }); } } }, icon('check', 15), 'Acquise'))));
  }
  box.append(rows);
  return box;
}

export function showInventory() { setView('inventory'); }
