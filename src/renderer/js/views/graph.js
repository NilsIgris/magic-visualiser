// Graphe des interactions (Cytoscape + mise en page fCoSE).
import { el, clear, icon, toast, menuFromButton } from '../ui.js';
import { state, on, select, setSetting, mutate, selectGroup } from '../store.js';
import { groupLinks, isWeakPending } from '../../../shared/grouping.js';
import { describeGroup } from '../reasons.js';
import { LINK_KINDS, mainType } from '../deckops.js';
import { cardImage, nameOf } from '../cardview.js';
import { cardMenu } from '../actions.js';
import { matchesSearch } from './board.js';

const root = () => document.getElementById('view-graph');
let cy = null;
let container = null;
let toolbar = null;
let legend = null;
let countEl = null;
let linkMode = null; // null | { from?: oracleId }
let isolate = false;
let dirty = true;
let registered = false;

const LAYOUTS = [
  ['fcose', 'Forces'],
  ['flow', 'Flux (sources → effets)'],
  ['concentric', 'Importance'],
  ['type', 'Par type'],
];

export function initGraph() {
  on('deck', (p) => {
    if (p && p.reason === 'graphpos') return;
    dirty = true;
    if (state.view === 'graph') refresh();
  });
  on('view', (v) => {
    if (v !== 'graph') { cancelLinkMode(); return; }
    requestAnimationFrame(() => { if (state.view !== 'graph') return; ensure(); cy.resize(); refresh(); });
  });
  on('selection', () => { if (state.view === 'graph') applyFocus(); });
  on('search', () => { if (state.view === 'graph') applySearch(); });
  on('settings', (p) => { if (p && (p.graph || 'imageLang' in p || 'nameLang' in p || 'groupLinks' in p || 'hideWeak' in p)) { dirty = true; if (state.view === 'graph') refresh(); } });
  window.addEventListener('resize', () => cy && state.view === 'graph' && cy.resize());
}

function ensure() {
  if (cy) return;
  if (!registered && window.cytoscapeFcose) { window.cytoscape.use(window.cytoscapeFcose); registered = true; }
  const r = clear(root());
  toolbar = el('div', { class: 'graph-bar' });
  legend = el('div', { class: 'graph-legend', role: 'group', 'aria-label': 'Types de liens affichés' });
  container = el('div', { class: 'graph-canvas', tabindex: '0', 'aria-label': 'Graphe des interactions' });
  const hint = el('div', { class: 'graph-hint', id: 'graph-hint', hidden: true });
  r.append(toolbar, legend, el('div', { class: 'graph-wrap' }, container, hint));
  cy = window.cytoscape({
    container,
    elements: [],
    minZoom: 0.12, maxZoom: 3,
    wheelSensitivity: 0.25,
    boxSelectionEnabled: false,
    selectionType: 'single',
    style: graphStyle(),
  });
  cy.on('tap', 'node', (e) => {
    const id = e.target.id();
    if (e.target.data('group')) { if (!linkMode) selectGroup(id); return; }
    if (linkMode) { handleLinkTap(id); return; }
    if (e.originalEvent && e.originalEvent.shiftKey && state.selection && state.selection !== id) {
      import('../linkdialog.js').then((m) => m.openLinkDialog({ from: state.selection, to: id }));
      return;
    }
    select(id);
  });
  cy.on('tap', 'edge', (e) => {
    if (e.target.data('groupId')) { selectGroup(e.target.data('groupId')); return; }
    const l = e.target.data('link'); select(l.from, { linkId: l.id });
  });
  cy.on('tap', (e) => { if (e.target === cy) { if (linkMode) cancelLinkMode(); else select(null); } });
  cy.on('cxttap', 'node', (e) => {
    const id = e.target.id();
    if (e.target.data('group')) return;
    const z = ['commander', 'main', 'maybe'].find((zz) => state.deck.entries.some((x) => x.oracleId === id && x.zone === zz));
    const p = e.renderedPosition; const b = container.getBoundingClientRect();
    select(id);
    cardMenu(b.left + p.x, b.top + p.y, id, z);
  });
  cy.on('dragfree', 'node', () => savePositions());
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && linkMode) cancelLinkMode();
  });
}

function graphStyle() {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  return [
    { selector: 'node', style: {
      shape: 'round-rectangle', width: 'data(size)', height: 'data(h)',
      'background-color': v('--raised'), 'background-image': 'data(img)', 'background-fit': 'cover', 'background-clip': 'node',
      'background-image-crossorigin': 'anonymous',
      'border-width': 2, 'border-color': v('--line-strong'),
      label: 'data(label)', color: v('--text'), 'font-family': 'Alegreya Sans, sans-serif', 'font-size': 12, 'font-weight': 500,
      'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 5, 'text-wrap': 'ellipsis', 'text-max-width': 130,
      'text-background-color': v('--bg'), 'text-background-opacity': 0.82, 'text-background-padding': 3, 'text-background-shape': 'round-rectangle',
      'min-zoomed-font-size': 7, 'transition-property': 'opacity', 'transition-duration': 150,
    } },
    { selector: 'node[?cmd]', style: { 'border-color': v('--brass'), 'border-width': 4 } },
    { selector: 'node[?maybe]', style: { 'border-style': 'dashed' } },
    { selector: 'node:selected', style: { 'border-color': v('--text'), 'border-width': 4, 'overlay-opacity': 0 } },
    { selector: 'node.link-source', style: { 'border-color': v('--brass'), 'border-width': 5, 'border-style': 'double' } },
    { selector: 'node.match', style: { 'border-color': v('--brass'), 'border-width': 4 } },
    { selector: 'edge', style: {
      width: 2.2, 'curve-style': 'bezier', 'control-point-step-size': 28,
      'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle', 'arrow-scale': 1,
      opacity: 0.9, 'transition-property': 'opacity', 'transition-duration': 150,
    } },
    { selector: 'edge[status = "pending"]', style: { 'line-style': 'dashed', 'line-dash-pattern': [6, 5], opacity: 0.6 } },
    { selector: 'edge[status = "rejected"]', style: { 'line-style': 'dotted', opacity: 0.35, width: 1.4 } },
    { selector: 'edge[?manual]', style: { width: 3 } },
    { selector: 'edge:selected', style: { width: 5, opacity: 1, 'overlay-opacity': 0 } },
    { selector: 'node[?group]', style: {
      shape: 'round-rectangle', 'background-color': 'data(color)', 'background-opacity': 0.2, 'background-image': 'none',
      'border-color': 'data(color)', 'border-width': 2, 'border-style': 'solid',
      label: 'data(label)', 'text-valign': 'center', 'text-halign': 'center', 'text-margin-y': 0, 'text-wrap': 'wrap', 'text-max-width': 120,
      'font-size': 13, 'font-weight': 700, 'text-background-opacity': 0, 'min-zoomed-font-size': 3,
    } },
    { selector: 'node[?group]:selected', style: { 'border-width': 4, 'background-opacity': 0.35 } },
    { selector: 'node.member', style: { 'border-color': v('--brass'), 'border-width': 3 } },
    { selector: 'edge[?groupEdge]', style: { width: 'data(w)' } },
    { selector: '.faded', style: { opacity: 0.1, 'text-opacity': 0.25 } },
    { selector: 'edge.hl', style: { opacity: 1, width: 3.2 } },
  ];
}

function visibleLinks(deck, gs) {
  return deck.links.filter((l) => {
    if (l.status === 'pending' && !gs.showPending) return false;
    if (l.status === 'rejected' && !gs.showRejected) return false;
    if (gs.kinds && !gs.kinds.includes(l.kind)) return false;
    return true;
  });
}

function refresh() {
  ensure();
  renderToolbar();
  if (!dirty) { applyFocus(); return; }
  dirty = false;
  const deck = state.deck;
  if (!deck) return;
  const gs = state.settings.graph;
  const zoneOf = new Map();
  for (const e of deck.entries) {
    if (e.zone === 'side') continue;
    if (!zoneOf.has(e.oracleId) || e.zone === 'commander') zoneOf.set(e.oracleId, e.zone);
  }
  let ids = [...zoneOf.keys()].filter((id) => deck.cards[id]);
  if (gs.hideLands) ids = ids.filter((id) => mainType(deck.cards[id]) !== 'land' || zoneOf.get(id) === 'commander');
  const idSet = new Set(ids);
  const visible = visibleLinks(deck, gs).filter((l) => idSet.has(l.from) && idSet.has(l.to));
  const grouped = state.settings.groupLinks !== false;
  const { groups, singles } = grouped ? groupLinks(visible) : { groups: [], singles: visible };
  const links = state.settings.hideWeak !== false ? singles.filter((l) => !isWeakPending(l)) : singles;
  const degree = new Map();
  for (const l of links) for (const id of [l.from, l.to]) degree.set(id, (degree.get(id) || 0) + 1);
  for (const g of groups) degree.set(g.anchor, (degree.get(g.anchor) || 0) + 1);
  if (gs.hideIsolated) ids = ids.filter((id) => degree.get(id) || zoneOf.get(id) === 'commander');

  const pos = deck.graphPositions || {};
  const nodes = ids.map((id) => {
    const c = deck.cards[id];
    const d = degree.get(id) || 0;
    const w = Math.round(Math.min(118, 58 + Math.sqrt(d) * 11) * (zoneOf.get(id) === 'commander' ? 1.25 : 1));
    return {
      group: 'nodes',
      data: { id, label: nameOf(c), img: cardImage(c, { size: 'artCrop' }) || cardImage(c, { size: 'small' }) || 'none', size: w, h: Math.round(w * 0.73), cmd: zoneOf.get(id) === 'commander', maybe: zoneOf.get(id) === 'maybe', deg: d, type: mainType(c) },
      position: pos[id] ? { ...pos[id] } : undefined,
    };
  });
  const edges = links.map((l) => ({
    group: 'edges',
    data: { id: `e:${l.id}`, source: l.from, target: l.to, color: (LINK_KINDS[l.kind] || LINK_KINDS.synergy).color, status: l.status, manual: l.origin === 'manual', link: l },
  }));
  const shown = new Set(ids);
  for (const g of groups) {
    if (!shown.has(g.anchor)) continue;
    const color = (LINK_KINDS[g.kind] || LINK_KINDS.synergy).color;
    const n = g.members.length;
    const status = g.members.some((l) => l.status === 'pending') ? 'pending' : g.members.every((l) => l.status === 'rejected') ? 'rejected' : 'accepted';
    const members = g.members.map((l) => (g.side === 'to' ? l.from : l.to));
    nodes.push({ group: 'nodes', data: { id: g.id, group: true, label: describeGroup(g), color, size: 130, h: 46, deg: n, type: 'group', img: 'none', members }, position: pos[g.id] ? { ...pos[g.id] } : undefined });
    const w = Math.min(7, 2.2 + Math.log2(n));
    edges.push({ group: 'edges', data: { id: `ge:${g.id}`, source: g.side === 'to' ? g.id : g.anchor, target: g.side === 'to' ? g.anchor : g.id, color, status, groupEdge: true, groupId: g.id, w } });
  }
  cy.startBatch();
  cy.elements().remove();
  cy.add(nodes);
  cy.add(edges);
  cy.endBatch();
  countEl.textContent = graphCountText(nodes.length - groups.length, groups.length, edges.length);
  const missing = nodes.filter((n) => !n.position);
  // beaucoup de nouveaux nœuds (premier affichage, groupes activés) : disposition complète
  if (missing.length === nodes.length || missing.length > nodes.length * 0.25) runLayout(gs.layout || 'fcose', false);
  else if (missing.length) {
    for (const n of missing) {
      const ne = cy.getElementById(n.data.id).neighborhood('node').filter((x) => !missing.some((m) => m.data.id === x.id()));
      const bb = cy.nodes().boundingBox();
      const p = ne.length ? { x: ne.reduce((s, x) => s + x.position('x'), 0) / ne.length + (Math.random() - 0.5) * 120, y: ne.reduce((s, x) => s + x.position('y'), 0) / ne.length + (Math.random() - 0.5) * 120 } : { x: bb.x2 + 80, y: bb.y1 + Math.random() * (bb.h || 200) };
      cy.getElementById(n.data.id).position(p);
    }
    savePositions();
  }
  applySearch();
  applyFocus();
  if (!state.selection) cy.fit(undefined, 40);
}

function renderToolbar() {
  const gs = state.settings.graph;
  clear(toolbar);
  const layoutSel = el('select', { class: 'select', 'aria-label': 'Disposition', on: { change: (e) => { setSetting({ graph: { layout: e.target.value } }); runLayout(e.target.value, true); } } },
    LAYOUTS.map(([k, l]) => el('option', { value: k, selected: (gs.layout || 'fcose') === k }, l)));
  const toggle = (key, label, title) => el('button', {
    class: `chip-toggle${gs[key] ? ' on' : ''}`, type: 'button', 'aria-pressed': String(!!gs[key]), title,
    on: { click: () => setSetting({ graph: { [key]: !gs[key] } }) },
  }, label);
  countEl = el('span', { class: 'graph-count' });
  toolbar.append(
    el('label', { class: 'inline-field' }, el('span', { text: 'Disposition' }), layoutSel),
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Recalculer la disposition', on: { click: () => runLayout(gs.layout || 'fcose', true) } }, 'Réorganiser'),
    el('button', { class: 'icon-btn', type: 'button', title: 'Tout afficher', 'aria-label': 'Tout afficher', on: { click: () => cy.animate({ fit: { padding: 40 } }, { duration: 300 }) } }, icon('fit')),
    el('span', { class: 'bar-sep' }),
    toggle('showPending', 'Suggestions', 'Afficher les suggestions non validées (pointillés)'),
    toggle('showRejected', 'Rejetés', 'Afficher les liens rejetés'),
    toggle('hideLands', 'Masquer les terrains', 'Les terrains créent beaucoup de liens (Landfall)'),
    toggle('hideIsolated', 'Masquer les cartes sans lien', ''),
    el('button', { class: `chip-toggle${state.settings.groupLinks !== false ? ' on' : ''}`, type: 'button', 'aria-pressed': String(state.settings.groupLinks !== false), title: 'Un seul nœud pour les liens identiques partagés par au moins 4 cartes', on: { click: () => setSetting({ groupLinks: state.settings.groupLinks === false }) } }, 'Regrouper'),
    el('button', { class: `chip-toggle${state.settings.hideWeak !== false ? ' on' : ''}`, type: 'button', 'aria-pressed': String(state.settings.hideWeak !== false), title: 'Masque les suggestions de faible pertinence hors groupe', on: { click: () => setSetting({ hideWeak: state.settings.hideWeak === false }) } }, 'Masquer les faibles'),
    el('button', { class: `chip-toggle${isolate ? ' on' : ''}`, type: 'button', 'aria-pressed': String(isolate), title: 'N\'afficher que la carte sélectionnée et ses voisines', on: { click: () => { isolate = !isolate; renderToolbar(); applyFocus(); } } }, 'Isoler la sélection'),
    el('span', { class: 'bar-spacer' }),
    countEl,
    el('button', { class: `btn btn-sm ${linkMode ? 'btn-primary' : 'btn-ghost'}`, type: 'button', title: 'Clique la carte source puis la carte cible (ou Maj+clic depuis la carte sélectionnée)', on: { click: () => (linkMode ? cancelLinkMode() : startLinkMode()) } }, icon('link'), linkMode ? 'Annuler la liaison' : 'Relier deux cartes'),
    el('button', { class: 'icon-btn', type: 'button', title: 'Exporter', 'aria-label': 'Exporter le graphe', on: { click: (e) => menuFromButton(e.currentTarget, [{ label: 'Exporter en image PNG…', onClick: exportPng }]) } }, icon('download')),
  );
  if (cy) { const g = cy.nodes('[?group]').length; countEl.textContent = graphCountText(cy.nodes().length - g, g, cy.edges().length); }
  renderLegend();
}

function renderLegend() {
  const gs = state.settings.graph;
  clear(legend);
  const counts = {};
  for (const l of state.deck ? state.deck.links : []) {
    if (l.status === 'rejected' && !gs.showRejected) continue;
    if (l.status === 'pending' && !gs.showPending) continue;
    counts[l.kind] = (counts[l.kind] || 0) + 1;
  }
  const active = gs.kinds || Object.keys(LINK_KINDS);
  for (const [k, v] of Object.entries(LINK_KINDS)) {
    if (!counts[k] && !(gs.kinds && gs.kinds.includes(k))) continue;
    const on = active.includes(k);
    legend.append(el('button', {
      class: `legend-item${on ? '' : ' off'}`, type: 'button', 'aria-pressed': String(on),
      title: on ? `Masquer « ${v.label} »` : `Afficher « ${v.label} »`,
      on: { click: () => {
        let next = on ? active.filter((x) => x !== k) : [...active, k];
        if (next.length === Object.keys(LINK_KINDS).length) next = null;
        setSetting({ graph: { kinds: next } });
      } },
    }, el('span', { class: 'legend-swatch', style: { background: v.color } }), el('span', { text: v.label }), el('span', { class: 'legend-n', text: String(counts[k] || 0) })));
  }
  legend.append(el('span', { class: 'legend-note' },
    el('span', { class: 'legend-line solid' }), 'validé',
    el('span', { class: 'legend-line dashed' }), 'suggestion',
    el('span', { class: 'legend-arrow', text: 'A → B' }), 'A agit sur B'));
}

function graphCountText(cards, groups, edges) {
  return `${cards} cartes, ${groups ? `${groups} groupe${groups > 1 ? 's' : ''}, ` : ''}${edges} liens`;
}

function runLayout(name, animate) {
  if (!cy || !cy.nodes().length) return;
  let opts;
  if (name === 'flow') opts = { name: 'breadthfirst', directed: true, spacingFactor: 1.15, avoidOverlap: true, padding: 40, roots: cy.nodes().filter((n) => n.indegree(false) === 0 && n.outdegree(false) > 0) };
  else if (name === 'concentric') opts = { name: 'concentric', concentric: (n) => n.degree(false) + (n.data('cmd') ? 1000 : 0), levelWidth: () => 3, minNodeSpacing: 22, padding: 40, avoidOverlap: true };
  else if (name === 'type') {
    const order = ['creature', 'planeswalker', 'battle', 'artifact', 'enchantment', 'instant', 'sorcery', 'land', 'other'];
    opts = { name: 'grid', avoidOverlap: true, padding: 40, condense: false, sort: (a, b) => (b.data('cmd') - a.data('cmd')) || order.indexOf(a.data('type')) - order.indexOf(b.data('type')) || a.data('label').localeCompare(b.data('label'), 'fr') };
  } else opts = { name: window.cytoscapeFcose ? 'fcose' : 'cose', quality: 'proof', randomize: true, nodeDimensionsIncludeLabels: true, uniformNodeDimensions: false, nodeRepulsion: () => 60000, idealEdgeLength: () => 190, edgeElasticity: () => 0.2, nestingFactor: 0.1, gravity: 0.12, gravityRange: 4, nodeSeparation: 160, packComponents: true, tile: true, padding: 40, numIter: 4000 };
  const isForce = opts.name === 'fcose' || opts.name === 'cose';
  const l = cy.layout({ ...opts, animate: isForce ? false : !!animate, animationDuration: 450, fit: !isForce });
  l.one('layoutstop', () => {
    if (isForce) {
      const target = removeOverlaps();
      if (animate) {
        const ani = cy.nodes().map((n) => n.animation({ position: target.get(n.id()), duration: 350, easing: 'ease-out-cubic' }));
        ani.forEach((a) => a.play());
        Promise.all(ani.map((a) => a.promise())).then(() => { cy.animate({ fit: { padding: 40 } }, { duration: 250 }); savePositions(); });
        return;
      }
      for (const [id, p] of target) cy.getElementById(id).position(p);
      cy.fit(undefined, 40);
    }
    savePositions();
  });
  l.run();
}

/** Écarte les cartes qui se chevauchent (étiquette comprise). Renvoie les positions finales. */
function removeOverlaps(pad = 16) {
  const nodes = cy.nodes().map((n) => {
    const p = n.position();
    const w = n.width(); const h = n.height() + 24; // étiquette sous la carte
    return { id: n.id(), x: p.x, y: p.y + 10, w: Math.max(w, 120), h };
  });
  for (let it = 0; it < 80; it++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]; const b = nodes[j];
        const dx = b.x - a.x; const dy = b.y - a.y;
        const ox = (a.w + b.w) / 2 + pad - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + pad - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          moved = true;
          if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * ox / 2; a.x -= s; b.x += s; } else { const s = (dy >= 0 ? 1 : -1) * oy / 2; a.y -= s; b.y += s; }
        }
      }
    }
    if (!moved) break;
  }
  return new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y - 10 }]));
}

function savePositions() {
  if (!cy || !state.deck) return;
  const p = {};
  cy.nodes().forEach((n) => { const q = n.position(); p[n.id()] = { x: Math.round(q.x), y: Math.round(q.y) }; });
  mutate((d) => { d.graphPositions = { ...(d.graphPositions || {}), ...p }; }, { undoable: false, reason: 'graphpos' });
}

function applyFocus() {
  if (!cy) return;
  const memberNodes = (g) => cy.nodes().filter((n) => (g.data('members') || []).includes(n.id()));
  cy.batch(() => {
    cy.elements().removeClass('faded hl member').style('display', 'element');
    cy.$(':selected').unselect();
    const sel = state.selection ? cy.getElementById(state.selection) : null;
    if (state.selectedLink) { const e = cy.getElementById(`e:${state.selectedLink}`); if (e.length) e.select(); }
    if (sel && sel.length) {
      sel.select();
      let hood = sel.closedNeighborhood();
      // groupes dont la carte fait partie : le groupe et sa carte d'ancrage restent visibles
      const inGroups = cy.nodes('[?group]').filter((g) => (g.data('members') || []).includes(sel.id()));
      hood = hood.union(inGroups).union(inGroups.closedNeighborhood());
      if (isolate) cy.elements().difference(hood).style('display', 'none');
      else { cy.elements().difference(hood).addClass('faded'); sel.connectedEdges().addClass('hl'); inGroups.connectedEdges().addClass('hl'); }
    }
    const gsel = state.selectedGroup ? cy.getElementById(state.selectedGroup) : null;
    if (gsel && gsel.length) {
      gsel.select();
      const members = memberNodes(gsel);
      members.addClass('member');
      const hood = gsel.closedNeighborhood().union(members);
      if (isolate) cy.elements().difference(hood).style('display', 'none');
      else { cy.elements().difference(hood).addClass('faded'); gsel.connectedEdges().addClass('hl'); }
    }
  });
  if (state.selectedGroup) {
    const g = cy.getElementById(state.selectedGroup);
    if (g.length) cy.animate({ fit: { eles: g.closedNeighborhood().union(memberNodes(g)), padding: 60 } }, { duration: 250 });
    return;
  }
  const sel = state.selection ? cy.getElementById(state.selection) : null;
  if (sel && sel.length) {
    const ext = cy.extent(); const p = sel.position();
    if (isolate) cy.animate({ fit: { eles: sel.closedNeighborhood(), padding: 60 } }, { duration: 250 });
    else if (p.x < ext.x1 || p.x > ext.x2 || p.y < ext.y1 || p.y > ext.y2) cy.animate({ center: { eles: sel } }, { duration: 250 });
  }
}

function applySearch() {
  if (!cy) return;
  const q = state.search.trim();
  cy.nodes().removeClass('match');
  if (!q) return;
  const hits = cy.nodes().filter((n) => matchesSearch(state.deck.cards[n.id()], q));
  hits.addClass('match');
  if (hits.length) cy.animate({ fit: { eles: hits.closedNeighborhood(), padding: 60 } }, { duration: 250 });
}

function startLinkMode() {
  linkMode = state.selection ? { from: state.selection } : {};
  updateHint();
  renderToolbar();
}
function cancelLinkMode() {
  linkMode = null;
  if (cy) cy.nodes().removeClass('link-source');
  updateHint();
  if (toolbar && state.view === 'graph') renderToolbar();
}
function handleLinkTap(id) {
  if (!linkMode.from) { linkMode.from = id; updateHint(); return; }
  if (linkMode.from === id) return;
  const from = linkMode.from;
  cancelLinkMode();
  import('../linkdialog.js').then((m) => m.openLinkDialog({ from, to: id }));
}
function updateHint() {
  const h = document.getElementById('graph-hint');
  if (!h) return;
  if (cy) cy.nodes().removeClass('link-source');
  if (!linkMode) { h.hidden = true; return; }
  h.hidden = false;
  if (linkMode.from) {
    cy.getElementById(linkMode.from).addClass('link-source');
    h.textContent = `Source : « ${nameOf(state.deck.cards[linkMode.from])} ». Clique maintenant la carte sur laquelle elle agit. Échap pour annuler.`;
  } else h.textContent = 'Clique la carte source (celle qui agit), puis la carte cible. Échap pour annuler.';
}

async function exportPng() {
  try {
    const data = cy.png({ full: true, scale: 2, bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(), output: 'base64' });
    const name = await window.mtg.files.save({ defaultName: `${state.deck.name} - interactions.png`.replace(/[\\/:*?"<>|]+/g, '-'), filters: [{ name: 'Image PNG', extensions: ['png'] }], content: data, encoding: 'base64' });
    if (name) toast(`Image enregistrée : ${name}`, { kind: 'ok' });
  } catch (e) { toast(`Export impossible : ${e.message}`, { kind: 'error' }); }
}

export function graphIsLinking() { return !!linkMode; }
export function cancelGraphLinkMode() { cancelLinkMode(); }
