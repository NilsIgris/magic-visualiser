// Champ de recherche de carte avec autocomplétion (Scryfall pour les noms anglais, cache local pour les noms français).
import { el, icon, debounce } from './ui.js';

const api = window.mtg;
let uid = 0;

/**
 * @param {{placeholder: string, label: string, extra?: Node, onChoose: (name: string, label: string) => Promise<void>}} opts
 */
export function cardSearch({ placeholder, label, extra = null, onChoose }) {
  const id = `cs-${++uid}`;
  let items = []; let active = -1; let seq = 0; let busy = false;
  const input = el('input', { class: 'input add-input', type: 'text', placeholder, spellcheck: 'false', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list', 'aria-controls': id, 'aria-label': label });
  const list = el('ul', { class: 'ac-list', id, role: 'listbox', hidden: true });
  const box = el('div', { class: 'add-box' }, icon('plus', 16), input, extra, list);
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); items = []; active = -1; };
  const draw = () => {
    list.replaceChildren(...items.map((it, i) => el('li', {
      class: `ac-item${i === active ? ' on' : ''}`, role: 'option', id: `${id}-${i}`, 'aria-selected': String(i === active),
      on: { mousedown: (e) => { e.preventDefault(); choose(it); } },
    }, el('span', { text: it.label }), it.label !== it.name ? el('span', { class: 'ac-alt', lang: 'en', text: it.name }) : null)));
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!list.hidden));
    if (active >= 0) input.setAttribute('aria-activedescendant', `${id}-${active}`); else input.removeAttribute('aria-activedescendant');
  };
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
  const choose = async (it) => {
    if (busy) return;
    close();
    busy = true; input.disabled = true; box.classList.add('busy');
    try { await onChoose(it.name, it.label); input.value = ''; } finally {
      busy = false; input.disabled = false; box.classList.remove('busy');
      requestAnimationFrame(() => requestAnimationFrame(() => input.focus()));
    }
  };
  input.addEventListener('input', fetchSugg);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) { active = (active + 1) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && items.length) { active = (active - 1 + items.length) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); const v = input.value.trim(); if (v) choose(!list.hidden && items[active] ? items[active] : { name: v, label: v }); }
    else if (e.key === 'Escape') { if (!list.hidden) { close(); e.stopPropagation(); } else input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  return { box, input };
}
