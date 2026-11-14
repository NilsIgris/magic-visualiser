// Board de préparation : cartes en piles (par type, coût, couleur ou piles personnelles).
import { el, clear, icon, contextMenu } from '../ui.js';
import { state, on, select, setSetting } from '../store.js';
import { mainType, TYPE_ORDER, ZONE_LABELS, validate, effectiveFunctions, FUNCTIONS } from '../deckops.js';
import { addCardBox } from '../addcard.js';
import { deckRows } from '../collection.js';
import { cardImgEl, nameOf } from '../cardview.js';
import { attachHover, hide as hideHover } from '../hover.js';
import { cardMenu, moveCard, setPile, newPile, renamePile, deletePile } from '../actions.js';
import { normalizeName } from '../../../shared/parser.js';

const root = () => document.getElementById('view-board');
let pendingRender = false;

export function initBoard() {
  const rerender = () => { if (state.view === 'board') schedule(); };
  on('deck', rerender);
  on('view', rerender);
  on('search', rerender);
  on('settings', (p) => { if (p && ('tileSize' in p || 'boardGroup' in p || 'imageLang' in p || 'nameLang' in p)) rerender(); });
  on('collection', rerender);
  on('usage', rerender);
  on('selection', () => {
    if (state.view !== 'board') return;
    for (const n of root().querySelectorAll('.tile.selected')) n.classList.remove('selected');
    if (state.selection) for (const n of root().querySelectorAll(`.tile[data-id="${CSS.escape(state.selection)}"]`)) n.classList.add('selected');
  });
}

function schedule() {
  if (pendingRender) return;
  pendingRender = true;
  requestAnimationFrame(() => { pendingRender = false; render(); });
}

export function matchesSearch(card, q) {
  if (!q) return true;
  const n = normalizeName(q);
  const hay = normalizeName([card.name, card.printedName, card.typeLine, card.oracleText, ...(card.faces || []).map((f) => f.printedText || '')].join(' \n '));
  return n.split(' ').every((w) => hay.includes(w));
}

const GROUPS = [
  ['type', 'Type'],
  ['cmc', 'Coût'],
  ['color', 'Couleur'],
  ['role', 'Rôle'],
  ['piles', 'Mes piles'],
];

const ROLE_ORDER = ['wipe', 'removal', 'ramp', 'draw', 'tutor', 'protection', 'recursion'];
let curMissing = new Map();

function groupKey(card, mode, e) {
  if (mode === 'type') return mainType(card);
  if (mode === 'cmc') return mainType(card) === 'land' ? 'land' : String(Math.min(7, Math.round(Number(card.cmc) || 0)));
  if (mode === 'color') {
    if (mainType(card) === 'land') return 'land';
    const c = card.colors || [];
    if (c.length > 1) return 'multi';
    return c[0] || 'colorless';
  }
  if (mode === 'piles') return e.pile || 'none';
  if (mode === 'role') {
    if (mainType(card) === 'land') return 'land';
    const f = effectiveFunctions(state.deck, card.oracleId, state.roles);
    return ROLE_ORDER.find((k) => f.includes(k)) || 'none';
  }
  return 'other';
}

function groupDefs(mode, deck) {
  if (mode === 'type') return TYPE_ORDER.filter(([k]) => k !== 'commander');
  if (mode === 'cmc') return [...Array.from({ length: 7 }, (_, i) => [String(i), `Coût ${i}`]), ['7', 'Coût 7+'], ['land', 'Terrains']];
  if (mode === 'color') return [['W', 'Blanc'], ['U', 'Bleu'], ['B', 'Noir'], ['R', 'Rouge'], ['G', 'Vert'], ['multi', 'Multicolore'], ['colorless', 'Incolore'], ['land', 'Terrains']];
  if (mode === 'piles') return [...deck.piles.map((p) => [p.id, p.name]), ['none', 'Sans pile']];
  if (mode === 'role') return [...ROLE_ORDER.map((k) => [k, FUNCTIONS[k]]), ['none', 'Autres cartes'], ['land', 'Terrains']];
  return [];
}

function render() {
  const addBox = addCardBox();
  const addFocused = addBox.contains(document.activeElement);
  const r = clear(root());
  const deck = state.deck;
  if (!deck) return;
  const refocus = () => { if (addFocused) { const i = addBox.querySelector('input'); if (i && !i.disabled) i.focus(); } };
  hideHover();
  const mode = state.settings.boardGroup || 'type';
  const size = state.settings.tileSize || 150;

  const playing = deck.entries.filter((e) => deck.cards[e.oracleId]);
  if (!playing.length) { r.append(emptyBoard(deck, addBox)); refocus(); return; }

  const issues = validate(deck);
  const issueIds = new Set(issues.filter((i) => i.cardId).map((i) => i.cardId));
  curMissing = new Map(deckRows(deck).filter((m) => m.status !== 'free').map((m) => [m.oracleId, m]));
  const linkCount = new Map();
  for (const l of deck.links) {
    if (l.status === 'rejected') continue;
    for (const id of [l.from, l.to]) {
      const c = linkCount.get(id) || { a: 0, p: 0 };
      if (l.status === 'accepted') c.a++; else c.p++;
      linkCount.set(id, c);
    }
  }

  const q = state.search.trim();
  let shown = 0; let totalCards = 0;
  const columns = [];
  const pushCol = (key, label, entries, drop) => columns.push({ key, label, entries, drop });

  const byZone = (z) => playing.filter((e) => e.zone === z);
  const sortFn = (a, b) => {
    const ca = deck.cards[a.oracleId]; const cb = deck.cards[b.oracleId];
    return (Number(ca.cmc) || 0) - (Number(cb.cmc) || 0) || nameOf(ca).localeCompare(nameOf(cb), 'fr');
  };
  const filt = (list) => list.filter((e) => { totalCards += e.qty; const ok = matchesSearch(deck.cards[e.oracleId], q); if (ok) shown += e.qty; return ok; });

  const cmd = filt(byZone('commander'));
  pushCol('commander', 'Commandant', cmd.sort(sortFn), { zone: 'commander' });
  const main = filt(byZone('main'));
  for (const [key, label] of groupDefs(mode, deck)) {
    const list = main.filter((e) => groupKey(deck.cards[e.oracleId], mode, e) === key).sort(sortFn);
    if (!list.length && !(mode === 'piles')) continue;
    pushCol(`g:${key}`, label, list, mode === 'piles' ? { zone: 'main', pile: key === 'none' ? null : key } : { zone: 'main' });
  }
  for (const z of ['maybe', 'side']) {
    const list = filt(byZone(z)).sort(sortFn);
    pushCol(z, ZONE_LABELS[z], list, { zone: z });
  }

  // barre d'outils
  const bar = el('div', { class: 'board-bar' },
    addBox,
    el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Regrouper les cartes par' },
      el('span', { class: 'seg-label', text: 'Regrouper par' }),
      GROUPS.map(([k, l]) => el('button', { class: `seg-btn${mode === k ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(mode === k), on: { click: () => setSetting({ boardGroup: k }) } }, l))),
    mode === 'piles' ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => newPile() } }, icon('plus'), 'Nouvelle pile') : null,
    el('div', { class: 'bar-spacer' }),
    q ? el('span', { class: 'board-count', text: `${shown} / ${totalCards} cartes affichées` }) : null,
    el('label', { class: 'zoom' }, el('span', { class: 'sr-only', text: 'Taille des cartes' }),
      el('span', { class: 'zoom-small', 'aria-hidden': 'true' }),
      el('input', { type: 'range', min: '100', max: '240', step: '10', value: String(size), 'aria-label': 'Taille des cartes', on: { input: (e) => { document.documentElement.style.setProperty('--tile-w', `${e.target.value}px`); }, change: (e) => setSetting({ tileSize: Number(e.target.value) }) } }),
      el('span', { class: 'zoom-big', 'aria-hidden': 'true' })));
  r.append(bar);
  refocus();
  if (mode === 'piles' && !deck.piles.length) {
    r.append(el('p', { class: 'board-hint', text: 'Crée des piles (Rampe, Pioche, Retraits…) puis glisse tes cartes dedans. Les piles sont propres à ce deck.' }));
  }

  // Répartition en colonnes équilibrées (comme des piles posées sur un tapis)
  document.documentElement.style.setProperty('--tile-w', `${size}px`);
  const stacks = el('div', { class: 'stacks' });
  const nLanes = laneCount(size);
  lastLanes = nLanes;
  const tileH = size * (680 / 488);
  const strip = tileH - size * 1.2;
  const lanes = Array.from({ length: nLanes }, () => ({ node: el('div', { class: 'lane' }), h: 0 }));
  for (const col of columns) {
    const n = col.entries.length;
    const est = 44 + (n ? tileH + (n - 1) * strip : size * 0.6) + 26;
    let best = lanes[0];
    for (const l of lanes) if (l.h < best.h - 1) best = l;
    best.node.append(column(col, deck, issueIds, linkCount, mode));
    best.h += est;
  }
  for (const l of lanes) stacks.append(l.node);
  r.append(stacks);
}

let lastLanes = 0;
function laneCount(size) {
  const w = root().clientWidth - 36;
  return Math.max(1, Math.floor((w + 20) / (size + 20)));
}
const onResize = () => { if (state.view === 'board' && state.deck && laneCount(state.settings.tileSize || 150) !== lastLanes) schedule(); };
new ResizeObserver(() => requestAnimationFrame(onResize)).observe(document.getElementById('view-board'));

function column(col, deck, issueIds, linkCount, mode) {
  const count = col.entries.reduce((s, e) => s + e.qty, 0);
  const isPile = mode === 'piles' && col.key.startsWith('g:') && col.key !== 'g:none';
  const pileId = isPile ? col.key.slice(2) : null;
  const head = el('div', { class: 'stack-head' },
    el('h3', { class: 'stack-title', text: col.label }),
    el('span', { class: 'stack-count', text: String(count) }),
    isPile ? el('button', { class: 'icon-btn icon-sm', type: 'button', 'aria-label': `Actions de la pile ${col.label}`, on: { click: (e) => { const b = e.currentTarget.getBoundingClientRect(); contextMenu(b.left, b.bottom + 4, [{ label: 'Renommer…', onClick: () => renamePile(pileId) }, { label: 'Supprimer la pile', danger: true, onClick: () => deletePile(pileId) }]); } } }, icon('more', 16)) : null);
  const body = el('div', { class: 'stack-body' });
  for (const e of col.entries) body.append(tile(e, deck, issueIds, linkCount));
  if (!col.entries.length) body.append(el('div', { class: 'stack-empty', text: 'Glisse des cartes ici' }));
  const node = el('section', { class: `stack stack-${col.key.replace(/[^a-z0-9]/gi, '')}${col.key === 'commander' ? ' stack-cmd' : ''}`, 'aria-label': `${col.label}, ${count} cartes` }, head, body);
  // glisser-déposer
  node.addEventListener('dragover', (ev) => { if (state.dragging) { ev.preventDefault(); node.classList.add('drop-on'); } });
  node.addEventListener('dragleave', (ev) => { if (!node.contains(ev.relatedTarget)) node.classList.remove('drop-on'); });
  node.addEventListener('drop', (ev) => {
    ev.preventDefault(); node.classList.remove('drop-on');
    const drag = state.dragging; state.dragging = null;
    if (!drag) return;
    const target = col.drop;
    if (target.zone !== drag.zone) moveCard(drag.oracleId, drag.zone, target.zone, { qty: target.zone === 'commander' ? 1 : null });
    if ('pile' in target && target.zone === 'main') setPile(drag.oracleId, target.zone, target.pile);
  });
  return node;
}

function tile(e, deck, issueIds, linkCount) {
  const card = deck.cards[e.oracleId];
  const lc = linkCount.get(e.oracleId);
  const badges = el('div', { class: 'tile-badges' },
    issueIds.has(e.oracleId) && e.zone !== 'side' && e.zone !== 'maybe' ? el('span', { class: 'badge badge-warn', title: 'Problème de construction (voir la barre du bas)' }, icon('warn', 13)) : null,
    lc ? el('span', { class: `badge badge-links${lc.a ? '' : ' only-pending'}`, title: `${lc.a} lien${lc.a > 1 ? 's' : ''} validé${lc.a > 1 ? 's' : ''}, ${lc.p} suggestion${lc.p > 1 ? 's' : ''}` }, icon('link', 13), String(lc.a + lc.p)) : null,
    card.gameChanger ? el('span', { class: 'badge badge-gc', title: 'Game Changer (liste officielle Commander)', text: 'GC' }) : null,
    e.qty > 1 ? el('span', { class: 'badge badge-qty', text: `×${e.qty}` }) : null);
  const own = (e.zone === 'main' || e.zone === 'commander') ? curMissing.get(e.oracleId) : null;
  const miss = own && own.status === 'missing' ? own : null;
  const ownCls = own ? ` own-${own.status.toLowerCase()}${miss ? ' missing' : ''}` : '';
  const ownLabel = !own ? null
    : own.status === 'missing' ? { text: own.owned ? `Manque ${own.missing}` : 'Manquante', title: own.owned ? `Tu en possèdes ${own.owned} sur ${own.need}` : 'Absente de ton inventaire' }
    : own.status === 'inOther' ? { text: `Dans « ${own.takeFrom[0].name} »`, title: `Ton exemplaire est rangé dans ${own.takeFrom.map((d) => `« ${d.name} »`).join(', ')} (deck monté)` }
    : null;
  const t = el('div', {
    class: `tile${state.selection === e.oracleId ? ' selected' : ''}${e.zone === 'commander' ? ' is-cmd' : ''}${ownCls}`,
    tabindex: '0', role: 'button', draggable: 'true',
    'aria-label': `${nameOf(card)}${e.qty > 1 ? `, ${e.qty} exemplaires` : ''}${miss ? ', manquante dans ton inventaire' : own && own.status === 'inOther' ? ', rangée dans un autre deck' : own && own.status === 'shared' ? ', partagée avec un autre deck' : ''}`,
    dataset: { id: e.oracleId, zone: e.zone },
    on: {
      click: () => select(e.oracleId),
      keydown: (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(e.oracleId); }
        if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) { ev.preventDefault(); const b = ev.currentTarget.getBoundingClientRect(); cardMenu(b.left + 10, b.top + 10, e.oracleId, e.zone); }
      },
      contextmenu: (ev) => { ev.preventDefault(); select(e.oracleId); cardMenu(ev.clientX, ev.clientY, e.oracleId, e.zone); },
      dragstart: (ev) => { hideHover(); state.dragging = { oracleId: e.oracleId, zone: e.zone }; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', e.oracleId); document.body.classList.add('is-dragging'); },
      dragend: () => { state.dragging = null; document.body.classList.remove('is-dragging'); for (const n of document.querySelectorAll('.drop-on')) n.classList.remove('drop-on'); },
    },
  }, cardImgEl(card, { size: 'normal' }), badges,
  ownLabel ? el('span', { class: `tile-missing${own.status === 'inOther' ? ' inother' : ''}`, title: ownLabel.title }, ownLabel.text) : null,
  own && own.status === 'shared' ? el('span', { class: 'tile-shared', title: `Partagée : en la gardant ici, il en manquera dans ${own.shortIn.map((d) => `« ${d.name} »`).join(', ')}` }) : null);
  attachHover(t, () => card);
  return t;
}

function emptyBoard(deck, addBox) {
  return el('div', { class: 'board-empty' },
    el('h2', { text: `« ${deck.name} » est vide` }),
    el('p', { text: 'Colle ta liste avec Ctrl+V, glisse un fichier .txt ou .csv sur la fenêtre, ouvre l\'import, ou ajoute les cartes une à une.' }),
    el('button', { class: 'btn btn-primary btn-lg', type: 'button', on: { click: () => import('../importer.js').then((m) => m.openImporter()) } }, icon('upload'), 'Importer une liste'),
    el('div', { class: 'empty-add' }, addBox),
    deck.unresolved.length ? el('p', { class: 'muted', text: `${deck.unresolved.length} carte(s) non trouvée(s) lors du dernier import : voir le panneau de droite.` }) : null);
}
