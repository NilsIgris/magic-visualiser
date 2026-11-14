// Champ « Ajouter une carte » : recherche Scryfall avec autocomplétion (noms anglais) et cache local (noms français).
import { el, icon, toast, debounce } from './ui.js';
import { state, mutate, select, undo } from './store.js';
import { applyImport, ZONE_LABELS } from './deckops.js';
import { itemKey } from './importer.js';

const api = window.mtg;
let box = null; let input = null; let zoneSel = null; let list = null;
let items = []; let active = -1; let seq = 0; let busy = false;

export function addCardBox() {
  if (box) return box;
  input = el('input', {
    class: 'input add-input', type: 'text', placeholder: 'Ajouter une carte (anglais ou français)', spellcheck: 'false', autocomplete: 'off',
    role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list', 'aria-controls': 'add-list', 'aria-label': 'Ajouter une carte au deck',
  });
  zoneSel = el('select', { class: 'select', 'aria-label': 'Zone de la carte ajoutée' },
    Object.entries(ZONE_LABELS).filter(([z]) => z !== 'commander').map(([z, l]) => el('option', { value: z, selected: z === 'main' }, l)));
  list = el('ul', { class: 'ac-list', id: 'add-list', role: 'listbox', hidden: true });
  box = el('div', { class: 'add-box' }, icon('plus', 16), input, zoneSel, list);

  const fetchSugg = debounce(async () => {
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < 2) { close(); return; }
    const [local, remote] = await Promise.all([api.cache.searchNames(q).catch(() => []), api.scryfall.autocomplete(q).catch(() => [])]);
    if (my !== seq) return;
    const seen = new Set();
    items = [];
    for (const l of local) if (!seen.has(l.name)) { seen.add(l.name); items.push({ name: l.name, label: l.label }); }
    for (const n of remote) if (!seen.has(n)) { seen.add(n); items.push({ name: n, label: n }); }
    items = items.slice(0, 10);
    active = items.length ? 0 : -1;
    draw();
  }, 180);

  input.addEventListener('input', fetchSugg);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) { active = (active + 1) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && items.length) { active = (active - 1 + items.length) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); const v = input.value.trim(); if (!v) return; choose(!list.hidden && items[active] ? items[active] : { name: v, label: v }); }
    else if (e.key === 'Escape') { if (!list.hidden) { close(); e.stopPropagation(); } else input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  return box;
}

export function focusAddBox() { if (input) { input.focus(); input.select(); } }

function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); items = []; active = -1; }

function draw() {
  list.replaceChildren(...items.map((it, i) => el('li', {
    class: `ac-item${i === active ? ' on' : ''}`, role: 'option', id: `add-opt-${i}`, 'aria-selected': String(i === active),
    on: { mousedown: (e) => { e.preventDefault(); choose(it); } },
  }, el('span', { text: it.label }), it.label !== it.name ? el('span', { class: 'ac-alt', lang: 'en', text: it.name }) : null)));
  list.hidden = !items.length;
  input.setAttribute('aria-expanded', String(!list.hidden));
  if (active >= 0) input.setAttribute('aria-activedescendant', `add-opt-${active}`); else input.removeAttribute('aria-activedescendant');
}

async function choose(it) {
  if (busy || !state.deck) return;
  close();
  busy = true;
  input.disabled = true;
  box.classList.add('busy');
  const zone = zoneSel.value;
  const item = { qty: 1, name: it.name, zone, set: null, cn: null, pile: null };
  try {
    const wantFr = state.settings.imageLang === 'fr' || state.settings.nameLang === 'fr';
    const res = await api.scryfall.resolve([{ name: it.name }], { wantFr });
    const resolved = new Map(res.resolved);
    const card = resolved.get(itemKey(item));
    if (!card) { toast(`Carte introuvable : « ${it.label} ». Vérifie l'orthographe.`, { kind: 'error' }); return; }
    const already = state.deck.entries.some((e) => e.oracleId === card.oracleId && (e.zone === 'main' || e.zone === 'commander'));
    mutate((d) => applyImport(d, [item], resolved, [], 'add', itemKey), { relink: true, reason: 'add' });
    input.value = '';
    select(card.oracleId);
    toast(already && zone === 'main' ? `Un exemplaire de plus de « ${it.label} » (format singleton : à vérifier).` : `« ${it.label} » ajoutée (${ZONE_LABELS[zone]}).`, { kind: already && zone === 'main' ? 'warn' : 'ok', action: { label: 'Annuler', fn: undo } });
  } catch (e) {
    toast(`Ajout impossible : ${e.message}`, { kind: 'error' });
  } finally {
    busy = false;
    input.disabled = false;
    box.classList.remove('busy');
    requestAnimationFrame(() => requestAnimationFrame(() => input.focus()));
  }
}
