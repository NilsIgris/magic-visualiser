// Import de listes de cartes et correction des noms non trouvés.
import { el, modal, icon, toast, clear, debounce } from './ui.js';
import { state, mutate } from './store.js';
import { parseDeckText, normalizeName } from '../../shared/parser.js';
import { applyImport, ZONE_LABELS } from './deckops.js';
import { autoVersion } from './versions.js';

const api = window.mtg;

const FORMAT_LABEL = { simple: 'Liste simple', arena: 'Export Arena / MTGO', csv: 'Tableau CSV' };

export function itemKey(it) { return `${normalizeName(it.name)}|${(it.set || '').toLowerCase()}|${it.cn || ''}`; }

const PLACEHOLDER = `Commander
1 Ghave, Guru of Spores

Deck
1 Sol Ring (C21) 263
1 Artiste sanguinaire
1 Soul Warden
10 Forest`;

export function openImporter({ text = '' } = {}) {
  const deck = state.deck;
  if (!deck) return;
  let parsed = { items: [], ignored: [], format: 'simple' };
  let mode = 'add';
  const ta = el('textarea', { class: 'input import-text', rows: '16', spellcheck: 'false', placeholder: PLACEHOLDER, 'aria-label': 'Liste de cartes' });
  ta.value = text;
  const fileBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: async () => {
    try { const f = await api.files.openText(); if (f) { ta.value = f.content; update(); toast(`${f.name} chargé.`); } } catch (e) { toast(e.message, { kind: 'error' }); }
  } } }, icon('folder', 16), 'Ouvrir un fichier…');
  const hasCards = deck.entries.length > 0;
  const modeBox = hasCards ? el('div', { class: 'radio-row', role: 'radiogroup', 'aria-label': 'Mode d\'import' },
    [['add', 'Ajouter au deck'], ['replace', 'Remplacer le contenu du deck']].map(([k, l]) => el('label', { class: 'radio' },
      el('input', { type: 'radio', name: 'imode', value: k, checked: k === mode, on: { change: () => { mode = k; } } }), el('span', { text: l })))) : null;
  const preview = el('div', { class: 'import-preview', 'aria-live': 'polite' });
  const left = el('div', { class: 'import-left' },
    el('div', { class: 'import-left-head' }, el('span', { class: 'field-label', text: 'Colle ta liste' }), fileBtn),
    ta,
    el('p', { class: 'muted small', text: 'Formats acceptés : « 4 Nom », « 4x Nom », export Arena/MTGO avec édition, tableau CSV (colonnes Quantity, Name, Set…). Noms en anglais ou en français.' }),
    modeBox);
  const body = el('div', { class: 'import-grid' }, left, preview);
  let importBtn;
  const m = modal({
    title: 'Importer des cartes', body, width: 'min(980px, 94vw)', className: 'modal-import',
    actions: [
      { label: 'Annuler', kind: 'ghost' },
      { id: 'go', label: 'Importer', kind: 'primary', onClick: () => { run(); return false; } },
    ],
  });
  importBtn = m.footer.querySelector('[data-action="go"]');

  const update = () => {
    parsed = parseDeckText(ta.value, { format: deck.format });
    renderPreview();
  };
  const renderPreview = () => {
    clear(preview);
    const total = parsed.items.reduce((s, i) => s + i.qty, 0);
    importBtn.disabled = !parsed.items.length;
    importBtn.textContent = parsed.items.length ? `Importer ${total} carte${total > 1 ? 's' : ''}` : 'Importer';
    if (!parsed.items.length) {
      preview.append(el('div', { class: 'preview-empty' }, el('p', { text: 'L\'aperçu de ta liste apparaîtra ici.' }), el('p', { class: 'muted small', text: 'Astuce : un bloc de 1 ou 2 cartes séparé par une ligne vide à la fin de la liste est pris comme commandant.' })));
      return;
    }
    const byZone = {};
    for (const it of parsed.items) byZone[it.zone] = (byZone[it.zone] || 0) + it.qty;
    preview.append(el('div', { class: 'preview-head' },
      el('span', { class: 'tag', text: FORMAT_LABEL[parsed.format] || parsed.format }),
      el('span', { class: 'preview-sum', text: Object.entries(byZone).map(([z, n]) => `${ZONE_LABELS[z]} : ${n}`).join(', ') })));
    const list = el('div', { class: 'preview-list', role: 'table', 'aria-label': 'Cartes détectées' });
    for (const it of parsed.items) {
      const zoneSel = el('select', { class: 'select select-xs', 'aria-label': `Zone de ${it.name}`, on: { change: (e) => { it.zone = e.target.value; it._zoneForced = true; renderPreview(); } } },
        Object.entries(ZONE_LABELS).map(([z, l]) => el('option', { value: z, selected: it.zone === z }, l)));
      list.append(el('div', { class: 'preview-row', role: 'row' },
        el('span', { class: 'p-qty', role: 'cell', text: String(it.qty) }),
        el('span', { class: 'p-name', role: 'cell', text: it.name }),
        el('span', { class: 'p-set', role: 'cell', text: it.set ? `${it.set.toUpperCase()}${it.cn ? ` ${it.cn}` : ''}` : '' }),
        el('span', { class: 'p-zone', role: 'cell' }, zoneSel)));
    }
    preview.append(list);
    if (parsed.ignored.length) {
      preview.append(el('details', { class: 'ignored' },
        el('summary', { text: `${parsed.ignored.length} ligne${parsed.ignored.length > 1 ? 's' : ''} ignorée${parsed.ignored.length > 1 ? 's' : ''}` }),
        el('ul', {}, parsed.ignored.map((g) => el('li', { text: `Ligne ${g.line} : ${g.text.trim()}` })))));
    }
  };
  // conserver les zones modifiées à la main quand le texte change
  const onInput = debounce(() => {
    const forced = new Map(parsed.items.filter((i) => i._zoneForced).map((i) => [`${normalizeName(i.name)}|${i.line}`, i.zone]));
    update();
    for (const it of parsed.items) { const z = forced.get(`${normalizeName(it.name)}|${it.line}`); if (z) { it.zone = z; it._zoneForced = true; } }
    renderPreview();
  }, 200);
  ta.addEventListener('input', onInput);
  update();

  const run = async () => {
    if (!parsed.items.length) return;
    const items = parsed.items.map((i) => ({ ...i }));
    const progress = el('div', { class: 'progress' }, el('div', { class: 'progress-bar' }));
    const label = el('p', { class: 'progress-label', text: 'Connexion à Scryfall…' });
    m.root.querySelector('.modal-body').replaceChildren(el('div', { class: 'import-run' }, el('h3', { text: `Recherche de ${items.length} carte${items.length > 1 ? 's' : ''}` }), progress, label,
      el('p', { class: 'muted small', text: 'Les données viennent de Scryfall. Les cartes déjà recherchées sont reprises du cache local.' })));
    m.footer.hidden = true;
    const off = api.scryfall.onProgress((p) => {
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      progress.firstChild.style.width = `${pct}%`;
      label.textContent = p.total ? `${p.label} (${p.done}/${p.total})` : p.label;
    });
    try {
      const wantFr = state.settings.imageLang === 'fr' || state.settings.nameLang === 'fr';
      const res = await api.scryfall.resolve(items.map(({ name, set, cn, sid }) => ({ name, set, cn, sid })), { wantFr });
      off();
      if (mode === 'replace') await autoVersion('Avant remplacement du contenu (auto)');
      const resolved = new Map(res.resolved);
      let added = 0;
      for (const it of items) if (resolved.has(itemKey(it))) added += it.qty;
      mutate((d) => applyImport(d, items, resolved, res.unresolved, mode, itemKey), { relink: true, reason: 'import' });
      const pend = state.deck.links.filter((l) => l.status === 'pending').length;
      m.close('done');
      const missing = items.filter((it) => res.unresolved.includes(itemKey(it)));
      if (missing.length) {
        toast(`${added} carte${added > 1 ? 's' : ''} importée${added > 1 ? 's' : ''}, ${missing.length} nom${missing.length > 1 ? 's' : ''} non trouvé${missing.length > 1 ? 's' : ''}.`, { kind: 'warn', action: { label: 'Corriger', fn: openFixUnresolved }, timeout: 9000 });
        openFixUnresolved();
      } else {
        toast(`${added} carte${added > 1 ? 's' : ''} importée${added > 1 ? 's' : ''}. ${pend} suggestion${pend > 1 ? 's' : ''} de liens à valider.`, { kind: 'ok', timeout: 6000 });
      }
    } catch (e) {
      off();
      m.footer.hidden = false;
      m.root.querySelector('.modal-body').replaceChildren(body);
      toast(`Import interrompu : ${e.message}`, { kind: 'error' });
    }
  };
}

/** Correction des noms non trouvés. */
export function openFixUnresolved() {
  const deck = state.deck;
  if (!deck || !deck.unresolved.length) return;
  const rows = deck.unresolved.map((u, i) => {
    const dl = el('datalist', { id: `ac-${i}` });
    const input = el('input', { class: 'input', type: 'text', value: u.name, list: `ac-${i}`, spellcheck: 'false', 'aria-label': `Nom corrigé pour ${u.name}` });
    const ac = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) return;
      try { const names = await api.scryfall.autocomplete(q); dl.replaceChildren(...names.map((n) => el('option', { value: n }))); } catch { /* hors ligne */ }
    }, 250);
    input.addEventListener('input', ac);
    const skip = el('input', { type: 'checkbox', 'aria-label': `Ignorer ${u.name}` });
    return { u, input, skip, node: el('div', { class: 'fix-row' }, el('span', { class: 'p-qty', text: String(u.qty) }), el('div', { class: 'fix-input' }, input, dl), el('span', { class: 'fix-zone', text: ZONE_LABELS[u.zone] || '' }), el('label', { class: 'fix-skip' }, skip, el('span', { text: 'Retirer' }))) };
  });
  const status = el('p', { class: 'muted small', 'aria-live': 'polite' });
  const body = el('div', { class: 'fix' },
    el('p', { text: 'Ces noms n\'ont pas été reconnus. Corrige-les (les suggestions viennent des noms anglais de Scryfall ; un nom français exact fonctionne aussi), puis relance la recherche.' }),
    el('div', { class: 'fix-list' }, rows.map((r) => r.node)), status);
  const m = modal({
    title: 'Cartes non trouvées', body, width: 640,
    actions: [
      { label: 'Plus tard', kind: 'ghost' },
      { label: 'Relancer la recherche', kind: 'primary', onClick: async () => {
        const btns = m.footer.querySelectorAll('button'); btns.forEach((b) => { b.disabled = true; });
        status.textContent = 'Recherche en cours…';
        const toRemove = rows.filter((r) => r.skip.checked).map((r) => r.u);
        const todo = rows.filter((r) => !r.skip.checked).map((r) => ({ ...r.u, name: r.input.value.trim() || r.u.name, set: null, cn: null, _orig: r.u }));
        try {
          const wantFr = state.settings.imageLang === 'fr' || state.settings.nameLang === 'fr';
          const res = todo.length ? await api.scryfall.resolve(todo.map(({ name }) => ({ name })), { wantFr }) : { resolved: [], unresolved: [] };
          const resolved = new Map(res.resolved);
          const found = todo.filter((t) => resolved.has(itemKey(t)));
          mutate((d) => {
            const drop = new Set([...toRemove, ...found.map((t) => t._orig)].map((u) => `${u.name}|${u.zone}`));
            d.unresolved = d.unresolved.filter((u) => !drop.has(`${u.name}|${u.zone}`));
            // conserver le nom corrigé pour les cartes toujours introuvables
            for (const t of todo) if (!resolved.has(itemKey(t))) { const u = d.unresolved.find((x) => x.name === t._orig.name && x.zone === t._orig.zone); if (u) u.name = t.name; }
            applyImport(d, found, resolved, [], 'add', itemKey);
          }, { relink: true, reason: 'import' });
          const left = state.deck.unresolved.length;
          m.close('done');
          toast(left ? `${found.length} carte(s) ajoutée(s), ${left} toujours introuvable(s).` : `${found.length} carte(s) ajoutée(s).`, { kind: left ? 'warn' : 'ok' });
        } catch (e) {
          status.textContent = `Recherche impossible : ${e.message}`;
          btns.forEach((b) => { b.disabled = false; });
        }
        return false;
      } },
    ],
  });
}
