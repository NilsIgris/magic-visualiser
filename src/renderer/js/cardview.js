// Rendu des cartes : URL d'images (via le cache local), symboles de mana, texte Oracle.
import { el } from './ui.js';
import { state } from './store.js';
import { preferredImages, displayName } from '../../shared/normalize.js';

export function proxied(url) { return url ? `mtgimg://img/?u=${encodeURIComponent(url)}` : null; }

export function cardImage(card, { face = 0, size = 'normal', lang } = {}) {
  const imgs = preferredImages(card, lang || state.settings.imageLang);
  if (!imgs || !imgs.length) return null;
  const f = imgs[Math.min(face, imgs.length - 1)];
  if (!f) return null;
  return proxied(f[size] || f.normal || f.large || f.small);
}

export function faceCount(card) {
  const imgs = preferredImages(card, state.settings.imageLang);
  return imgs ? imgs.length : 1;
}

export function nameOf(card) { return displayName(card, state.settings.nameLang); }

/** Image de carte avec repli lisible si l'image ne charge pas (hors ligne). */
export function cardImgEl(card, { face = 0, size = 'normal', className = 'card-img', loading = 'lazy' } = {}) {
  const src = cardImage(card, { face, size });
  const fallback = () => el('div', { class: `${className} card-fallback` },
    el('span', { class: 'cf-name', text: nameOf(card) }),
    el('span', { class: 'cf-type', text: card.typeLine || '' }),
    card.manaCost ? el('span', { class: 'cf-cost' }, manaCost(card.manaCost)) : null);
  if (!src) return fallback();
  const img = el('img', { class: className, src, alt: nameOf(card), loading, draggable: 'false', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

const COLOR_CLASS = { W: 'w', U: 'u', B: 'b', R: 'r', G: 'g', C: 'c' };

function symbolEl(sym) {
  const svg = state.symbols[`{${sym}}`];
  if (svg) return el('img', { class: 'mana-sym', src: proxied(svg), alt: `{${sym}}`, title: `{${sym}}`, draggable: 'false' });
  const first = sym.split('/')[0];
  return el('span', { class: `mana-pip mana-${COLOR_CLASS[first] || 'n'}`, title: `{${sym}}` }, sym.replace('/', ''));
}

export function manaCost(cost) {
  const out = [];
  const parts = String(cost || '').split(' // ');
  parts.forEach((part, i) => {
    if (i) out.push(el('span', { class: 'mana-sep', text: '//' }));
    for (const m of part.matchAll(/\{([^}]+)\}/g)) out.push(symbolEl(m[1]));
  });
  return el('span', { class: 'mana-cost' }, out);
}

/** Texte de règles avec symboles ; les rappels entre parenthèses sont atténués. */
export function oracleText(text) {
  const box = el('div', { class: 'oracle' });
  for (const para of String(text || '').split('\n')) {
    if (!para.trim()) continue;
    const p = el('p');
    const tokens = para.split(/(\{[^}]+\}|\([^)]*\))/g);
    for (const t of tokens) {
      if (!t) continue;
      const sm = t.match(/^\{([^}]+)\}$/);
      if (sm) p.append(symbolEl(sm[1]));
      else if (/^\(.*\)$/.test(t)) {
        const r = el('span', { class: 'reminder' });
        for (const t2 of t.split(/(\{[^}]+\})/g)) { const s2 = t2.match(/^\{([^}]+)\}$/); r.append(s2 ? symbolEl(s2[1]) : document.createTextNode(t2)); }
        p.append(r);
      } else p.append(document.createTextNode(t));
    }
    box.append(p);
  }
  return box;
}

export function colorPips(colors) {
  const cs = colors && colors.length ? colors : ['C'];
  return el('span', { class: 'color-pips' }, cs.map((c) => el('span', { class: `pip pip-${COLOR_CLASS[c] || 'c'}`, title: c })));
}
