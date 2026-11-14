// Liste des interactions : validation des suggestions, liens regroupés, pertinence, boucles, cartes isolées.
import { el, clear, icon } from '../ui.js';
import { state, on, select, setView, setSetting, selectGroup } from '../store.js';
import { LINK_KINDS, loopsOf, mainType, uniqueCardIds } from '../deckops.js';
import { cardImgEl, nameOf } from '../cardview.js';
import { describeReason, describeGroup } from '../reasons.js';
import { setLinkStatus, deleteLink } from '../actions.js';
import { matchesSearch } from './board.js';
import { attachHover } from '../hover.js';
import { groupLinks, groupScore, groupStatus, isWeakPending } from '../../../shared/grouping.js';
import { scoreLevel } from '../../../shared/analyzer.js';

const root = () => document.getElementById('view-links');
const ui = { status: 'pending', kind: 'all', group: 'target', collapsed: new Set(), expanded: new Set() };
let pendingRender = false;

export function initLinks() {
  const rr = () => { if (state.view === 'links') schedule(); };
  on('deck', rr); on('view', rr); on('search', rr);
  on('settings', (p) => { if (p && ('nameLang' in p || 'imageLang' in p || 'groupLinks' in p || 'hideWeak' in p)) rr(); });
}
function schedule() { if (pendingRender) return; pendingRender = true; requestAnimationFrame(() => { pendingRender = false; render(); }); }

export function showLinks(status) { if (status) ui.status = status; setView('links'); }

const LEVEL_LABEL = { strong: 'Pertinence forte', medium: 'Pertinence moyenne', weak: 'Pertinence faible' };
export function meter(score) {
  const lv = scoreLevel(score);
  const n = lv === 'strong' ? 3 : lv === 'medium' ? 2 : 1;
  return el('span', { class: `meter lv-${lv}`, title: `${LEVEL_LABEL[lv]}${typeof score === 'number' ? ` (${score}/100)` : ''}`, 'aria-label': LEVEL_LABEL[lv] },
    [1, 2, 3].map((i) => el('span', { class: i <= n ? 'on' : '' })));
}

function render() {
  const deck = state.deck;
  if (!deck) return;
  const r = root();
  const scrollTop = r.querySelector('.links-scroll') ? r.querySelector('.links-scroll').scrollTop : 0;
  clear(r);
  const lang = state.settings.nameLang;
  const grouped = state.settings.groupLinks !== false;
  const hideWeak = state.settings.hideWeak !== false;
  const counts = { pending: 0, accepted: 0, rejected: 0, all: deck.links.length };
  for (const l of deck.links) counts[l.status] = (counts[l.status] || 0) + 1;
  const q = state.search.trim();
  const filtered = deck.links.filter((l) => {
    if (ui.status !== 'all' && l.status !== ui.status) return false;
    if (ui.kind !== 'all' && l.kind !== ui.kind) return false;
    const a = deck.cards[l.from]; const b = deck.cards[l.to];
    if (!a || !b) return false;
    if (q && !matchesSearch(a, q) && !matchesSearch(b, q)) return false;
    return true;
  });
  const sides = ui.group === 'target' ? ['to'] : ui.group === 'source' ? ['from'] : ['to', 'from'];
  const { groups, singles: allSingles } = grouped ? groupLinks(filtered, { sides }) : { groups: [], singles: filtered };
  const weak = hideWeak ? allSingles.filter(isWeakPending) : [];
  const singles = hideWeak ? allSingles.filter((l) => !isWeakPending(l)) : allSingles;
  const visibleIds = [...groups.flatMap((g) => g.members), ...singles].map((l) => l.id);

  const tabs = [['pending', 'À valider'], ['accepted', 'Validés'], ['rejected', 'Rejetés'], ['all', 'Tous']];
  const head = el('div', { class: 'links-head' },
    el('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => el('button', {
      class: `tab${ui.status === k ? ' on' : ''}`, role: 'tab', type: 'button', 'aria-selected': String(ui.status === k),
      on: { click: () => { ui.status = k; render(); } },
    }, l, el('span', { class: 'tab-n', text: String(counts[k] || 0) })))),
    el('label', { class: 'inline-field' }, el('span', { text: 'Type' }), el('select', { class: 'select', on: { change: (e) => { ui.kind = e.target.value; render(); } } },
      el('option', { value: 'all', selected: ui.kind === 'all' }, 'Tous les types'),
      Object.entries(LINK_KINDS).map(([k, v]) => el('option', { value: k, selected: ui.kind === k }, v.label)))),
    el('label', { class: 'inline-field' }, el('span', { text: 'Classer' }), el('select', { class: 'select', on: { change: (e) => { ui.group = e.target.value; render(); } } },
      [['target', 'par carte qui réagit'], ['source', 'par carte qui agit'], ['none', 'par pertinence']].map(([k, l]) => el('option', { value: k, selected: ui.group === k }, l)))),
    el('button', { class: `chip-toggle${grouped ? ' on' : ''}`, type: 'button', 'aria-pressed': String(grouped), title: 'Réunit en une ligne les liens identiques partagés par au moins 4 cartes', on: { click: () => setSetting({ groupLinks: !grouped }) } }, 'Regrouper les liens répétitifs'),
    el('button', { class: `chip-toggle${hideWeak ? ' on' : ''}`, type: 'button', 'aria-pressed': String(hideWeak), title: 'Masque les suggestions de faible pertinence qui ne font pas partie d\'un groupe', on: { click: () => setSetting({ hideWeak: !hideWeak }) } }, 'Masquer les suggestions faibles'),
    el('span', { class: 'bar-spacer' }),
    visibleIds.length && ui.status !== 'accepted' ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => setLinkStatus(visibleIds, 'accepted') } }, icon('check'), `Valider les ${visibleIds.length} affichés`) : null,
    visibleIds.length && ui.status !== 'rejected' ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => setLinkStatus([...groups.flatMap((g) => g.members), ...singles].filter((l) => l.origin !== 'manual').map((l) => l.id), 'rejected') } }, icon('x'), 'Rejeter les suggestions affichées') : null);

  const scroll = el('div', { class: 'links-scroll' });
  if (!deck.links.length) {
    scroll.append(el('div', { class: 'links-empty' },
      el('h2', { text: 'Aucune interaction pour l\'instant' }),
      el('p', { text: 'Importe des cartes : les liens possibles sont proposés automatiquement. Tu peux aussi créer un lien depuis le graphe ou le panneau d\'une carte.' })));
  } else if (!groups.length && !singles.length) {
    scroll.append(el('p', { class: 'links-none', text: weak.length ? 'Il ne reste que des suggestions faibles, masquées.' : ui.status === 'pending' ? 'Toutes les suggestions ont été traitées.' : 'Aucun lien ne correspond aux filtres.' }));
  } else if (ui.group === 'none') {
    const items = [...groups.map((g) => ({ g, s: groupScore(g) })), ...singles.map((l) => ({ l, s: l.score ?? 100 }))].sort((a, b) => b.s - a.s);
    const box = el('div', { class: 'link-rows flat' });
    for (const it of items) box.append(it.g ? groupRow(it.g, deck, lang, true) : row(it.l, deck, lang, 'both'));
    scroll.append(box);
  } else {
    const key = ui.group === 'target' ? 'to' : 'from';
    const sections = new Map();
    const sec = (id) => { if (!sections.has(id)) sections.set(id, { groups: [], links: [] }); return sections.get(id); };
    for (const g of groups) sec(g.anchor).groups.push(g);
    for (const l of singles) sec(l[key]).links.push(l);
    const weight = (s) => s.groups.reduce((a, g) => a + g.members.length, 0) + s.links.length;
    const sorted = [...sections.entries()].sort((a, b) => weight(b[1]) - weight(a[1]) || nameOf(deck.cards[a[0]]).localeCompare(nameOf(deck.cards[b[0]]), 'fr'));
    for (const [cid, s] of sorted) scroll.append(section(cid, s, deck, lang, key));
  }
  if (weak.length) {
    scroll.append(el('p', { class: 'weak-note' }, `${weak.length} suggestion${weak.length > 1 ? 's' : ''} de faible pertinence masquée${weak.length > 1 ? 's' : ''}. `,
      el('button', { class: 'link-btn', type: 'button', on: { click: () => setSetting({ hideWeak: false }) } }, 'Les afficher')));
  }
  scroll.append(extras(deck));
  r.append(head, scroll);
  scroll.scrollTop = scrollTop;
}

function section(cid, s, deck, lang, key) {
  const card = deck.cards[cid];
  const gk = `${key}:${cid}`;
  const collapsed = ui.collapsed.has(gk);
  const all = [...s.groups.flatMap((g) => g.members), ...s.links];
  const pend = all.filter((l) => l.status === 'pending');
  const n = s.groups.reduce((a, g) => a + g.members.length, 0) + s.links.length;
  const thumb = el('button', { class: 'group-thumb', type: 'button', title: 'Afficher la carte', on: { click: () => select(cid) } }, cardImgEl(card, { size: 'artCrop', className: 'thumb-img' }));
  attachHover(thumb, () => card);
  const head = el('div', { class: 'group-head' },
    el('button', { class: `icon-btn icon-sm caret${collapsed ? ' closed' : ''}`, type: 'button', 'aria-expanded': String(!collapsed), 'aria-label': collapsed ? 'Déplier' : 'Replier', on: { click: () => { if (collapsed) ui.collapsed.delete(gk); else ui.collapsed.add(gk); render(); } } }, icon('back', 16)),
    thumb,
    el('div', { class: 'group-title' },
      el('h3', { text: nameOf(card) }),
      el('p', { class: 'muted', text: key === 'to' ? `réagit à ${n} carte${n > 1 ? 's' : ''}` : `agit sur ${n} carte${n > 1 ? 's' : ''}` })),
    el('span', { class: 'bar-spacer' }),
    pend.length ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => setLinkStatus(pend.map((l) => l.id), 'accepted') } }, icon('check'), `Tout valider (${pend.length})`) : null,
    pend.length ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => setLinkStatus(pend.filter((l) => l.origin !== 'manual').map((l) => l.id), 'rejected') } }, 'Tout rejeter') : null);
  const body = el('div', { class: 'link-rows' });
  if (!collapsed) {
    for (const g of s.groups) body.append(groupRow(g, deck, lang, false));
    for (const l of [...s.links].sort((a, b) => (b.score ?? 100) - (a.score ?? 100))) body.append(row(l, deck, lang, key === 'to' ? 'from' : 'to'));
  }
  return el('section', { class: 'link-group' }, head, collapsed ? null : body);
}

function cardChip(id, deck) {
  const c = deck.cards[id];
  const b = el('button', { class: 'card-chip', type: 'button', on: { click: () => select(id) } }, cardImgEl(c, { size: 'artCrop', className: 'chip-img' }), el('span', { text: nameOf(c) }));
  attachHover(b, () => c);
  return b;
}

function groupRow(g, deck, lang, showAnchor) {
  const kind = LINK_KINDS[g.kind] || LINK_KINDS.synergy;
  const st = groupStatus(g);
  const open = ui.expanded.has(g.id);
  const pend = g.members.filter((l) => l.status === 'pending');
  const first = g.members[0];
  const snip = (first.reasons || []).map((r) => r.snippet).filter(Boolean)[0];
  const stTxt = [st.accepted ? `${st.accepted} validé${st.accepted > 1 ? 's' : ''}` : null, st.pending ? `${st.pending} à valider` : null, st.rejected ? `${st.rejected} rejeté${st.rejected > 1 ? 's' : ''}` : null].filter(Boolean).join(', ');
  const label = el('button', { class: 'group-chip', type: 'button', 'aria-expanded': String(open), title: open ? 'Replier la liste' : 'Voir chaque carte',
    on: { click: () => { if (open) ui.expanded.delete(g.id); else ui.expanded.add(g.id); render(); } } },
  el('span', { class: 'stack-ico', 'aria-hidden': 'true' }, el('span'), el('span'), el('span')), el('span', { text: describeGroup(g) }));
  const kindChip = el('span', { class: 'kind-chip', style: { '--k': kind.color } }, kind.label);
  // side 'to' : les membres agissent sur l'ancre ; side 'from' : l'ancre agit sur les membres
  const line = g.side === 'to'
    ? el('div', { class: 'link-line' }, label, kindChip, showAnchor ? cardChip(g.anchor, deck) : null, meter(groupScore(g)))
    : el('div', { class: 'link-line' }, showAnchor ? cardChip(g.anchor, deck) : null, kindChip, label, meter(groupScore(g)));
  const node = el('div', { class: `link-row group-row${open ? ' open' : ''}`, dataset: { group: g.id } },
    el('span', { class: 'kind-bar', style: { background: kind.color }, 'aria-hidden': 'true' }),
    el('div', { class: 'link-main' }, line,
      el('p', { class: 'link-why', text: stTxt }),
      snip ? el('p', { class: 'link-snip', lang: 'en', text: snip }) : null),
    el('div', { class: 'link-actions' },
      pend.length ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => setLinkStatus(pend.map((l) => l.id), 'accepted') } }, icon('check', 16), `Valider (${pend.length})`) : el('span', { class: 'status-done', text: st.rejected === g.members.length ? 'Rejeté' : 'Traité' }),
      pend.length ? el('button', { class: 'icon-btn danger', type: 'button', title: 'Rejeter tout le groupe', 'aria-label': 'Rejeter tout le groupe', on: { click: () => setLinkStatus(pend.map((l) => l.id), 'rejected') } }, icon('x')) : null,
      el('button', { class: 'icon-btn', type: 'button', title: 'Voir dans le graphe', 'aria-label': 'Voir dans le graphe', on: { click: () => { selectGroup(g.id); setView('graph'); } } }, icon('link'))));
  if (!open) return node;
  const members = el('div', { class: 'group-members' });
  for (const l of [...g.members].sort((a, b) => nameOf(deck.cards[g.side === 'to' ? a.from : a.to]).localeCompare(nameOf(deck.cards[g.side === 'to' ? b.from : b.to]), 'fr'))) {
    members.append(row(l, deck, lang, g.side === 'to' ? 'from' : 'to', true));
  }
  return el('div', { class: 'group-wrap' }, node, members);
}

function row(l, deck, lang, show, compact = false) {
  const a = deck.cards[l.from]; const b = deck.cards[l.to];
  const kind = LINK_KINDS[l.kind] || LINK_KINDS.synergy;
  const text = l.origin === 'manual' ? (l.note || 'Lien ajouté manuellement.') : (l.reasons || []).map((r) => describeReason(r, a, b, lang)).join(' ');
  const snip = l.origin === 'manual' || compact ? null : (l.reasons || []).map((r) => r.snippet).filter(Boolean)[0];
  const status = l.status;
  return el('div', { class: `link-row st-${status}${compact ? ' compact' : ''}`, dataset: { id: l.id } },
    el('span', { class: 'kind-bar', style: { background: kind.color }, 'aria-hidden': 'true' }),
    el('div', { class: 'link-main' },
      el('div', { class: 'link-line' },
        show === 'both' || show === 'from' ? cardChip(l.from, deck) : null,
        compact ? null : el('span', { class: 'kind-chip', style: { '--k': kind.color } }, kind.label),
        show === 'both' || show === 'to' ? cardChip(l.to, deck) : null,
        l.origin === 'manual' ? el('span', { class: 'tag', text: l.kind === 'combo' && l.source === 'spellbook' ? 'Commander Spellbook' : 'manuel' }) : meter(l.score),
        l.stale ? el('span', { class: 'tag tag-warn', title: 'L\'analyse actuelle ne propose plus ce lien ; il est conservé car tu l\'avais traité.', text: 'plus suggéré' }) : null),
      compact ? null : el('p', { class: 'link-why', text }),
      snip ? el('p', { class: 'link-snip', lang: 'en', text: snip }) : null,
      l.origin !== 'manual' && l.note ? el('p', { class: 'link-note', text: l.note }) : null),
    el('div', { class: 'link-actions' },
      status !== 'accepted' ? el('button', { class: 'icon-btn ok', type: 'button', title: 'Valider', 'aria-label': 'Valider', on: { click: () => setLinkStatus(l.id, 'accepted') } }, icon('check')) : el('span', { class: 'status-done', text: 'Validé' }),
      l.origin === 'manual'
        ? el('button', { class: 'icon-btn danger', type: 'button', title: 'Supprimer ce lien', 'aria-label': 'Supprimer', on: { click: () => deleteLink(l.id) } }, icon('trash'))
        : status !== 'rejected' ? el('button', { class: 'icon-btn danger', type: 'button', title: 'Rejeter', 'aria-label': 'Rejeter', on: { click: () => setLinkStatus(l.id, 'rejected') } }, icon('x')) : el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => setLinkStatus(l.id, 'pending') } }, 'Rétablir'),
      el('button', { class: 'icon-btn', type: 'button', title: 'Modifier', 'aria-label': 'Modifier', on: { click: () => import('../linkdialog.js').then((m) => m.openLinkDialog({ edit: l.id })) } }, icon('more'))));
}

function extras(deck) {
  const box = el('div', { class: 'links-extras' });
  const loops = loopsOf(deck);
  const ids = uniqueCardIds(deck, ['commander', 'main']);
  const linked = new Set(deck.links.filter((l) => l.status === 'accepted').flatMap((l) => [l.from, l.to]));
  const isolated = ids.filter((id) => !linked.has(id) && deck.cards[id] && mainType(deck.cards[id]) !== 'land');
  box.append(el('section', { class: 'extra' },
    el('h3', { text: 'Boucles possibles' }),
    el('p', { class: 'muted', text: 'Groupes de cartes qui se déclenchent mutuellement d\'après tes liens validés. Ce n\'est pas forcément une combo infinie : pour les combos connues, utilise l\'onglet Analyse (Commander Spellbook).' }),
    loops.length ? el('ul', { class: 'loop-list' }, loops.map((g) => el('li', {}, g.map((id, i) => [i ? el('span', { class: 'loop-arrow', text: '⇄' }) : null, cardChip(id, deck)])))) : el('p', { class: 'muted', text: 'Aucune boucle parmi les liens validés.' })));
  box.append(el('section', { class: 'extra' },
    el('h3', { text: `Cartes sans lien validé (${isolated.length})` }),
    el('p', { class: 'muted', text: 'Hors terrains. Ce sont souvent des cartes « autonomes » (retraits, rampe) ou des cartes à relier à la main.' }),
    isolated.length ? el('div', { class: 'chip-wrap' }, isolated.map((id) => cardChip(id, deck))) : el('p', { class: 'muted', text: 'Toutes les cartes non-terrain ont au moins un lien validé.' })));
  return box;
}
