// Petits outils d'interface : création d'éléments, fenêtres modales, notifications, menus.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) node.style.setProperty(sk, sv); else node.style[sk] = sv; }
    }
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(node, c);
    else node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** append() qui ignore null/undefined/false (Element.append les écrit en texte). */
export function add(node, ...children) { append(node, children); return node; }

export function clear(node) { while (node.firstChild) node.firstChild.remove(); return node; }

const overlayRoot = () => document.getElementById('overlay-root');
const openModals = [];

export function modal({ title, body, actions = [], width = 520, onClose, dismissable = true, className = '' }) {
  const prevFocus = document.activeElement;
  let closed = false;
  const close = (reason) => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    openModals.splice(openModals.indexOf(api), 1);
    document.removeEventListener('keydown', onKey, true);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    if (onClose) onClose(reason);
  };
  const footer = el('div', { class: 'modal-actions' },
    actions.map((a) => el('button', {
      class: `btn ${a.kind ? `btn-${a.kind}` : ''}`,
      type: 'button',
      disabled: a.disabled,
      dataset: { action: a.id || '' },
      on: { click: async () => { const r = a.onClick ? await a.onClick() : undefined; if (r !== false) close('action'); } },
    }, a.label)));
  const box = el('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { width: typeof width === 'number' ? `${width}px` : width } },
    el('div', { class: 'modal-head' },
      el('h2', { class: 'modal-title', text: title }),
      dismissable ? el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', title: 'Fermer (Échap)', on: { click: () => close('dismiss') } }, icon('x')) : null),
    el('div', { class: 'modal-body' }, body),
    actions.length ? footer : null);
  const backdrop = el('div', { class: 'modal-backdrop', on: { mousedown: (e) => { if (e.target === backdrop && dismissable) close('dismiss'); } } }, box);
  const onKey = (e) => {
    if (openModals[openModals.length - 1] !== api) return;
    if (e.key === 'Escape' && dismissable) { e.stopPropagation(); e.preventDefault(); close('dismiss'); }
    if (e.key === 'Tab') trapFocus(e, box);
  };
  document.addEventListener('keydown', onKey, true);
  overlayRoot().append(backdrop);
  const api = { close, root: box, footer };
  openModals.push(api);
  requestAnimationFrame(() => {
    const f = box.querySelector('[autofocus]') || box.querySelector('input, textarea, select') || box.querySelector('.btn-primary') || box.querySelector('button');
    if (f) f.focus();
  });
  return api;
}

export function anyModalOpen() { return openModals.length > 0; }

function trapFocus(e, box) {
  const f = [...box.querySelectorAll('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.offsetParent !== null);
  if (!f.length) return;
  const first = f[0]; const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
}

export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    let ok = false;
    modal({
      title, width: 440,
      body: el('p', { class: 'modal-text', text: message }),
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => { ok = true; } },
      ],
      onClose: () => resolve(ok),
    });
  });
}

export function promptDialog({ title, label, value = '', confirmLabel = 'Valider', placeholder = '' }) {
  return new Promise((resolve) => {
    let result = null;
    const input = el('input', { class: 'input', type: 'text', value, placeholder, autofocus: true, spellcheck: false });
    const submit = () => { const v = input.value.trim(); if (!v) { input.focus(); return false; } result = v; return true; };
    const m = modal({
      title, width: 440,
      body: el('label', { class: 'field' }, el('span', { class: 'field-label', text: label }), input),
      actions: [{ label: 'Annuler', kind: 'ghost' }, { label: confirmLabel, kind: 'primary', onClick: submit }],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (submit()) m.close('action'); } });
    requestAnimationFrame(() => input.select());
  });
}

export function toast(message, { kind = 'info', action = null, timeout = 4200 } = {}) {
  const root = document.getElementById('toast-root');
  const t = el('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    el('span', { class: 'toast-msg', text: message }),
    action ? el('button', { class: 'toast-action', type: 'button', on: { click: () => { action.fn(); t.remove(); } } }, action.label) : null);
  root.append(t);
  // au plus 3 notifications visibles : les plus anciennes laissent la place
  while (root.children.length > 3) root.firstElementChild.remove();
  const timer = setTimeout(() => t.remove(), kind === 'error' ? Math.max(timeout, 8000) : timeout);
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('mouseleave', () => setTimeout(() => t.remove(), 1800));
  return t;
}

let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }

/** Menu contextuel. items: [{label, onClick, danger, disabled, hint}] ou 'sep'. */
export function contextMenu(x, y, items) {
  closeMenu();
  const menu = el('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { menu.append(el('div', { class: 'menu-sep', role: 'separator' })); continue; }
    if (it.heading) { menu.append(el('div', { class: 'menu-heading', text: it.heading })); continue; }
    menu.append(el('button', {
      class: `menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}`, role: 'menuitem', type: 'button', disabled: it.disabled,
      on: { click: () => { closeMenu(); it.onClick && it.onClick(); } },
    }, el('span', { text: it.label }), it.hint ? el('span', { class: 'menu-hint', text: it.hint }) : null));
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`;
  openMenu = menu;
  const first = menu.querySelector('.menu-item:not([disabled])');
  if (first) first.focus();
  menu.addEventListener('keydown', (e) => {
    const items2 = [...menu.querySelectorAll('.menu-item:not([disabled])')];
    const i = items2.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { items2[(i + 1) % items2.length].focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { items2[(i - 1 + items2.length) % items2.length].focus(); e.preventDefault(); }
    if (e.key === 'Escape') { closeMenu(); e.preventDefault(); }
  });
  return menu;
}
document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

export function menuFromButton(btn, items) {
  const r = btn.getBoundingClientRect();
  return contextMenu(r.left, r.bottom + 6, items);
}

// Icônes (traits SVG, 20×20)
const ICONS = {
  x: 'M5 5l10 10M15 5L5 15',
  plus: 'M10 4v12M4 10h12',
  minus: 'M4 10h12',
  back: 'M12 4l-6 6 6 6',
  more: 'M5 10h.01M10 10h.01M15 10h.01',
  gear: 'M10 13a3 3 0 100-6 3 3 0 000 6zM10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4',
  check: 'M4 10.5l4 4 8-9',
  search: 'M9 15a6 6 0 100-12 6 6 0 000 12zM13.5 13.5L17 17',
  upload: 'M10 14V4M6 8l4-4 4 4M4 16h12',
  link: 'M8.5 11.5l3-3M7 9l-1.5 1.5a2.5 2.5 0 003.5 3.5L10.5 12.5M13 11l1.5-1.5A2.5 2.5 0 0011 6L9.5 7.5',
  crown: 'M3 15h14M4 15l-1-8 4.5 3L10 5l2.5 5L17 7l-1 8',
  flip: 'M4 8a6 6 0 0110.5-3M16 12a6 6 0 01-10.5 3M14 3v3h-3M6 17v-3h3',
  undo: 'M7 6L4 9l3 3M4 9h8a4 4 0 010 8H9',
  redo: 'M13 6l3 3-3 3M16 9H8a4 4 0 000 8h3',
  warn: 'M10 3l8 14H2L10 3zM10 8v4M10 14.5h.01',
  folder: 'M3 6h5l2 2h7v8H3z',
  external: 'M11 4h5v5M16 4l-7 7M14 12v4H4V6h4',
  fit: 'M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4',
  grip: 'M8 6h.01M12 6h.01M8 10h.01M12 10h.01M8 14h.01M12 14h.01',
  trash: 'M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10',
  copy: 'M7 7h9v9H7zM4 13V4h9',
  download: 'M10 4v10M6 10l4 4 4-4M4 16h12',
  dot: 'M10 10h.01',
};
export function icon(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.dot);
  p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', name === 'more' || name === 'grip' ? '2.6' : '1.6');
  p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); return fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `aujourd'hui à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
