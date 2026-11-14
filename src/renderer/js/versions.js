// Versions d'un deck (instantanés nommés) et comparaison entre versions ou entre decks.
import { el, modal, toast, confirmDialog, promptDialog, icon, clear, formatDate } from './ui.js';
import { state, mutate, saveNow } from './store.js';
import { ZONE_LABELS } from './deckops.js';
import { diffDecks } from '../../shared/diff.js';
import { displayName } from '../../shared/normalize.js';

const api = window.mtg;

/** Instantané automatique (avant une opération qui remplace le contenu). */
export async function autoVersion(label) {
  if (!state.deck || !state.deck.entries.length) return;
  try { await api.versions.save(state.deck.id, { name: label, deck: state.deck, auto: true }); } catch { /* non bloquant */ }
}

export async function saveVersionFlow() {
  const d = new Date();
  const name = await promptDialog({ title: 'Enregistrer une version', label: 'Nom de la version', value: `Version du ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`, confirmLabel: 'Enregistrer' });
  if (!name) return null;
  await saveNow();
  const v = await api.versions.save(state.deck.id, { name, deck: state.deck });
  toast(`Version « ${v.name} » enregistrée.`, { kind: 'ok' });
  return v;
}

export async function openVersions() {
  const deck = state.deck;
  if (!deck) return;
  const list = el('div', { class: 'ver-list', 'aria-live': 'polite' }, el('p', { class: 'muted', text: 'Chargement…' }));
  const refresh = async () => {
    const vs = await api.versions.list(deck.id);
    clear(list);
    if (!vs.length) { list.append(el('p', { class: 'muted', text: 'Aucune version enregistrée. Une version garde l\'état complet du deck (cartes, liens, piles, notes) pour y revenir ou comparer plus tard.' })); return; }
    for (const v of vs) {
      list.append(el('div', { class: 'ver-row' },
        el('div', { class: 'ver-main' }, el('strong', { text: v.name }), el('span', { class: 'muted small', text: `${formatDate(v.createdAt)}, ${v.count} cartes${v.auto ? ', automatique' : ''}` })),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => { m.close(); openCompare({ a: `v:${v.vid}`, b: 'current' }); } } }, 'Comparer'),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: async () => {
          const ok = await confirmDialog({ title: 'Restaurer cette version', message: `Le deck reprendra l'état de « ${v.name} ». L'état actuel est d'abord enregistré comme version automatique, et Ctrl+Z annule la restauration.`, confirmLabel: 'Restaurer' });
          if (!ok) return;
          const full = await api.versions.load(deck.id, v.vid);
          await autoVersion('Avant restauration (auto)');
          mutate((d) => {
            for (const k of ['entries', 'cards', 'links', 'piles', 'notes', 'cardNotes', 'cardRoles', 'unresolved']) d[k] = JSON.parse(JSON.stringify(full.deck[k] ?? (Array.isArray(d[k]) ? [] : k === 'notes' ? '' : {})));
          }, { relink: true, reason: 'restore' });
          m.close();
          toast(`Version « ${v.name} » restaurée.`, { kind: 'ok', action: { label: 'Annuler', fn: () => import('./store.js').then((s) => s.undo()) } });
        } } }, 'Restaurer'),
        el('button', { class: 'icon-btn danger', type: 'button', title: 'Supprimer cette version', 'aria-label': `Supprimer ${v.name}`, on: { click: async () => {
          const ok = await confirmDialog({ title: 'Supprimer la version', message: `« ${v.name} » sera supprimée définitivement.`, confirmLabel: 'Supprimer', danger: true });
          if (ok) { await api.versions.remove(deck.id, v.vid); refresh(); }
        } } }, icon('trash'))));
    }
  };
  const m = modal({
    title: `Versions de « ${deck.name} »`, width: 640, body: list,
    actions: [
      { label: 'Comparer…', kind: 'ghost', onClick: () => { openCompare({}); } },
      { label: 'Enregistrer l\'état actuel…', kind: 'primary', onClick: async () => { await saveVersionFlow(); refresh(); return false; } },
    ],
  });
  refresh().catch((e) => { clear(list).append(el('p', { class: 'ko', text: e.message })); });
}

/** Comparaison : a et b = 'current' | 'v:<vid>' | 'd:<deckId>'. */
export async function openCompare({ a = null, b = 'current' } = {}) {
  const deck = state.deck;
  if (!deck) return;
  const versions = await api.versions.list(deck.id);
  const others = state.decks.filter((d) => d.id !== deck.id);
  const options = [['current', `État actuel de « ${deck.name} »`], ...versions.map((v) => [`v:${v.vid}`, `Version : ${v.name}`]), ...others.map((d) => [`d:${d.id}`, `Autre deck : ${d.name}`])];
  if (!a) a = options[1] ? options[1][0] : 'current';
  const selA = el('select', { class: 'select select-wide', 'aria-label': 'Référence' }, options.map(([v, l]) => el('option', { value: v, selected: v === a }, l)));
  const selB = el('select', { class: 'select select-wide', 'aria-label': 'Comparée' }, options.map(([v, l]) => el('option', { value: v, selected: v === b }, l)));
  const out = el('div', { class: 'diff', 'aria-live': 'polite' });
  let lastText = '';
  const load = async (key) => {
    if (key === 'current') return { entries: deck.entries, cards: deck.cards };
    if (key.startsWith('v:')) return (await api.versions.load(deck.id, key.slice(2))).deck;
    return api.decks.load(key.slice(2));
  };
  const lang = state.settings.nameLang;
  const run = async () => {
    clear(out).append(el('p', { class: 'muted', text: 'Comparaison…' }));
    try {
      const [da, db] = await Promise.all([load(selA.value), load(selB.value)]);
      const d = diffDecks(da, db);
      const nm = (r) => displayName((db.cards || {})[r.oracleId] || (da.cards || {})[r.oracleId], lang) || r.name;
      const col = (title, rows, fmt, cls) => el('section', { class: `diff-col ${cls}` }, el('h3', { text: `${title} (${rows.reduce((s, r) => s + r.qty, 0)})` }),
        rows.length ? el('ul', {}, rows.map((r) => el('li', { text: fmt(r) }))) : el('p', { class: 'muted small', text: 'Aucune.' }));
      clear(out).append(el('p', { class: 'muted small', text: `${d.same} carte${d.same > 1 ? 's' : ''} identique${d.same > 1 ? 's' : ''} des deux côtés.` }),
        el('div', { class: 'diff-cols' },
          col('Ajoutées', d.added, (r) => `${r.qty} ${nm(r)}${r.zone !== 'main' ? ` (${ZONE_LABELS[r.zone]})` : ''}`, 'add'),
          col('Retirées', d.removed, (r) => `${r.qty} ${nm(r)}${r.zone !== 'main' ? ` (${ZONE_LABELS[r.zone]})` : ''}`, 'rem'),
          col('Déplacées', d.moved, (r) => `${r.qty} ${nm(r)} : ${ZONE_LABELS[r.from]} → ${ZONE_LABELS[r.to]}`, 'mov')));
      lastText = [
        `+ Ajoutées`, ...d.added.map((r) => `${r.qty} ${nm(r)}${r.zone !== 'main' ? ` (${ZONE_LABELS[r.zone]})` : ''}`),
        '', `- Retirées`, ...d.removed.map((r) => `${r.qty} ${nm(r)}${r.zone !== 'main' ? ` (${ZONE_LABELS[r.zone]})` : ''}`),
        '', `~ Déplacées`, ...d.moved.map((r) => `${r.qty} ${nm(r)} : ${ZONE_LABELS[r.from]} → ${ZONE_LABELS[r.to]}`),
      ].join('\n');
    } catch (e) { clear(out).append(el('p', { class: 'ko', text: `Comparaison impossible : ${e.message}` })); }
  };
  selA.addEventListener('change', run); selB.addEventListener('change', run);
  modal({
    title: 'Comparer', width: 'min(900px, 94vw)',
    body: el('div', {}, el('div', { class: 'cmp-pick' },
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Référence' }), selA),
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Comparée à' }), selB)), out),
    actions: [
      { label: 'Copier le résultat', kind: 'ghost', onClick: async () => { await navigator.clipboard.writeText(lastText); toast('Différences copiées.', { kind: 'ok' }); return false; } },
      { label: 'Fermer', kind: 'primary' },
    ],
  });
  run();
}
