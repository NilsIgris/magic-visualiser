// Création / modification d'un lien entre deux cartes.
import { el, modal, icon, toast } from './ui.js';
import { state } from './store.js';
import { LINK_KINDS, mainType, TYPE_ORDER } from './deckops.js';
import { nameOf, cardImgEl } from './cardview.js';
import { addManualLink, updateLink, deleteLink, setLinkStatus } from './actions.js';
import { describeLink } from './reasons.js';

export const KIND_HELP = {
  trigger: 'A provoque le déclenchement d\'une capacité de B.',
  enable: 'A fournit à B une ressource ou une condition (sacrifice, cimetière, marqueurs…).',
  amplify: 'B multiplie ce que produit A (doubleurs de jetons, de marqueurs, de déclencheurs).',
  tribal: 'A a un type de créature que B favorise.',
  synergy: 'A et B fonctionnent mieux ensemble.',
  combo: 'A et B forment une combinaison gagnante ou une boucle.',
  protect: 'A protège B (bouclier, indestructible, contre-sort…).',
  tutor: 'A va chercher B dans la bibliothèque.',
  anti: 'A gêne B : à surveiller.',
};

function cardSelect(value, label) {
  const deck = state.deck;
  const ids = [...new Set(deck.entries.filter((e) => e.zone !== 'side').map((e) => e.oracleId))].filter((id) => deck.cards[id]);
  const sel = el('select', { class: 'select select-wide', 'aria-label': label });
  for (const [t, tl] of TYPE_ORDER) {
    const group = ids.filter((id) => (t === 'commander' ? deck.entries.some((e) => e.oracleId === id && e.zone === 'commander') : mainType(deck.cards[id]) === t && !deck.entries.some((e) => e.oracleId === id && e.zone === 'commander')));
    if (!group.length) continue;
    sel.append(el('optgroup', { label: tl }, group.sort((a, b) => nameOf(deck.cards[a]).localeCompare(nameOf(deck.cards[b]), 'fr')).map((id) => el('option', { value: id, selected: id === value }, nameOf(deck.cards[id])))));
  }
  if (!value) sel.selectedIndex = -1;
  return sel;
}

export function openLinkDialog({ from = null, to = null, edit = null } = {}) {
  const deck = state.deck;
  if (!deck) return;
  const existing = edit ? deck.links.find((l) => l.id === edit) : null;
  if (existing) { from = existing.from; to = existing.to; }
  let kind = existing ? existing.kind : 'synergy';

  const fromSel = cardSelect(from, 'Carte qui agit');
  const toSel = cardSelect(to, 'Carte qui réagit');
  const preview = el('div', { class: 'ld-preview' });
  const drawPreview = () => {
    preview.replaceChildren(
      fromSel.value ? cardImgEl(deck.cards[fromSel.value], { size: 'small', className: 'ld-img' }) : el('div', { class: 'ld-img ld-empty' }),
      el('span', { class: 'ld-arrow', style: { color: LINK_KINDS[kind].color } }, '→'),
      toSel.value ? cardImgEl(deck.cards[toSel.value], { size: 'small', className: 'ld-img' }) : el('div', { class: 'ld-img ld-empty' }));
  };
  fromSel.addEventListener('change', drawPreview);
  toSel.addEventListener('change', drawPreview);
  const swap = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => { const a = fromSel.value; fromSel.value = toSel.value; toSel.value = a; drawPreview(); } } }, icon('flip', 16), 'Inverser');
  const help = el('p', { class: 'ld-help', text: KIND_HELP[kind] });
  const kinds = el('div', { class: 'kind-picker', role: 'radiogroup', 'aria-label': 'Type de lien' },
    Object.entries(LINK_KINDS).map(([k, v]) => el('button', {
      class: `kind-opt${k === kind ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(k === kind), style: { '--k': v.color },
      on: { click: (e) => { kind = k; for (const b of kinds.children) { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-checked', String(b === e.currentTarget)); } help.textContent = KIND_HELP[k]; drawPreview(); } },
    }, el('span', { class: 'kind-dot' }), v.label)));
  const note = el('textarea', { class: 'input', rows: '3', placeholder: 'Note facultative : comment ces cartes interagissent, dans quel ordre les jouer…' });
  note.value = existing ? existing.note || '' : '';
  drawPreview();

  const body = el('div', { class: 'ld' },
    preview,
    el('div', { class: 'ld-grid' },
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Carte qui agit (A)' }), fromSel),
      swap,
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Carte qui réagit (B)' }), toSel)),
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Type de lien' }), kinds, help),
    existing && existing.origin !== 'manual' ? el('p', { class: 'ld-auto', text: `Suggestion automatique : ${describeLink(existing, deck, state.settings.nameLang)}` }) : null,
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Note' }), note));

  const save = () => {
    const f = fromSel.value; const t = toSel.value;
    if (!f || !t) { toast('Choisis les deux cartes.', { kind: 'error' }); return false; }
    if (f === t) { toast('Choisis deux cartes différentes.', { kind: 'error' }); return false; }
    if (!existing) { addManualLink({ from: f, to: t, kind, note: note.value.trim() }); toast('Lien créé.', { kind: 'ok' }); return true; }
    const changedShape = f !== existing.from || t !== existing.to || kind !== existing.kind;
    if (existing.origin !== 'manual' && changedShape) {
      // une suggestion modifiée devient un lien manuel ; la suggestion d'origine est rejetée pour ne pas réapparaître
      setLinkStatus(existing.id, 'rejected');
      addManualLink({ from: f, to: t, kind, note: note.value.trim() });
    } else updateLink(existing.id, { from: f, to: t, kind, note: note.value.trim(), status: existing.origin === 'manual' ? 'accepted' : existing.status });
    return true;
  };
  const actions = [];
  if (existing && existing.origin === 'manual') actions.push({ label: 'Supprimer le lien', kind: 'danger-ghost', onClick: () => { deleteLink(existing.id); } });
  actions.push({ label: 'Annuler', kind: 'ghost' }, { label: existing ? 'Enregistrer' : 'Créer le lien', kind: 'primary', onClick: save });
  modal({ title: existing ? 'Modifier le lien' : 'Nouveau lien', body, actions, width: 620 });
}
