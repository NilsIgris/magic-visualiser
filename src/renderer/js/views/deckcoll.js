// Onglet Collection d'un deck : cartes possédées, partagées, rangées dans un autre deck, manquantes ;
// et cartes de l'inventaire qui conviendraient à ce deck.
import { el, clear, icon, toast } from '../ui.js';
import { state, on, select, openDeck } from '../store.js';
import { analyzedEntries, identityOf, mainType, FUNCTIONS } from '../deckops.js';
import { cardImgEl, nameOf } from '../cardview.js';
import { attachHover, hide as hideHover } from '../hover.js';
import { analyzeDeck } from '../../../shared/analyzer.js';
import { summarizeOwnership, fitsIdentity } from '../../../shared/inventory.js';
import { deckRows, hasCollection, currentUsage, missingText, setDeckBuilt, goInventory, openImport, addCardToDeck, setOwned } from '../collection.js';

const root = () => document.getElementById('view-collection');
const ui = { freeOnly: true, lands: false, role: 'all', sort: 'synergy', limit: 40, showFree: false };
let pending = false;
let syn = { sig: '', running: false, done: 0, total: 0, data: new Map(), roles: {} };
let runToken = 0;
let progEl = null;

export function initDeckCollection() {
  const rr = (p) => { if (p && p.reason === 'graphpos') return; if (state.view === 'collection') schedule(); };
  on('deck', rr); on('view', rr); on('collection', rr); on('usage', rr);
  on('settings', (p) => { if (p && ('nameLang' in p || 'imageLang' in p || 'basicsOwned' in p)) rr(); });
}
function schedule() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; render(); }); }

const STATUS = {
  missing: { title: 'Manquantes', cls: 'st-missing', hint: 'Tu n\'en possèdes pas assez, même en défaisant tes autres decks.' },
  inOther: { title: 'Rangées dans un autre deck', cls: 'st-inother', hint: 'Tu les possèdes, mais tes exemplaires sont dans des decks montés : il faut les y reprendre.' },
  shared: { title: 'Partagées', cls: 'st-shared', hint: 'Tu les as pour ce deck, mais en les y gardant, d\'autres decks en manqueront.' },
  free: { title: 'Possédées et libres', cls: 'st-free', hint: 'Assez d\'exemplaires pour ce deck et tous les autres.' },
};

const quote = (list) => list.map((d) => `« ${d.name} »`).join(', ');

function explain(r) {
  if (r.status === 'missing') {
    const own = r.owned ? `Tu en as ${r.owned}, il en faut ${r.need}.` : 'Tu ne la possèdes pas.';
    return r.takeFrom.length ? `${own} ${r.builtOthers > 1 ? 'Des exemplaires sont' : 'Un exemplaire est'} rangé${r.builtOthers > 1 ? 's' : ''} dans ${quote(r.takeFrom)}.` : own;
  }
  if (r.status === 'inOther') {
    const n = r.shortBy;
    return `${n > 1 ? `${n} exemplaires sont à reprendre` : 'Ton exemplaire est à reprendre'} dans ${quote(r.takeFrom)} (monté${r.takeFrom.length > 1 ? 's' : ''}) : ce deck-là en manquera.`;
  }
  if (r.status === 'shared') {
    const names = quote(r.shortIn);
    return r.shortIn.length > 1 && r.shortBy < r.shortIn.reduce((s, d) => s + d.qty, 0)
      ? `En la gardant ici, il en manquera ${r.shortBy} dans l'un de ces decks : ${names}.`
      : `En la gardant ici, il en manquera ${r.shortBy} dans ${names}.`;
  }
  const others = r.others.length ? ` Aussi dans ${quote(r.others)}.` : '';
  return `${r.owned} possédé${r.owned > 1 ? 's' : ''}.${others}`;
}

function render() {
  const deck = state.deck;
  if (!deck) return;
  const r = root();
  const top = r.scrollTop;
  clear(r);
  hideHover();
  const wrap = el('div', { class: 'dc-wrap' });
  wrap.append(el('div', { class: 'dc-head' },
    el('div', {}, el('h2', { class: 'an-title', text: 'Collection' }),
      el('p', { class: 'muted small', text: 'Compare ce deck à ton inventaire et à tes autres decks : ce qui manque, et ce que tu prendrais à un autre deck en montant celui-ci.' })),
    el('label', { class: 'switch', title: 'Un deck monté a ses cartes physiquement rangées dedans : ses exemplaires lui sont réservés.' },
      el('input', { type: 'checkbox', checked: !!deck.built, on: { change: (e) => setDeckBuilt(deck.id, e.target.checked) } }),
      el('span', { class: 'switch-track', 'aria-hidden': 'true' }),
      el('span', { text: 'Ce deck est monté' })),
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: goInventory } }, 'Ouvrir l\'inventaire')));

  if (!hasCollection()) {
    wrap.append(el('div', { class: 'board-empty' },
      el('h2', { text: 'Ton inventaire est vide' }),
      el('p', { text: 'Importe les cartes que tu possèdes pour voir ce qui manque à ce deck et ce qu\'il partage avec tes autres decks.' }),
      el('button', { class: 'btn btn-primary btn-lg', type: 'button', on: { click: openImport } }, icon('upload'), 'Importer des cartes')));
    r.append(wrap);
    return;
  }

  const rows = deckRows(deck);
  const sum = summarizeOwnership(rows);
  const tiles = el('div', { class: 'dc-tiles' }, ['inOther', 'shared', 'missing', 'free'].map((k) => el('a', { class: `dc-tile ${STATUS[k].cls}`, href: `#dc-${k}`, on: { click: (e) => { e.preventDefault(); const t = r.querySelector(`#dc-${k}`); if (t) { if (t.tagName === 'DETAILS') t.open = true; t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } } },
    el('span', { class: 'dc-n', text: String(sum[k]) }), el('span', { class: 'dc-l', text: STATUS[k].title }))));
  wrap.append(tiles);
  if (state.settings.basicsOwned !== false) wrap.append(el('p', { class: 'muted small', text: 'Les terrains de base ne sont pas comptés (réglage de l\'inventaire).' }));

  // d'abord ce que ce deck prendrait à tes autres decks, puis ce qui manque
  for (const k of ['inOther', 'shared', 'missing', 'free']) {
    const list = rows.filter((x) => x.status === k);
    if (!list.length) continue;
    const items = el('div', { class: 'dc-list' }, list.map((x) => ownRow(x, deck)));
    const head = el('div', { class: 'sec-head' }, el('h3', { class: 'an-sub', text: `${STATUS[k].title} (${list.length})` }),
      k === 'missing' ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: async () => { await navigator.clipboard.writeText(missingText(list)); toast('Liste des cartes manquantes copiée.', { kind: 'ok' }); } } }, icon('copy', 16), 'Copier la liste') : null);
    if (k === 'free') {
      const d = el('details', { class: `dc-sec ${STATUS[k].cls}`, id: `dc-${k}`, open: ui.showFree, on: { toggle: (e) => { ui.showFree = e.target.open; } } },
        el('summary', {}, el('span', { class: 'an-sub-inline', text: `${STATUS[k].title} (${list.length})` })), el('p', { class: 'muted small', text: STATUS[k].hint }), items);
      wrap.append(d);
    } else wrap.append(el('section', { class: `dc-sec ${STATUS[k].cls}`, id: `dc-${k}` }, head, el('p', { class: 'muted small', text: STATUS[k].hint }), items));
  }
  wrap.append(suggestions(deck));
  r.append(wrap);
  r.scrollTop = top;
}

function ownRow(x, deck) {
  const c = deck.cards[x.oracleId];
  const thumb = el('button', { class: 'inv-thumb', type: 'button', title: 'Afficher la carte', on: { click: () => select(x.oracleId) } }, cardImgEl(c, { size: 'artCrop', className: 'thumb-img' }));
  attachHover(thumb, () => c);
  const others = x.status === 'shared' ? x.shortIn : x.status === 'free' ? [] : x.takeFrom;
  return el('div', { class: 'dc-row' },
    thumb,
    el('div', { class: 'dc-main' }, el('strong', { text: nameOf(c) }), el('p', { class: 'dc-why', text: explain(x) })),
    others.length ? el('div', { class: 'inv-decks' }, others.map((d) => el('button', { class: `deck-chip${d.built ? ' built' : ''}`, type: 'button', title: `Ouvrir « ${d.name} »`, on: { click: async () => { await openDeck(d.deckId); select(x.oracleId); } } }, d.built ? icon('check', 12) : null, el('span', { text: d.name })))) : el('span'),
    x.status === 'missing' ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Ajoute les exemplaires manquants à ton inventaire', on: { click: () => { setOwned(x.oracleId, x.owned + x.missing, c); toast(`« ${nameOf(c)} » ajoutée à l'inventaire.`, { kind: 'ok' }); } } }, icon('check', 15), 'Acquise') : el('span'));
}

// ------------------------------------------------------------------ suggestions de l'inventaire
function candidates(deck) {
  const inDeck = new Set(deck.entries.map((e) => e.oracleId));
  const ident = identityOf(deck);
  const byCard = currentUsage().byCard;
  const out = [];
  for (const [id, e] of Object.entries(state.collection.cards)) {
    if (inDeck.has(id) || !e.card || e.card.oracleText === undefined) continue;
    const c = e.card;
    if (!fitsIdentity(c, ident)) continue;
    if (c.legalCommander === 'banned' || c.legalCommander === 'not_legal') continue;
    const used = byCard.get(id) || [];
    const need = used.reduce((s, d) => s + d.qty, 0);
    out.push({ oracleId: id, card: c, owned: e.qty, used, free: Math.max(0, e.qty - need) });
  }
  return { list: out, ident };
}

function signature(deck, cands) {
  return `${deck.id}|${analyzedEntries(deck).map((e) => e.oracleId).sort().join(',')}|${deck.entries.filter((e) => e.zone === 'commander').map((e) => e.oracleId).join(',')}|${cands.map((c) => c.oracleId).sort().join(',')}`;
}

/** Calcule, par paquets, les interactions de chaque candidate avec les cartes du deck. */
function computeSynergy(deck, cands) {
  const sig = signature(deck, cands);
  if (syn.sig === sig) return;
  const token = ++runToken;
  syn = { sig, running: true, done: 0, total: cands.length, data: new Map(), roles: {} };
  const deckIds = [...new Set(analyzedEntries(deck).map((e) => e.oracleId))];
  const deckCards = deckIds.map((id) => deck.cards[id]).filter(Boolean);
  const deckSet = new Set(deckIds);
  const commanderIds = deck.entries.filter((e) => e.zone === 'commander').map((e) => e.oracleId);
  const CHUNK = 30;
  let i = 0;
  const step = () => {
    if (token !== runToken) return;
    const chunk = cands.slice(i, i + CHUNK);
    if (!chunk.length) { syn.running = false; if (state.view === 'collection') schedule(); return; }
    const res = analyzeDeck([...deckCards, ...chunk.map((c) => c.card)], { commanderIds });
    const ids = new Set(chunk.map((c) => c.oracleId));
    for (const c of chunk) {
      syn.data.set(c.oracleId, { links: 0, score: 0, anti: 0, partners: new Map() });
      syn.roles[c.oracleId] = (res.roles[c.oracleId] && res.roles[c.oracleId].functions || []).map((f) => f.key);
    }
    for (const s of res.suggestions) {
      const cand = ids.has(s.from) && deckSet.has(s.to) ? s.from : ids.has(s.to) && deckSet.has(s.from) ? s.to : null;
      if (!cand) continue;
      const d = syn.data.get(cand);
      const other = cand === s.from ? s.to : s.from;
      if (s.kind === 'anti') { d.anti++; continue; }
      if ((s.score ?? 100) < 30) continue;
      d.links++;
      d.score += s.score ?? 50;
      d.partners.set(other, Math.max(d.partners.get(other) || 0, s.score ?? 50));
    }
    i += CHUNK;
    syn.done = Math.min(i, cands.length);
    if (progEl && progEl.isConnected) progEl.textContent = `Analyse des interactions… ${syn.done} / ${syn.total}`;
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

function suggestions(deck) {
  const { list: allCands, ident } = candidates(deck);
  computeSynergy(deck, allCands);
  let list = allCands.filter((c) => (ui.freeOnly ? c.free > 0 : true) && (ui.lands ? true : mainType(c.card) !== 'land'));
  if (ui.role !== 'all') list = list.filter((c) => (syn.roles[c.oracleId] || []).includes(ui.role));
  const score = (c) => (syn.data.get(c.oracleId) || { score: -1 }).score;
  const byName = (a, b) => nameOf(a.card).localeCompare(nameOf(b.card), 'fr');
  if (ui.sort === 'synergy') list.sort((a, b) => score(b) - score(a) || byName(a, b));
  else if (ui.sort === 'cmc') list.sort((a, b) => (a.card.cmc || 0) - (b.card.cmc || 0) || byName(a, b));
  else list.sort(byName);
  const sel = (key, label, opts) => el('label', { class: 'inline-field' }, el('span', { text: label }), el('select', { class: 'select', on: { change: (e) => { ui[key] = e.target.value; ui.limit = 40; render(); } } }, opts.map(([v, l]) => el('option', { value: v, selected: ui[key] === v }, l))));
  const chk = (key, label) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: ui[key], on: { change: (e) => { ui[key] = e.target.checked; ui.limit = 40; render(); } } }), el('span', { text: label }));
  const sec = el('section', { class: 'dc-sec dc-sugg', id: 'dc-sugg' },
    el('h3', { class: 'an-sub', text: 'Dans ton inventaire, pour ce deck' }),
    el('p', { class: 'muted small', text: `Cartes que tu possèdes, absentes du deck${ident ? ', dans l\'identité couleur du commandant' : ' (aucun commandant : identité couleur non filtrée)'} et légales en Commander. Le nombre d'interactions vient de l'analyse automatique (suggestions de pertinence moyenne ou forte).` }),
    el('div', { class: 'inv-bar-row' },
      sel('sort', 'Trier par', [['synergy', 'Interactions avec le deck'], ['name', 'Nom'], ['cmc', 'Coût']]),
      sel('role', 'Rôle', [['all', 'Tous'], ...Object.entries(FUNCTIONS)]),
      chk('freeOnly', 'Seulement les exemplaires libres'),
      chk('lands', 'Inclure les terrains')),
    (progEl = syn.running ? el('p', { class: 'muted small', 'aria-live': 'polite', text: `Analyse des interactions… ${syn.done} / ${syn.total}` }) : null));
  if (!list.length) { sec.append(el('p', { class: 'links-none', text: allCands.length ? 'Aucune carte ne correspond aux filtres.' : 'Aucune carte de ton inventaire ne convient à ce deck (déjà présentes, hors identité couleur, ou importées sans leurs données).' })); return sec; }
  const box = el('div', { class: 'dc-list' });
  for (const c of list.slice(0, ui.limit)) box.append(candRow(c, deck));
  sec.append(box);
  if (list.length > ui.limit) sec.append(el('div', { class: 'inv-more' }, el('button', { class: 'btn btn-ghost', type: 'button', on: { click: () => { ui.limit += 40; render(); } } }, `Afficher ${Math.min(40, list.length - ui.limit)} de plus (${list.length - ui.limit} restantes)`)));
  return sec;
}

function candRow(c, deck) {
  const d = syn.data.get(c.oracleId);
  const roles = syn.roles[c.oracleId] || [];
  const thumb = el('div', { class: 'inv-thumb' }, cardImgEl(c.card, { size: 'artCrop', className: 'thumb-img' }));
  attachHover(thumb, () => c.card);
  const partners = d ? [...d.partners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => nameOf(deck.cards[id])) : [];
  const synTxt = !d ? 'Analyse en attente…' : d.links ? `${d.links} interaction${d.links > 1 ? 's' : ''} avec le deck : ${partners.join(', ')}${d.partners.size > 3 ? '…' : ''}` : 'Aucune interaction détectée avec le deck.';
  const avail = c.free > 0 ? `${c.free} exemplaire${c.free > 1 ? 's' : ''} libre${c.free > 1 ? 's' : ''}` : `Utilisée dans ${quote(c.used)}`;
  return el('div', { class: 'dc-row cand' },
    thumb,
    el('div', { class: 'dc-main' },
      el('strong', { text: nameOf(c.card) }),
      el('p', { class: `dc-why${d && d.links ? '' : ' muted'}`, text: synTxt }),
      el('div', { class: 'role-chips' }, roles.map((k) => el('span', { class: 'role-chip', text: FUNCTIONS[k] })),
        d && d.anti ? el('span', { class: 'tag tag-warn', title: 'Gêne des cartes du deck (anti-synergie)', text: `gêne ${d.anti} carte${d.anti > 1 ? 's' : ''}` }) : null)),
    el('span', { class: `cand-avail${c.free > 0 ? '' : ' warn-txt'}`, text: avail }),
    el('div', { class: 'inv-act' },
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => addCardToDeck(c.oracleId, deck.id, 'main') } }, icon('plus', 15), 'Ajouter'),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Ajouter en « Peut-être »', on: { click: () => addCardToDeck(c.oracleId, deck.id, 'maybe') } }, 'Peut-être')));
}

