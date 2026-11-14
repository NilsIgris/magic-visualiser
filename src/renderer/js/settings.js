// Réglages, diagnostic Scryfall, actualisation des données de cartes.
import { el, modal, toast, icon } from './ui.js';
import { state, setSetting, mutate } from './store.js';
import { itemKey } from './importer.js';

const api = window.mtg;

function fmtBytes(n) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

function radioGroup(name, value, options, onChange) {
  return el('div', { class: 'radio-row', role: 'radiogroup' }, options.map(([k, l]) => el('label', { class: 'radio' },
    el('input', { type: 'radio', name, value: k, checked: value === k, on: { change: () => onChange(k) } }), el('span', { text: l }))));
}

export function openSettings() {
  const s = state.settings;
  const cacheInfo = el('span', { class: 'muted', text: 'calcul…' });
  api.cache.info().then((c) => { cacheInfo.textContent = `${c.count} image${c.count > 1 ? 's' : ''}, ${fmtBytes(c.bytes)}`; }).catch(() => { cacheInfo.textContent = ''; });
  const diagOut = el('div', { class: 'diag', 'aria-live': 'polite' });
  const needFrRefresh = () => state.deck && Object.values(state.deck.cards).some((c) => !c.frChecked);

  const body = el('div', { class: 'settings' },
    el('section', { class: 'set-sec' },
      el('h3', { text: 'Langue' }),
      el('div', { class: 'set-row' }, el('span', { class: 'set-label', text: 'Visuels des cartes' }),
        radioGroup('imgLang', s.imageLang, [['fr', 'Français quand ils existent'], ['en', 'Anglais']], (v) => { setSetting({ imageLang: v }); if (v === 'fr' && needFrRefresh()) offerRefresh(); })),
      el('div', { class: 'set-row' }, el('span', { class: 'set-label', text: 'Noms affichés' }),
        radioGroup('nameLang', s.nameLang, [['fr', 'Français quand ils existent'], ['en', 'Anglais']], (v) => { setSetting({ nameLang: v }); if (v === 'fr' && needFrRefresh()) offerRefresh(); })),
      el('p', { class: 'muted small', text: 'Le texte de règles de référence (Oracle) reste en anglais : c\'est lui qui sert à l\'analyse des interactions.' })),
    el('section', { class: 'set-sec' },
      el('h3', { text: 'Affichage' }),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: s.hoverPreview, on: { change: (e) => setSetting({ hoverPreview: e.target.checked }) } }), el('span', { text: 'Agrandir une carte au survol' }))),
    el('section', { class: 'set-sec' },
      el('h3', { text: 'Données' }),
      el('div', { class: 'set-row' }, el('span', { class: 'set-label', text: 'Dossier des decks' }),
        el('code', { class: 'path', text: state.info ? state.info.dataPath : '' }),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => api.shell.openDataFolder() } }, icon('folder', 16), 'Ouvrir')),
      el('div', { class: 'set-row' }, el('span', { class: 'set-label', text: 'Cache d\'images' }), cacheInfo,
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: async () => { await api.cache.clear(); cacheInfo.textContent = 'vidé'; toast('Cache vidé. Les images seront retéléchargées au besoin.'); } } }, 'Vider le cache')),
      el('p', { class: 'muted small', text: 'Les images déjà vues sont gardées sur ton ordinateur : le board reste utilisable hors ligne.' })),
    updatesSection(),
    el('section', { class: 'set-sec' },
      el('h3', { text: 'Connexion à Scryfall' }),
      el('p', { class: 'muted small', text: 'Vérifie que la recherche fonctionne, y compris par nom français.' }),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: async (e) => {
        const b = e.currentTarget; b.disabled = true; diagOut.replaceChildren(el('p', { class: 'muted', text: 'Test en cours…' }));
        try {
          const r = await api.scryfall.diagnose();
          diagOut.replaceChildren(el('ul', { class: 'diag-list' }, r.steps.map((st) => el('li', { class: st.ok ? 'ok' : 'ko' },
            el('span', { class: 'diag-mark', text: st.ok ? 'Réussi' : 'Échec' }), el('span', { text: ` ${st.label} : ${st.detail} (${st.ms} ms)` })))));
        } catch (err) { diagOut.replaceChildren(el('p', { class: 'ko', text: err.message })); }
        b.disabled = false;
      } } }, 'Lancer le test'),
      diagOut),
    el('section', { class: 'set-sec about' },
      el('p', { class: 'muted small', text: `MTG Deck Lab ${state.info ? state.info.version : ''}. Données et images de cartes fournies par Scryfall. Magic: The Gathering et ses illustrations appartiennent à Wizards of the Coast ; cette application n'est ni produite ni approuvée par Wizards of the Coast.` })));
  modal({ title: 'Réglages', body, width: 640, actions: [{ label: 'Fermer', kind: 'primary' }] });
}

function updatesSection() {
  const st = el('div', { class: 'upd', 'aria-live': 'polite' }, el('p', { class: 'muted small', text: 'Vérification de la configuration…' }));
  const sec = el('section', { class: 'set-sec' }, el('h3', { text: 'Mises à jour' }), st);
  api.updates.support().then((sup) => {
    const auto = el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: state.settings.autoUpdateCheck !== false, disabled: !sup.ok, on: { change: (e) => setSetting({ autoUpdateCheck: e.target.checked }) } }), el('span', { text: 'Vérifier au démarrage' }));
    const out = el('p', { class: 'small' });
    const btn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: !sup.ok, on: { click: async () => {
      btn.disabled = true; out.textContent = 'Recherche…';
      const r = await api.updates.check();
      btn.disabled = false;
      out.textContent = r.state === 'available' ? `Version ${r.version} disponible.` : r.state === 'none' ? 'Tu as la dernière version.' : r.state === 'error' ? `Erreur : ${r.message}` : (r.text || '');
      if (r.state === 'available') offerUpdate(r.version, sup.install, r.url);
    } } }, 'Rechercher une mise à jour');
    st.replaceChildren(el('div', { class: 'set-row' }, el('span', { class: 'set-label', text: 'Version installée' }), el('strong', { text: sup.version }), btn), auto, out);
    if (sup.text) st.append(el('p', { class: 'muted small', text: sup.text }));
  }).catch(() => st.replaceChildren());
  return sec;
}

/** Propose d'installer une nouvelle version (ou d'ouvrir la page de téléchargement pour la version portable). */
export function offerUpdate(version, canInstall, url) {
  if (canInstall) {
    toast(`La version ${version} de MTG Deck Lab est disponible.`, { timeout: 15000, action: { label: 'Télécharger', fn: async () => {
      toast('Téléchargement de la mise à jour…', { timeout: 6000 });
      try { await api.updates.download(); } catch (e) { toast(e.message, { kind: 'error' }); }
    } } });
  } else {
    toast(`La version ${version} est disponible.`, { timeout: 15000, action: url ? { label: 'Ouvrir la page de téléchargement', fn: () => api.shell.openExternal(url) } : null });
  }
}

export function initUpdateEvents() {
  api.updates.onEvent((s) => {
    if (s.state === 'available') offerUpdate(s.version, s.canInstall, s.url);
    else if (s.state === 'downloaded') toast(`Version ${s.version} téléchargée.`, { kind: 'ok', timeout: 30000, action: { label: 'Redémarrer et installer', fn: async () => { const { flushSave } = await import('./store.js'); await flushSave(); api.updates.install(); } } });
    else if (s.state === 'error') console.warn('Mise à jour :', s.message);
  });
}

function offerRefresh() {
  toast('Les cartes de ce deck n\'ont pas encore leurs visuels ou noms français.', { action: { label: 'Les récupérer', fn: () => refreshDeckCards({ force: false }) }, timeout: 10000 });
}

/** Re-télécharge les données des cartes du deck (et les visuels VF si demandés). */
export async function refreshDeckCards({ force = true } = {}) {
  const deck = state.deck;
  if (!deck) return;
  const cards = Object.values(deck.cards);
  if (!cards.length) return;
  const items = cards.map((c) => ({ name: c.name, set: c.set || null, cn: c.collectorNumber || null }));
  const t = toast(`Actualisation de ${cards.length} cartes…`, { timeout: 60000 });
  try {
    const wantFr = state.settings.imageLang === 'fr' || state.settings.nameLang === 'fr';
    const res = await api.scryfall.resolve(items, { wantFr, force });
    const resolved = new Map(res.resolved);
    mutate((d) => {
      for (const c of Object.values(d.cards)) {
        const n = resolved.get(itemKey({ name: c.name, set: c.set || null, cn: c.collectorNumber || null }));
        if (n && n.oracleId === c.oracleId) {
          const clean = { ...n };
          delete clean._printKey;
          // conserver le choix d'impression du joueur
          if (c.chosenPrint) { clean.chosenPrint = c.chosenPrint; clean.set = c.set; clean.setName = c.setName; clean.collectorNumber = c.collectorNumber; }
          d.cards[c.oracleId] = clean;
        }
      }
    }, { relink: true, reason: 'refresh' });
    t.remove();
    toast('Données des cartes à jour.', { kind: 'ok' });
  } catch (e) { t.remove(); toast(`Actualisation impossible : ${e.message}`, { kind: 'error' }); }
}
