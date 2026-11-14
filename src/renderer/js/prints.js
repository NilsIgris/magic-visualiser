// Choix de l'impression d'une carte (édition, illustration, langue).
import { el, modal, toast, clear } from './ui.js';
import { state, mutate } from './store.js';
import { proxied, nameOf } from './cardview.js';

const api = window.mtg;

export async function openPrints(oracleId) {
  const card = state.deck && state.deck.cards[oracleId];
  if (!card) return;
  let filter = 'all';
  let prints = [];
  const grid = el('div', { class: 'print-grid', 'aria-live': 'polite' }, el('p', { class: 'muted', text: 'Recherche des impressions sur Scryfall…' }));
  const chips = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Langue' });
  const drawChips = () => {
    const nFr = prints.filter((p) => p.lang === 'fr').length;
    chips.replaceChildren(el('span', { class: 'seg-label', text: 'Langue' }), ...[['all', `Toutes (${prints.length})`], ['fr', `Français (${nFr})`], ['en', `Anglais (${prints.length - nFr})`]].map(([k, l]) => el('button', {
      class: `seg-btn${filter === k ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(filter === k),
      on: { click: () => { filter = k; drawChips(); drawGrid(); } },
    }, l)));
  };
  const currentId = card.chosenPrint ? card.chosenPrint.id : null;
  const drawGrid = () => {
    clear(grid);
    const shown = prints.filter((p) => filter === 'all' || p.lang === filter);
    if (!shown.length) { grid.append(el('p', { class: 'muted', text: 'Aucune impression dans cette langue.' })); return; }
    for (const p of shown) {
      const f = p.images[0];
      const img = el('img', { src: proxied(f.small || f.normal), alt: '', loading: 'lazy', draggable: 'false' });
      grid.append(el('button', {
        class: `print-opt${p.id === currentId ? ' on' : ''}`, type: 'button', title: `${p.setName} (${p.set.toUpperCase()}) n° ${p.cn}`,
        on: { click: () => { choose(p); m.close('action'); } },
      }, img,
      el('span', { class: 'print-cap' },
        el('span', { class: `lang-badge lang-${p.lang}`, text: p.lang === 'fr' ? 'VF' : 'VO' }),
        el('span', { class: 'print-set', text: p.setName }),
        el('span', { class: 'print-meta', text: `${p.set.toUpperCase()} ${p.cn}${p.released ? `, ${p.released.slice(0, 4)}` : ''}` }))));
    }
  };
  const choose = (p) => {
    mutate((d) => {
      const c = d.cards[oracleId];
      const orig = c.chosenPrint ? c.chosenPrint.orig : { set: c.set, setName: c.setName, cn: c.collectorNumber };
      c.chosenPrint = { id: p.id, lang: p.lang, set: p.set, setName: p.setName, cn: p.cn, printedName: p.printedName, images: p.images, orig };
      c.set = p.set; c.setName = p.setName; c.collectorNumber = p.cn;
    }, { reason: 'print' });
    toast(`Impression choisie : ${p.setName} (${p.lang === 'fr' ? 'VF' : 'VO'}).`, { kind: 'ok' });
  };
  const reset = () => {
    mutate((d) => {
      const c = d.cards[oracleId];
      if (c.chosenPrint && c.chosenPrint.orig) { c.set = c.chosenPrint.orig.set; c.setName = c.chosenPrint.orig.setName; c.collectorNumber = c.chosenPrint.orig.cn; }
      delete c.chosenPrint;
    }, { reason: 'print' });
  };
  const m = modal({
    title: `Impressions de « ${nameOf(card)} »`, width: 'min(940px, 94vw)', className: 'modal-prints',
    body: el('div', { class: 'prints' }, el('p', { class: 'muted small', text: 'L\'impression choisie remplace le visuel automatique (réglage de langue) pour cette carte, et sert pour l\'export Arena.' }), chips, grid),
    actions: [
      card.chosenPrint ? { label: 'Revenir au visuel automatique', kind: 'ghost', onClick: reset } : null,
      { label: 'Fermer', kind: 'primary' },
    ].filter(Boolean),
  });
  try {
    prints = await api.scryfall.prints({ oracleId, printsUri: card.printsUri || null });
    prints.sort((a, b) => String(b.released).localeCompare(String(a.released)) || (a.lang === 'fr' ? -1 : 1));
    drawChips(); drawGrid();
  } catch (e) {
    clear(grid).append(el('p', { class: 'ko', text: `Impossible de charger les impressions : ${e.message}` }));
  }
}
