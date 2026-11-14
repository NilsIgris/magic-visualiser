// Aperçu agrandi d'une carte au survol.
import { state } from './store.js';
import { cardImage } from './cardview.js';

let timer = null;
let current = null;

export function attachHover(node, getCard) {
  node.addEventListener('mouseenter', (e) => {
    if (!state.settings.hoverPreview) return;
    clearTimeout(timer);
    const card = getCard();
    timer = setTimeout(() => show(card, e.clientX, e.clientY), 350);
  });
  node.addEventListener('mousemove', (e) => { if (current) position(e.clientX, e.clientY); });
  node.addEventListener('mouseleave', hide);
  node.addEventListener('mousedown', hide);
}

function show(card, x, y) {
  const box = document.getElementById('hover-preview');
  const src = card && cardImage(card, { size: 'large' });
  if (!src) return;
  let img = box.querySelector('img');
  if (!img) { img = document.createElement('img'); img.alt = ''; box.append(img); }
  img.src = src;
  box.hidden = false;
  current = card;
  position(x, y);
}

function position(x, y) {
  const box = document.getElementById('hover-preview');
  const w = 300; const h = 419;
  let left = x + 24;
  if (left + w > window.innerWidth - 8) left = x - w - 24;
  let top = y - h / 2;
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}

export function hide() {
  clearTimeout(timer);
  current = null;
  const box = document.getElementById('hover-preview');
  if (box) box.hidden = true;
}
