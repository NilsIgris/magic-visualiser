// Panneau de droite : détail de la carte sélectionnée, de ses liens, ou vue d'ensemble du deck.
import { el, clear, icon, debounce, add } from './ui.js';
import { state, on, mutate, select, setView } from './store.js';
import { LINK_KINDS, ZONE_LABELS, validate, stats, loopsOf } from './deckops.js';
import { cardImgEl, nameOf, manaCost, oracleText, faceCount } from './cardview.js';
import { describeReason } from './reasons.js';
import { setLinkStatus, deleteLink, moveCard, setQty, setPile, toggleCommander, removeCard, newPile } from './actions.js';
import { openLinkDialog } from './linkdialog.js';
import { attachHover } from './hover.js';
import { showLinks } from './views/links.js';
import { canBeCommander } from './actions.js';
import { FUNCTIONS, effectiveFunctions, mainType } from './deckops.js';
import { GROUP_MIN, membersOf, parseGroupId, groupStatus, groupScore } from '../../shared/grouping.js';
import { describeGroup } from './reasons.js';
import { openPrints } from './prints.js';
import { deckRows, hasCollection, openMissing, currentUsage } from './collection.js';
import { isBasicLand, ownedQty, summarizeOwnership } from '../../shared/inventory.js';
import { meter } from './views/links.js';

const root = () => document.getElementById('inspector');
let face = 0;
let textMode = 'oracle';
let lastSel = null;
let pending = false;

export function initInspector() {
  const rr = (p) => {
    if (p && p.reason === 'graphpos') return;
    schedule();
  };
  on('deck', rr); on('selection', () => { if (state.selection !== lastSel) { face = 0; lastSel = state.selection; } schedule(); });
  on('view', schedule);
  on('symbols', schedule);
  on('collection', schedule);
  on('usage', schedule);
  on('settings', (p) => { if (p && ('nameLang' in p || 'imageLang' in p)) schedule(); });
}
function schedule() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; render(); }); }

function render() {
  const r = root();
  const keepScroll = r.scrollTop;
  const deck = state.deck;
  const active = document.activeElement;
  if (active && r.contains(active) && active.tagName === 'TEXTAREA') return; // ne pas interrompre la saisie d'une note
  clear(r);
  if (!deck || state.view === 'library') return;
  const card = state.selection ? deck.cards[state.selection] : null;
  if (state.selectedGroup && membersOf(state.selectedGroup, deck.links).length) renderGroup(r, deck, state.selectedGroup);
  else if (card) renderCard(r, deck, card); else renderOverview(r, deck);
  if (card && lastSel === state.selection) r.scrollTop = keepScroll;
}

function renderCard(r, deck, card) {
  const id = card.oracleId;
  const entries = deck.entries.filter((e) => e.oracleId === id);
  const e = entries.find((x) => x.zone === 'commander') || entries.find((x) => x.zone === 'main') || entries[0];
  const nFaces = faceCount(card);
  const f = card.faces && card.faces.length ? card.faces[Math.min(face, card.faces.length - 1)] : null;
  const roles = state.roles[id] || { listens: [], provides: [] };

  const imgWrap = el('div', { class: 'insp-img' }, cardImgEl(card, { face, size: 'large', className: 'insp-card', loading: 'eager' }),
    nFaces > 1 ? el('button', { class: 'flip-btn', type: 'button', title: 'Retourner la carte', 'aria-label': 'Retourner la carte', on: { click: () => { face = (face + 1) % nFaces; render(); } } }, icon('flip')) : null);

  const hasPrinted = card.faces && card.faces.some((x) => x.printedText);
  const shown = textMode === 'printed' && hasPrinted && f && f.printedText ? f.printedText : (f ? f.oracleText : card.oracleText);
  const typeLine = textMode === 'printed' && f && f.printedTypeLine ? f.printedTypeLine : (f ? f.typeLine : card.typeLine);

  add(r,
    el('div', { class: 'insp-top' },
      el('button', { class: 'icon-btn', type: 'button', title: 'Fermer la carte', 'aria-label': 'Fermer la carte', on: { click: () => select(null) } }, icon('x')),
    ),
    imgWrap,
    el('div', { class: 'insp-title' },
      el('h2', { class: 'card-title', text: f && f.printedName && state.settings.nameLang === 'fr' ? f.printedName : f ? f.name : nameOf(card) }),
      manaCost(f ? f.manaCost : card.manaCost)),
    card.printedName && state.settings.nameLang === 'fr' ? el('p', { class: 'insp-alt', lang: 'en', text: card.name }) : card.printedName ? el('p', { class: 'insp-alt', text: card.printedName }) : null,
    el('p', { class: 'insp-type', text: typeLine }),
    el('div', { class: 'insp-meta' },
      el('button', { class: 'link-btn small', type: 'button', on: { click: () => openPrints(id) } }, card.chosenPrint ? `Impression : ${card.chosenPrint.setName} (${card.chosenPrint.lang === 'fr' ? 'VF' : 'VO'})` : 'Changer d\'illustration…'),
      card.gameChanger ? el('span', { class: 'tag tag-gc', title: 'Carte de la liste officielle des Game Changers (brackets Commander)', text: 'Game Changer' }) : null,
      ownershipTag(deck, id)),
    hasPrinted ? el('div', { class: 'mini-tabs', role: 'tablist' },
      el('button', { class: `mini-tab${textMode !== 'printed' ? ' on' : ''}`, type: 'button', role: 'tab', on: { click: () => { textMode = 'oracle'; render(); } } }, 'Oracle (anglais)'),
      el('button', { class: `mini-tab${textMode === 'printed' ? ' on' : ''}`, type: 'button', role: 'tab', on: { click: () => { textMode = 'printed'; render(); } } }, 'Texte imprimé (VF)')) : null,
    el('div', { lang: textMode === 'printed' && hasPrinted ? 'fr' : 'en' }, oracleText(shown)),
    f && (f.power || f.loyalty) ? el('p', { class: 'insp-pt', text: f.power ? `${f.power}/${f.toughness}` : `Loyauté ${f.loyalty}` }) : null,
  );

  // Placement dans le deck
  if (e) {
    const zoneSel = el('select', { class: 'select', 'aria-label': 'Zone', on: { change: (ev) => moveCard(id, e.zone, ev.target.value, { qty: ev.target.value === 'commander' ? 1 : null }) } },
      Object.entries(ZONE_LABELS).map(([z, l]) => el('option', { value: z, selected: z === e.zone }, l)));
    const pileSel = el('select', { class: 'select', 'aria-label': 'Pile', on: { change: async (ev) => { if (ev.target.value === '__new') { await newPile({ oracleId: id, zone: e.zone }); render(); } else setPile(id, e.zone, ev.target.value || null); } } },
      el('option', { value: '', selected: !e.pile }, 'Aucune pile'),
      deck.piles.map((p) => el('option', { value: p.id, selected: e.pile === p.id }, p.name)),
      el('option', { value: '__new' }, 'Nouvelle pile…'));
    r.append(el('section', { class: 'insp-sec' },
      el('div', { class: 'place-row' },
        el('label', { class: 'mini-field' }, el('span', { text: 'Zone' }), zoneSel),
        el('div', { class: 'mini-field' }, el('span', { text: 'Quantité' }),
          el('div', { class: 'stepper' },
            el('button', { class: 'icon-btn icon-sm', type: 'button', 'aria-label': 'Retirer un exemplaire', disabled: e.qty <= 1, on: { click: () => setQty(id, e.zone, e.qty - 1) } }, icon('minus', 14)),
            el('span', { class: 'stepper-v', text: String(e.qty) }),
            el('button', { class: 'icon-btn icon-sm', type: 'button', 'aria-label': 'Ajouter un exemplaire', disabled: e.zone === 'commander', on: { click: () => setQty(id, e.zone, e.qty + 1) } }, icon('plus', 14)))),
        el('label', { class: 'mini-field' }, el('span', { text: 'Pile' }), pileSel)),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: e.zone !== 'commander' && !canBeCommander(card), title: e.zone !== 'commander' && !canBeCommander(card) ? 'Seule une créature légendaire (ou une carte qui le précise) peut être commandant' : '', on: { click: () => toggleCommander(id) } }, icon('crown', 16), e.zone === 'commander' ? 'Retirer du commandement' : 'Commandant'),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => openLinkDialog({ from: id }) } }, icon('link', 16), 'Lier'),
        state.view !== 'graph' ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => setView('graph') } }, 'Graphe') : null,
        card.scryfallUri ? el('button', { class: 'icon-btn', type: 'button', title: 'Ouvrir sur Scryfall', 'aria-label': 'Ouvrir sur Scryfall', on: { click: () => window.mtg.shell.openExternal(card.scryfallUri) } }, icon('external')) : null,
        el('button', { class: 'icon-btn danger', type: 'button', title: 'Retirer du deck', 'aria-label': 'Retirer du deck', on: { click: () => removeCard(id, e.zone, { confirm: true }) } }, icon('trash')))));
  }

  // Rôles dans le deck (rampe, pioche…) : automatiques, corrigeables
  if (mainType(card) !== 'land') {
    const active = effectiveFunctions(deck, id, state.roles);
    const manual = Array.isArray((deck.cardRoles || {})[id]);
    const auto = ((state.roles[id] || {}).functions || []).map((x) => x.key);
    const toggle = (k) => mutate((d) => {
      d.cardRoles = d.cardRoles || {};
      const cur = effectiveFunctions(d, id, state.roles);
      const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
      if ([...next].sort().join() === [...auto].sort().join()) delete d.cardRoles[id]; else d.cardRoles[id] = next;
    }, { reason: 'roles' });
    r.append(el('section', { class: 'insp-sec' },
      el('div', { class: 'sec-head' }, el('h3', { class: 'sec-title', text: 'Rôle dans le deck' }),
        manual ? el('button', { class: 'link-btn small', type: 'button', on: { click: () => mutate((d) => { delete d.cardRoles[id]; }, { reason: 'roles' }) } }, 'Revenir à la détection') : el('span', { class: 'muted small', text: 'détection automatique' })),
      el('div', { class: 'role-toggles', role: 'group', 'aria-label': 'Rôles de la carte' }, Object.entries(FUNCTIONS).map(([k, l]) => el('button', {
        class: `role-toggle${active.includes(k) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(active.includes(k)), on: { click: () => toggle(k) },
      }, l)))));
  }

  // Rôles détectés
  if (roles.listens.length || roles.provides.length) {
    r.append(el('section', { class: 'insp-sec' },
      el('h3', { class: 'sec-title', text: 'Ce que l\'analyse a repéré' }),
      roles.provides.length ? el('div', { class: 'role-line' }, el('span', { class: 'role-k', text: 'Produit' }), el('div', { class: 'role-chips' }, roles.provides.map((x) => el('span', { class: 'role-chip', text: x })))) : null,
      roles.listens.length ? el('div', { class: 'role-line' }, el('span', { class: 'role-k', text: 'Réagit à' }), el('div', { class: 'role-chips' }, roles.listens.map((x) => el('span', { class: 'role-chip', text: x })))) : null));
  }

  // Interactions
  const out = deck.links.filter((l) => l.from === id && l.status !== 'rejected');
  const inc = deck.links.filter((l) => l.to === id && l.status !== 'rejected');
  r.append(el('section', { class: 'insp-sec' },
    el('div', { class: 'sec-head' }, el('h3', { class: 'sec-title', text: 'Interactions' }),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => openLinkDialog({ from: id }) } }, icon('plus', 16), 'Ajouter')),
    linkList('Agit sur', out, deck, 'to'),
    linkList('Réagit à', inc, deck, 'from'),
    !out.length && !inc.length ? el('p', { class: 'muted', text: 'Aucun lien. Ajoute-en un si cette carte interagit avec d\'autres.' }) : null));

  // Note
  const note = el('textarea', { class: 'input', rows: '3', placeholder: 'Ta note sur cette carte (rôle, à remplacer, ordre de jeu…)' });
  note.value = (deck.cardNotes || {})[id] || '';
  const saveNote = debounce(() => mutate((d) => { d.cardNotes = d.cardNotes || {}; if (note.value.trim()) d.cardNotes[id] = note.value; else delete d.cardNotes[id]; }, { undoable: false, reason: 'note' }), 500);
  note.addEventListener('input', saveNote);
  note.addEventListener('blur', () => saveNote.flush());
  r.append(el('section', { class: 'insp-sec' }, el('h3', { class: 'sec-title', text: 'Note' }), note));
}

function ownershipTag(deck, id) {
  if (!hasCollection()) return null;
  const c = deck.cards[id];
  if (isBasicLand(c) && state.settings.basicsOwned !== false) return null;
  const names = (list) => list.map((d) => `« ${d.name} »`).join(', ');
  const row = deckRows(deck).find((x) => x.oracleId === id);
  const others = (currentUsage().byCard.get(id) || []).filter((d) => d.deckId !== deck.id);
  const alsoTxt = others.length ? `Aussi dans ${others.map((d) => `« ${d.name} »${d.built ? ' (monté)' : ''}`).join(', ')}.` : '';
  let tag;
  if (!row) {
    const owned = ownedQty(state.collection, id);
    tag = el('span', { class: `tag ${owned ? 'tag-ok' : 'tag-warn'}`, title: alsoTxt, text: owned ? `Tu en as ${owned}` : 'Absente de ton inventaire' });
  } else if (row.status === 'free') tag = el('span', { class: 'tag tag-ok', title: alsoTxt, text: `Possédée (${row.owned})` });
  else if (row.status === 'shared') tag = el('span', { class: 'tag tag-shared', title: `En la gardant ici, il en manquera ${row.shortBy} dans ${names(row.shortIn)}.`, text: `Partagée avec ${names(row.shortIn)}` });
  else if (row.status === 'inOther') tag = el('span', { class: 'tag tag-inother', title: 'Deck monté : l\'exemplaire y est rangé.', text: `Rangée dans ${names(row.takeFrom)}` });
  else tag = el('span', { class: 'tag tag-warn', title: alsoTxt, text: row.owned ? `Tu en as ${row.owned} sur ${row.need}` : 'Absente de ton inventaire' });
  return [tag, others.length && (!row || row.status === 'free' || row.status === 'missing') ? el('span', { class: 'muted small', text: alsoTxt }) : null];
}

function linkList(title, links, deck, otherKey) {
  if (!links.length) return null;
  const lang = state.settings.nameLang;
  const sorted = [...links].sort((a, b) => (a.status === 'accepted' ? 0 : 1) - (b.status === 'accepted' ? 0 : 1) || nameOf(deck.cards[a[otherKey]]).localeCompare(nameOf(deck.cards[b[otherKey]]), 'fr'));
  // liens répétitifs : une ligne repliable par (type, règle) à partir de GROUP_MIN cartes
  const bucket = new Map();
  if (state.settings.groupLinks !== false) {
    for (const l of sorted) {
      if (l.origin === 'manual') continue;
      const k = `${l.kind}|${(l.reasons && l.reasons[0] && l.reasons[0].rule) || ''}`;
      if (!bucket.has(k)) bucket.set(k, []);
      bucket.get(k).push(l);
    }
    for (const [k, v] of bucket) if (v.length < GROUP_MIN) bucket.delete(k);
  }
  const inBucket = new Set([...bucket.values()].flat().map((l) => l.id));
  const groups = [...bucket.entries()].map(([k, ls]) => {
    const [kindKey, rule] = k.split('|');
    const kind = LINK_KINDS[kindKey] || LINK_KINDS.synergy;
    const g = { side: otherKey === 'from' ? 'to' : 'from', rule, members: ls };
    const pend = ls.filter((l) => l.status === 'pending');
    return el('li', { class: 'ilink-group' }, el('details', {},
      el('summary', {}, el('span', { class: 'kind-dot', style: { background: kind.color }, title: kind.label }), el('span', { class: 'ig-label', text: describeGroup(g) }), el('span', { class: 'ilink-kind', text: `${kind.label}${pend.length ? `, ${pend.length} à valider` : ''}` })),
      pend.length ? el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => setLinkStatus(pend.map((l) => l.id), 'accepted') } }, icon('check', 15), 'Tout valider'),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => setLinkStatus(pend.map((l) => l.id), 'rejected') } }, 'Tout rejeter')) : null,
      el('div', { class: 'chip-wrap ig-members' }, ls.map((l) => { const o = deck.cards[l[otherKey]]; const b = el('button', { class: `card-chip st-${l.status}`, type: 'button', on: { click: () => select(o.oracleId) } }, cardImgEl(o, { size: 'artCrop', className: 'chip-img' }), el('span', { text: nameOf(o) })); attachHover(b, () => o); return b; }))));
  });
  return el('div', { class: 'insp-links' },
    el('h4', { class: 'sub-title', text: `${title} (${links.length})` }),
    el('ul', { class: 'ilinks' }, groups, sorted.filter((l) => !inBucket.has(l.id)).map((l) => {
      const other = deck.cards[l[otherKey]];
      const kind = LINK_KINDS[l.kind] || LINK_KINDS.synergy;
      const why = l.origin === 'manual' ? (l.note || 'Lien manuel') : (l.reasons || []).map((x) => describeReason(x, deck.cards[l.from], deck.cards[l.to], lang)).join(' ');
      const nameBtn = el('button', { class: 'ilink-name', type: 'button', on: { click: () => select(other.oracleId) } }, cardImgEl(other, { size: 'artCrop', className: 'chip-img' }), el('span', { text: nameOf(other) }));
      attachHover(nameBtn, () => other);
      return el('li', { class: `ilink st-${l.status}${state.selectedLink === l.id ? ' sel' : ''}`, title: why },
        el('span', { class: 'kind-dot', style: { background: kind.color }, title: kind.label }),
        el('div', { class: 'ilink-body' }, nameBtn, el('span', { class: 'ilink-kind', text: `${kind.label}${l.status === 'pending' ? ', à valider' : ''}` }), state.selectedLink === l.id ? el('p', { class: 'ilink-why', text: why }) : null),
        el('div', { class: 'ilink-act' },
          l.status === 'pending' ? el('button', { class: 'icon-btn icon-sm ok', type: 'button', title: 'Valider', 'aria-label': 'Valider', on: { click: () => setLinkStatus(l.id, 'accepted') } }, icon('check', 15)) : null,
          l.origin === 'manual'
            ? el('button', { class: 'icon-btn icon-sm danger', type: 'button', title: 'Supprimer', 'aria-label': 'Supprimer', on: { click: () => deleteLink(l.id) } }, icon('trash', 15))
            : el('button', { class: 'icon-btn icon-sm danger', type: 'button', title: 'Rejeter', 'aria-label': 'Rejeter', on: { click: () => setLinkStatus(l.id, 'rejected') } }, icon('x', 15)),
          el('button', { class: 'icon-btn icon-sm', type: 'button', title: 'Détails et modification', 'aria-label': 'Modifier', on: { click: () => openLinkDialog({ edit: l.id }) } }, icon('more', 15))));
    })));
}

function renderGroup(r, deck, groupId) {
  const members = membersOf(groupId, deck.links);
  const { side, anchor } = parseGroupId(groupId);
  const g = { side, rule: parseGroupId(groupId).rule, members };
  const kind = LINK_KINDS[parseGroupId(groupId).kind] || LINK_KINDS.synergy;
  const st = groupStatus(g);
  const pend = members.filter((l) => l.status === 'pending');
  const a = deck.cards[anchor];
  const otherKey = side === 'to' ? 'from' : 'to';
  const snip = (members[0].reasons || []).map((x) => x.snippet).filter(Boolean)[0];
  const anchorBtn = el('button', { class: 'card-chip', type: 'button', on: { click: () => select(anchor) } }, cardImgEl(a, { size: 'artCrop', className: 'chip-img' }), el('span', { text: nameOf(a) }));
  attachHover(anchorBtn, () => a);
  r.append(el('div', { class: 'insp-top' }, el('button', { class: 'icon-btn', type: 'button', title: 'Fermer', 'aria-label': 'Fermer', on: { click: () => select(null) } }, icon('x'))),
    el('div', { class: 'ov' },
      el('p', { class: 'muted small', text: 'Groupe de liens' }),
      el('h2', { class: 'ov-title', text: describeGroup(g) }),
      el('div', { class: 'link-line' }, side === 'to' ? el('span', { class: 'kind-chip', style: { '--k': kind.color } }, kind.label) : anchorBtn, side === 'to' ? anchorBtn : el('span', { class: 'kind-chip', style: { '--k': kind.color } }, kind.label), meter(groupScore(g))),
      snip ? el('p', { class: 'link-snip', lang: 'en', text: snip }) : null,
      el('p', { class: 'small', text: [st.accepted ? `${st.accepted} validé${st.accepted > 1 ? 's' : ''}` : null, st.pending ? `${st.pending} à valider` : null, st.rejected ? `${st.rejected} rejeté${st.rejected > 1 ? 's' : ''}` : null].filter(Boolean).join(', ') }),
      pend.length ? el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', on: { click: () => setLinkStatus(pend.map((l) => l.id), 'accepted') } }, icon('check', 16), `Valider (${pend.length})`),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => setLinkStatus(pend.map((l) => l.id), 'rejected') } }, 'Tout rejeter')) : null),
    el('section', { class: 'insp-sec' },
      el('h3', { class: 'sec-title', text: 'Cartes du groupe' }),
      el('ul', { class: 'ilinks' }, members.map((l) => {
        const o = deck.cards[l[otherKey]];
        const b = el('button', { class: 'ilink-name', type: 'button', on: { click: () => select(o.oracleId) } }, cardImgEl(o, { size: 'artCrop', className: 'chip-img' }), el('span', { text: nameOf(o) }));
        attachHover(b, () => o);
        return el('li', { class: `ilink st-${l.status}` },
          el('span', { class: 'kind-dot', style: { background: kind.color } }),
          el('div', { class: 'ilink-body' }, b, el('span', { class: 'ilink-kind', text: l.status === 'accepted' ? 'validé' : l.status === 'rejected' ? 'rejeté' : 'à valider' })),
          el('div', { class: 'ilink-act' },
            l.status !== 'accepted' ? el('button', { class: 'icon-btn icon-sm ok', type: 'button', title: 'Valider', 'aria-label': 'Valider', on: { click: () => setLinkStatus(l.id, 'accepted') } }, icon('check', 15)) : null,
            l.status !== 'rejected' ? el('button', { class: 'icon-btn icon-sm danger', type: 'button', title: 'Rejeter', 'aria-label': 'Rejeter', on: { click: () => setLinkStatus(l.id, 'rejected') } }, icon('x', 15)) : null));
      }))));
}

function renderOverview(r, deck) {
  const s = stats(deck);
  const issues = validate(deck);
  const pend = deck.links.filter((l) => l.status === 'pending').length;
  const acc = deck.links.filter((l) => l.status === 'accepted').length;
  const loops = loopsOf(deck);
  r.append(el('div', { class: 'ov' },
    el('h2', { class: 'ov-title', text: deck.name }),
    el('p', { class: 'muted', text: 'Sélectionne une carte pour voir son texte et ses interactions.' }),
    el('dl', { class: 'ov-stats' },
      el('div', {}, el('dt', { text: 'Cartes' }), el('dd', { text: `${s.total} / 100` })),
      el('div', {}, el('dt', { text: 'Terrains' }), el('dd', { text: String(s.lands) })),
      el('div', {}, el('dt', { text: 'Créatures' }), el('dd', { text: String(s.creatures) })),
      el('div', {}, el('dt', { text: 'Coût moyen' }), el('dd', { text: s.avgMv.toFixed(2).replace('.', ',') })),
      el('div', {}, el('dt', { text: 'Liens validés' }), el('dd', { text: String(acc) })),
      el('div', {}, el('dt', { text: 'Suggestions' }), el('dd', { text: String(pend) }))),
    pend ? el('button', { class: 'btn btn-primary btn-block', type: 'button', on: { click: () => showLinks('pending') } }, `Passer en revue ${pend} suggestion${pend > 1 ? 's' : ''}`) : null,
    loops.length ? el('p', { class: 'ov-note', text: `${loops.length} boucle${loops.length > 1 ? 's' : ''} possible${loops.length > 1 ? 's' : ''} parmi les liens validés (onglet Interactions).` }) : null));

  if (hasCollection()) {
    const s = summarizeOwnership(deckRows(deck));
    const parts = [s.missing ? `${s.missing} manquante${s.missing > 1 ? 's' : ''}` : null, s.inOther ? `${s.inOther} rangée${s.inOther > 1 ? 's' : ''} dans un autre deck` : null, s.shared ? `${s.shared} partagée${s.shared > 1 ? 's' : ''}` : null].filter(Boolean);
    r.append(el('section', { class: 'insp-sec' },
      el('h3', { class: 'sec-title', text: deck.built ? 'Collection (deck monté)' : 'Collection' }),
      el('p', {}, parts.length ? `${parts.join(', ')}. ` : 'Tu possèdes toutes les cartes de ce deck, sans en prendre à un autre. ', el('button', { class: 'link-btn', type: 'button', on: { click: openMissing } }, 'Voir le détail'))));
  }

  if (deck.unresolved.length) {
    r.append(el('section', { class: 'insp-sec' },
      el('h3', { class: 'sec-title', text: `Cartes non trouvées (${deck.unresolved.length})` }),
      el('p', { class: 'muted', text: 'Corrige l\'orthographe puis relance la recherche.' }),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => import('./importer.js').then((m) => m.openFixUnresolved()) } }, 'Corriger les noms…'),
      el('ul', { class: 'plain-list' }, deck.unresolved.map((u) => el('li', { text: `${u.qty} ${u.name}` })))));
  }
  const cardIssues = issues.filter((i) => !i.unresolved);
  if (cardIssues.length) {
    r.append(el('section', { class: 'insp-sec' },
      el('h3', { class: 'sec-title', text: `Construction (${cardIssues.length})` }),
      el('ul', { class: 'issue-list' }, cardIssues.map((i) => el('li', { class: `issue issue-${i.level}` },
        i.cardId ? el('button', { class: 'link-btn', type: 'button', on: { click: () => select(i.cardId) } }, nameOf(deck.cards[i.cardId])) : null,
        el('span', { text: ` ${i.text}` }))))));
  }
  const notes = el('textarea', { class: 'input', rows: '5', placeholder: 'Plan de jeu, cartes à tester, mulligans…' });
  notes.value = deck.notes || '';
  const saveNotes = debounce(() => mutate((d) => { d.notes = notes.value; }, { undoable: false, reason: 'note' }), 500);
  notes.addEventListener('input', saveNotes);
  notes.addEventListener('blur', () => saveNotes.flush());
  r.append(el('section', { class: 'insp-sec' }, el('h3', { class: 'sec-title', text: 'Notes du deck' }), notes));
}
