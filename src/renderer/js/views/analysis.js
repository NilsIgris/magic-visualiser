// Vue Analyse : rôles et repères, base de mana, probabilités, main de départ, combos et bracket.
import { el, clear, icon, toast, confirmDialog, add } from '../ui.js';
import { state, on, select, mutate } from '../store.js';
import { BENCHMARKS, FUNCTIONS, roleCounts, manaAnalysis, mainType, effectiveFunctions } from '../deckops.js';
import { cardImgEl, nameOf, colorPips } from '../cardview.js';
import { attachHover } from '../hover.js';
import { hyperAtLeast, cardsSeen, shuffle } from '../../../shared/prob.js';
import { estimateBracket, localFlags, BRACKET_NAMES } from '../../../shared/bracket.js';
import { normalizeName } from '../../../shared/parser.js';

const api = window.mtg;
const root = () => document.getElementById('view-analysis');
const ui = { openRole: null, drawFirst: true, calc: { target: 'role:ramp', k: 1, turn: 3 }, freeMull: true, loading: false };
let hand = null; // { library, hand, mulligans, bottom, drawn }
let pendingRender = false;

export function initAnalysis() {
  const rr = (p) => { if (p && p.reason === 'graphpos') return; if (state.view === 'analysis') schedule(); };
  on('deck', (p) => { if (p && (p.reason === 'open' || p.reason === 'close')) hand = null; rr(p); });
  on('view', rr);
  on('settings', (p) => { if (p && ('nameLang' in p || 'imageLang' in p)) rr(); });
}
function schedule() { if (pendingRender) return; pendingRender = true; requestAnimationFrame(() => { pendingRender = false; render(); }); }

const pct = (p) => `${Math.round(p * 100)} %`;

function chip(id) {
  const c = state.deck.cards[id];
  const b = el('button', { class: 'card-chip', type: 'button', on: { click: () => select(id) } }, cardImgEl(c, { size: 'artCrop', className: 'chip-img' }), el('span', { text: nameOf(c) }));
  attachHover(b, () => c);
  return b;
}

function render() {
  const deck = state.deck;
  if (!deck) return;
  const r = root();
  const top = r.scrollTop;
  clear(r);
  if (!deck.entries.length) { r.append(el('div', { class: 'board-empty' }, el('h2', { text: 'Rien à analyser pour l\'instant' }), el('p', { text: 'Importe ou ajoute des cartes pour voir les repères, la base de mana et les combos.' }))); return; }
  const wrap = el('div', { class: 'an-wrap' });
  wrap.append(rolesPanel(deck), manaPanel(deck), probaPanel(deck), handPanel(deck), combosPanel(deck));
  r.append(wrap);
  r.scrollTop = top;
}

// ------------------------------------------------------------------ rôles et repères
function rolesPanel(deck) {
  const counts = roleCounts(deck, state.roles);
  const rows = BENCHMARKS.map((b) => {
    const c = counts[b.key];
    const ratio = Math.min(1.25, c.qty / b.target);
    const diff = c.qty - b.target;
    const status = Math.abs(diff) <= Math.max(1, Math.round(b.target * 0.15)) ? 'ok' : diff < 0 ? 'low' : 'high';
    const open = ui.openRole === b.key;
    const row = el('div', { class: `bm-row st-${status}` },
      el('button', { class: 'bm-label', type: 'button', 'aria-expanded': String(open), on: { click: () => { ui.openRole = open ? null : b.key; render(); } } }, el('span', { text: b.label })),
      el('div', { class: 'bm-bar', role: 'img', 'aria-label': `${c.qty} sur ${b.target} conseillés` },
        el('div', { class: 'bm-fill', style: { width: `${Math.round((ratio / 1.25) * 100)}%` } }),
        el('div', { class: 'bm-target', style: { left: `${Math.round((1 / 1.25) * 100)}%` }, title: `Repère : ${b.target}` })),
      el('span', { class: 'bm-n' }, el('strong', { text: String(c.qty) }), ` / ${b.target}`),
      el('span', { class: 'bm-st', text: status === 'ok' ? 'dans le repère' : diff < 0 ? `${-diff} de moins` : `${diff} de plus` }));
    const list = open ? el('div', { class: 'bm-list' }, c.ids.length ? c.ids.map((id) => chip(id)) : el('p', { class: 'muted', text: 'Aucune carte détectée dans ce rôle.' })) : null;
    return [row, list];
  });
  const others = ['tutor', 'protection', 'recursion'].map((k) => el('span', { class: 'role-chip', title: 'Cliquer pour voir les cartes', on: { click: () => { ui.openRole = ui.openRole === k ? null : k; render(); } } }, `${FUNCTIONS[k]} : ${counts[k].qty}`));
  const openOther = ['tutor', 'protection', 'recursion'].includes(ui.openRole) ? el('div', { class: 'bm-list' }, counts[ui.openRole].ids.map((id) => chip(id))) : null;
  return el('section', { class: 'an-panel' },
    el('h2', { class: 'an-title', text: 'Rôles et repères' }),
    el('p', { class: 'muted small', text: 'Repères du modèle de construction de l\'émission The Command Zone (épisode 658). Une carte peut remplir plusieurs rôles. Le classement est automatique d\'après le texte Oracle : corrige le rôle d\'une carte depuis son panneau si besoin.' }),
    el('div', { class: 'bm' }, rows),
    el('div', { class: 'role-chips bm-others' }, others), openOther);
}

// ------------------------------------------------------------------ base de mana
function manaPanel(deck) {
  const a = manaAnalysis(deck, { drawOnFirstTurn: ui.drawFirst });
  const table = a.rows.length ? el('table', { class: 'an-table' },
    el('thead', {}, el('tr', {}, el('th', { text: 'Couleur' }), el('th', { text: 'Symboles' }), el('th', { text: 'Terrains sources' }), el('th', { text: 'Autres sources' }),
      ...[1, 2, 3, 4].map((t) => el('th', { text: `≥ 1 source au tour ${t}` })))),
    el('tbody', {}, a.rows.map((row) => el('tr', { class: row.share > 0 && row.landSources / Math.max(1, a.landCount) < row.share * 0.6 ? 'warn' : '' },
      el('td', {}, colorPips([row.color])),
      el('td', { text: `${row.pips} (${pct(row.share)})` }),
      el('td', { text: String(row.landSources) }),
      el('td', { text: String(row.otherSources) }),
      ...row.byTurn.map((p) => el('td', { class: p < 0.8 ? 'lowp' : '', text: pct(p) })))))) : el('p', { class: 'muted', text: 'Définis un commandant pour connaître l\'identité couleur du deck.' });
  const maxP = Math.max(...a.opening, 0.0001);
  const hist = el('div', { class: 'hist', role: 'img', 'aria-label': `Terrains en main de départ : ${a.opening.map((p, k) => `${k} terrain${k > 1 ? 's' : ''} ${pct(p)}`).join(', ')}` },
    a.opening.map((p, k) => el('div', { class: `hist-col${k >= 2 && k <= 4 ? ' keep' : ''}` },
      el('span', { class: 'hist-v', text: pct(p) }),
      el('div', { class: 'hist-bar', style: { height: `${Math.round((p / maxP) * 100)}%` } }),
      el('span', { class: 'hist-x', text: String(k) }))));
  return el('section', { class: 'an-panel' },
    el('h2', { class: 'an-title', text: 'Base de mana' }),
    el('p', { class: 'muted small', text: `Bibliothèque de ${a.N} cartes dont ${a.landCount} terrains. Les probabilités sont exactes pour un paquet mélangé au hasard, sans mulligan, en ne comptant que les terrains.` }),
    el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: ui.drawFirst, on: { change: (e) => { ui.drawFirst = e.target.checked; render(); } } }), el('span', { text: 'Je pioche dès mon premier tour (règle multijoueur ; décoche pour un duel où tu commences)' })),
    table,
    el('h3', { class: 'an-sub', text: `Terrains dans la main de départ : ${pct(a.keepable)} de mains à 2-4 terrains` }),
    hist);
}

// ------------------------------------------------------------------ probabilités
function probaPanel(deck) {
  const counts = roleCounts(deck, state.roles);
  const main = deck.entries.filter((e) => e.zone === 'main' && deck.cards[e.oracleId]);
  const N = main.reduce((a, e) => a + e.qty, 0);
  const ids = [...new Set(main.map((e) => e.oracleId))].sort((x, y) => nameOf(deck.cards[x]).localeCompare(nameOf(deck.cards[y]), 'fr'));
  const targets = [
    ['role:land', `Terrains (${counts.land.qty})`],
    ...Object.entries(FUNCTIONS).map(([k, l]) => [`role:${k}`, `${l} (${counts[k].qty})`]),
    ...deck.piles.map((p) => [`pile:${p.id}`, `Pile « ${p.name} »`]),
  ];
  const K = (() => {
    const t = ui.calc.target;
    const inMain = (pred) => main.filter(pred).reduce((a, e) => a + e.qty, 0);
    if (t === 'role:land') return inMain((e) => mainType(deck.cards[e.oracleId]) === 'land');
    if (t.startsWith('role:')) { const k = t.slice(5); return inMain((e) => mainType(deck.cards[e.oracleId]) !== 'land' && effectiveFunctions(deck, e.oracleId, state.roles).includes(k)); }
    if (t.startsWith('pile:')) return inMain((e) => e.pile === t.slice(5));
    if (t.startsWith('card:')) return inMain((e) => e.oracleId === t.slice(5));
    return 0;
  })();
  const n = cardsSeen(ui.calc.turn, ui.drawFirst);
  const p = hyperAtLeast(N, K, n, ui.calc.k);
  const sel = el('select', { class: 'select', 'aria-label': 'Cartes recherchées', on: { change: (e) => { ui.calc.target = e.target.value; render(); } } },
    el('optgroup', { label: 'Rôles et piles' }, targets.map(([v, l]) => el('option', { value: v, selected: ui.calc.target === v }, l))),
    el('optgroup', { label: 'Une carte précise' }, ids.map((id) => el('option', { value: `card:${id}`, selected: ui.calc.target === `card:${id}` }, nameOf(deck.cards[id])))));
  const num = (key, min, max, label) => el('input', { class: 'input input-num', type: 'number', min: String(min), max: String(max), value: String(ui.calc[key]), 'aria-label': label,
    on: { change: (e) => { const v = Math.max(min, Math.min(max, Math.round(Number(e.target.value) || min))); ui.calc[key] = v; render(); } } });
  return el('section', { class: 'an-panel' },
    el('h2', { class: 'an-title', text: 'Probabilité de piocher' }),
    el('div', { class: 'calc' },
      el('span', { text: 'Au moins' }), num('k', 1, 7, 'Nombre minimal'), el('span', { text: 'carte(s) parmi' }), sel, el('span', { text: 'd\'ici le tour' }), num('turn', 1, 15, 'Tour')),
    el('p', { class: 'calc-out' }, el('strong', { text: pct(p) }), el('span', { class: 'muted', text: ` (${K} carte${K > 1 ? 's' : ''} concernée${K > 1 ? 's' : ''} sur ${N}, ${n} cartes vues)` })));
}

// ------------------------------------------------------------------ main de départ
function newHand(deck) {
  const lib = [];
  for (const e of deck.entries) if (e.zone === 'main' && deck.cards[e.oracleId]) for (let i = 0; i < e.qty; i++) lib.push(e.oracleId);
  const sh = shuffle(lib);
  return { library: sh.slice(7), hand: sh.slice(0, 7), mulligans: 0, bottom: 0, drawn: 0 };
}

function handPanel(deck) {
  // le deck a pu changer depuis le tirage : on retire les cartes qui n'y sont plus
  if (hand) {
    hand.hand = hand.hand.filter((id) => deck.cards[id]);
    hand.library = hand.library.filter((id) => deck.cards[id]);
  }
  const body = el('div', { class: 'hand-body' });
  const actions = el('div', { class: 'btn-row' },
    el('button', { class: 'btn btn-primary btn-sm', type: 'button', on: { click: () => { hand = newHand(deck); render(); } } }, hand ? 'Nouvelle main' : 'Tirer une main'),
    hand ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: hand.bottom > 0 || !hand.library.length, on: { click: () => { hand.hand.push(hand.library.shift()); hand.drawn++; render(); } } }, 'Piocher une carte') : null,
    hand ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: hand.mulligans >= 6, on: { click: () => {
      const m = hand.mulligans + 1;
      const fresh = newHand(deck);
      hand = { ...fresh, mulligans: m, bottom: ui.freeMull ? m - 1 : m };
      render();
    } } }, 'Mulligan') : null,
    el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: ui.freeMull, on: { change: (e) => { ui.freeMull = e.target.checked; } } }), el('span', { text: 'Premier mulligan gratuit (multijoueur)' })));
  if (hand) {
    const lands = hand.hand.filter((id) => mainType(deck.cards[id]) === 'land').length;
    add(body, el('p', { class: 'hand-info' },
      `${hand.hand.length} cartes en main, dont ${lands} terrain${lands > 1 ? 's' : ''}`,
      hand.mulligans ? `, ${hand.mulligans} mulligan${hand.mulligans > 1 ? 's' : ''}` : '',
      hand.drawn ? `, ${hand.drawn} pioche${hand.drawn > 1 ? 's' : ''}` : '', '.'),
    hand.bottom ? el('p', { class: 'hand-bottom', text: `Clique ${hand.bottom} carte${hand.bottom > 1 ? 's' : ''} à placer sous ta bibliothèque.` }) : null);
    const row = el('div', { class: 'hand-cards' });
    hand.hand.forEach((id, i) => {
      const c = deck.cards[id];
      const t = el('button', { class: `hand-card${hand.bottom ? ' pickable' : ''}`, type: 'button', 'aria-label': nameOf(c), on: { click: () => {
        if (!hand.bottom) { select(id); return; }
        hand.library.push(hand.hand.splice(i, 1)[0]); hand.bottom--; render();
      } } }, cardImgEl(c, { size: 'normal', className: 'hand-img' }));
      attachHover(t, () => c);
      row.append(t);
    });
    body.append(row);
  } else body.append(el('p', { class: 'muted', text: 'Tire une main de sept cartes au hasard pour tester ton deck, avec pioches et mulligans (règle de Londres).' }));
  return el('section', { class: 'an-panel' }, el('h2', { class: 'an-title', text: 'Main de départ' }), actions, body);
}

// ------------------------------------------------------------------ combos et bracket
function deckRequest(deck) {
  const main = []; const commanders = [];
  for (const e of deck.entries) {
    const c = deck.cards[e.oracleId];
    if (!c) continue;
    if (e.zone === 'commander') commanders.push({ card: c.name, quantity: 1 });
    else if (e.zone === 'main') main.push({ card: c.name, quantity: e.qty });
  }
  return { main, commanders };
}

async function runSpellbook() {
  const deck = state.deck;
  if (!deck.spellbook) {
    const ok = await confirmDialog({ title: 'Analyser avec Commander Spellbook', message: 'La liste des cartes de ce deck (noms uniquement) va être envoyée au service Commander Spellbook pour y chercher les combos connues et estimer le bracket.', confirmLabel: 'Analyser' });
    if (!ok) return;
  }
  ui.loading = true; render();
  try {
    const res = await api.spellbook.analyze(deckRequest(deck));
    mutate((d) => { d.spellbook = res; }, { undoable: false, reason: 'spellbook' });
    toast(`${res.included.length} combo${res.included.length > 1 ? 's' : ''} trouvée${res.included.length > 1 ? 's' : ''} dans le deck.`, { kind: 'ok' });
  } catch (e) {
    toast(e.message, { kind: 'error' });
  } finally { ui.loading = false; render(); }
}

function idsByName(deck) {
  const m = new Map();
  for (const c of Object.values(deck.cards)) {
    m.set(normalizeName(c.name), c.oracleId);
    for (const part of c.name.split(' // ')) m.set(normalizeName(part), c.oracleId);
  }
  return m;
}

function comboLinkIds(deck, combo) {
  const byName = idsByName(deck);
  return combo.cards.map((c) => (c.oracleId && deck.cards[c.oracleId] ? c.oracleId : byName.get(normalizeName(c.name || '')))).filter(Boolean);
}

function addComboLinks(combo) {
  const deck = state.deck;
  const ids = comboLinkIds(deck, combo);
  if (ids.length < 2) { toast('Les cartes de cette combo ne sont pas toutes dans le deck.', { kind: 'error' }); return; }
  let added = 0;
  mutate((d) => {
    for (let i = 0; i < ids.length; i++) {
      const from = ids[i]; const to = ids[(i + 1) % ids.length];
      if (ids.length === 2 && i === 1) break;
      if (d.links.some((l) => l.from === from && l.to === to && l.kind === 'combo')) continue;
      d.links.push({ id: `m:csb${combo.id}-${i}`, from, to, kind: 'combo', origin: 'manual', source: 'spellbook', status: 'accepted', reasons: [], note: `Combo Commander Spellbook n° ${combo.id} : ${combo.produces.join(', ')}` });
      added++;
    }
  }, { reason: 'links' });
  toast(added ? `${added} lien${added > 1 ? 's' : ''} « Combo » ajouté${added > 1 ? 's' : ''}.` : 'Ces liens existent déjà.', { kind: added ? 'ok' : 'info' });
}

function comboCard(deck, combo, { almost = false } = {}) {
  const inDeck = new Set(comboLinkIds(deck, combo));
  const byName = idsByName(deck);
  return el('article', { class: 'combo' },
    el('div', { class: 'combo-cards' }, combo.cards.map((c) => {
      const id = c.oracleId && deck.cards[c.oracleId] ? c.oracleId : byName.get(normalizeName(c.name || ''));
      return id && inDeck.has(id) ? chip(id) : el('span', { class: 'missing-chip', title: 'Absente du deck' }, icon('plus', 14), c.name);
    }), combo.templates.map((t) => el('span', { class: 'tag', title: 'Toute carte qui remplit ce rôle', text: t }))),
    el('p', { class: 'combo-result' }, el('strong', { text: 'Résultat : ' }), combo.produces.join(', ') || 'non précisé'),
    combo.manaNeeded ? el('p', { class: 'muted small', lang: 'en', text: `Mana : ${combo.manaNeeded}` }) : null,
    el('details', { class: 'combo-steps' }, el('summary', { text: 'Étapes (en anglais, d\'après Commander Spellbook)' }),
      combo.easyPrerequisites ? el('p', { lang: 'en', class: 'small', text: `Prérequis : ${combo.easyPrerequisites}` }) : null,
      combo.notablePrerequisites ? el('p', { lang: 'en', class: 'small', text: combo.notablePrerequisites }) : null,
      el('ol', { lang: 'en', class: 'small' }, combo.description.split('\n').filter((s) => s.trim()).map((s) => el('li', { text: s })))),
    el('div', { class: 'btn-row' },
      almost ? null : el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => addComboLinks(combo) } }, icon('link', 16), 'Ajouter comme liens « Combo »'),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => api.shell.openExternal(`https://commanderspellbook.com/combo/${encodeURIComponent(combo.id)}/`) } }, icon('external', 16), 'Voir sur Commander Spellbook')));
}

function combosPanel(deck) {
  const sb = deck.spellbook;
  const playing = deck.entries.filter((e) => (e.zone === 'main' || e.zone === 'commander') && deck.cards[e.oracleId]).map((e) => deck.cards[e.oracleId]);
  const uniq = [...new Map(playing.map((c) => [c.oracleId, c])).values()];
  // Game Changers : classification Commander Spellbook si disponible (plus récente), sinon champ Scryfall
  const gcNames = sb && sb.bracket ? sb.bracket.cards.filter((c) => c.gameChanger).map((c) => c.name) : uniq.filter((c) => c.gameChanger).map((c) => c.name);
  const lf = localFlags(uniq);
  const extraTurns = sb && sb.bracket ? [...new Set([...sb.bracket.cards.filter((c) => c.extraTurn).map((c) => c.name)])] : lf.extraTurns;
  const mld = sb && sb.bracket ? [...new Set([...sb.bracket.cards.filter((c) => c.massLandDenial).map((c) => c.name)])] : lf.massLandDenial;
  let twoCard = null;
  if (sb && sb.bracket) {
    const ids = new Set(sb.included.map((c) => c.id));
    twoCard = sb.bracket.combos.filter((c) => c.definitelyTwoCard && ids.has(c.id)).length;
  }
  const est = estimateBracket({ gameChangers: gcNames, twoCardCombos: twoCard, massLandDenial: mld, extraTurns });
  const nameToId = idsByName(deck);
  const gcChips = gcNames.map((n) => nameToId.get(normalizeName(n))).filter(Boolean).map((id) => chip(id));
  const panel = el('section', { class: 'an-panel' },
    el('div', { class: 'sec-head' }, el('h2', { class: 'an-title', text: 'Combos connues et bracket' }),
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: ui.loading, on: { click: runSpellbook } }, ui.loading ? 'Analyse en cours…' : sb ? 'Relancer l\'analyse' : 'Analyser avec Commander Spellbook')),
    el('div', { class: 'bracket' },
      el('div', { class: 'bracket-num' }, el('span', { class: 'bracket-n', text: String(est.min) }), el('span', { class: 'bracket-name', text: BRACKET_NAMES[est.min] })),
      el('div', { class: 'bracket-why' },
        el('p', { class: 'bracket-lead', text: `Bracket minimal estimé : ${est.min} (${BRACKET_NAMES[est.min]}).` }),
        est.reasons.length ? el('ul', { class: 'plain-list' }, est.reasons.map((x) => el('li', { text: x.text }))) : el('p', { class: 'muted small', text: 'Aucun critère ne force un bracket supérieur à 1.' }),
        est.unknownCombos ? el('p', { class: 'muted small', text: 'Les combos à deux cartes ne sont pas encore vérifiées : lance l\'analyse Commander Spellbook.' }) : null,
        el('p', { class: 'muted small', text: 'C\'est un plancher calculé d\'après les règles de Wizards of the Coast. Le bracket réel dépend aussi de la vitesse du deck et de ton intention ; le bracket 5 (cEDH) ne se déduit pas d\'une liste.' }))),
    gcChips.length ? el('div', {}, el('h3', { class: 'an-sub', text: `Game Changers (${gcChips.length})` }), el('div', { class: 'chip-wrap' }, gcChips)) : null);
  if (!sb) {
    panel.append(el('p', { class: 'muted', text: 'Commander Spellbook recense les combos connues de Magic. L\'analyse liste celles qui sont complètes dans ton deck et celles auxquelles il ne manque qu\'une carte.' }));
    return panel;
  }
  panel.append(el('p', { class: 'muted small an-date', text: `Analyse du ${new Date(sb.fetchedAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}. Données : Commander Spellbook (commanderspellbook.com).` }));
  panel.append(el('h3', { class: 'an-sub', text: `Combos complètes dans le deck (${sb.included.length})` }));
  panel.append(sb.included.length ? el('div', { class: 'combo-list' }, sb.included.map((c) => comboCard(deck, c))) : el('p', { class: 'muted', text: 'Aucune combo connue n\'est complète dans ce deck.' }));
  panel.append(el('details', { class: 'almost' }, el('summary', {}, el('span', { class: 'an-sub-inline', text: `Combos à une carte près (${sb.almost.length})` })),
    sb.almost.length ? el('div', { class: 'combo-list' }, sb.almost.map((c) => comboCard(deck, c, { almost: true }))) : el('p', { class: 'muted', text: 'Aucune.' })));
  return panel;
}
