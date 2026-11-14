// Scénario de bout en bout exécuté dans le processus principal (MTG_E2E=test/e2e.mjs).
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.MTG_E2E_OUT || path.resolve('test-output');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function run(ctx) {
  try { await scenario(ctx); } catch (e) {
    console.error('E2E — étape en échec :', e.message);
    try { const img = await ctx.win.webContents.capturePage(); await fs.writeFile(path.join(OUT, 'erreur.png'), img.toPNG()); } catch { /* fenêtre fermée */ }
    ctx.app.exit(1);
  }
}

async function scenario({ win, app }) {
  await fs.mkdir(OUT, { recursive: true });
  const errors = [];
  win.webContents.on('console-message', (...args) => {
    const e = args[0] && typeof args[0] === 'object' && 'level' in args[0] ? args[0] : { level: args[1], message: args[2] };
    if (e.level === 'error' || e.level === 3) { errors.push(e.message); console.error('[console]', e.message); }
  });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const waitFor = async (code, label, timeout = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { if (await js(code)) return; await sleep(100); }
    throw new Error(`Délai dépassé : ${label}`);
  };
  const shot = async (name) => {
    await sleep(350);
    const img = await win.webContents.capturePage();
    await fs.writeFile(path.join(OUT, `${name}.png`), img.toPNG());
  };
  const click = (sel, text) => js(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; const el = ${text ? `els.find((e) => e.textContent.includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) throw new Error(${JSON.stringify(`introuvable : ${sel} ${text || ''}`)}); el.click(); return true; })()`);
  const results = [];
  const check = (cond, label) => { results.push({ ok: !!cond, label }); if (!cond) console.error('ÉCHEC', label); };

  win.setSize(1480, 920);
  await waitFor('!!(window.__app && window.__app.state.settings && document.querySelector("#view-library .lib-head"))', 'bibliothèque');
  await shot('01-bibliotheque-vide');

  // Nouveau deck
  await click('#view-library .btn-primary', 'Nouveau deck');
  await waitFor('!!document.querySelector(".modal input")', 'invite nom');
  await js(`(() => { const i = document.querySelector('.modal input'); i.value = 'Ghave aristocrates'; i.dispatchEvent(new Event('input')); document.querySelector('.modal .btn-primary').click(); return true; })()`);
  await waitFor('window.__app.state.view === "board" && !!document.querySelector(".board-empty")', 'board vide');
  await shot('02-deck-vide');

  // Import
  const list = [
    'Commander', '1 Ghave, Guru of Spores', '', 'Deck',
    '1 Artiste sanguinaire', '1 Soul Warden', "1 Ajani's Pridemate", '1 Viscera Seer', '1 Doubling Season', '1 Hardened Scales',
    '1 Anneau solaire', '1 Panharmonicon', '1 Ephemerate', '1 Mulldrifter', '1 Elvish Visionary', '1 Elvish Archdruid', '1 Llanowar Elves',
    '1 Avenger of Zendikar', '1 Cultivate', '12 Forest', '10 Swamp', '9 Plains', '1 Reanimate', '1 Pitiless Plunderer', '1 Mayhem Devil',
    '1 Krenko, Mob Boss', '1 Skullclamp', '1 Chasm Skulker', '1 Rituel sombre', '1 Jeweled Lotus', '1 Turntimber Symbiosis', '1 Grave Titan',
    '1 Impact Tremors', "1 Garruk's Packleader", '1 Young Pyromancer', "1 Cathars' Crusade", '1 Purphoros, God of the Forge', '1 Opposition Agent',
    '1 Smothering Tithe', '1 Carte Imaginaire', '', 'Sideboard', '1 Sol Ring',
  ].join('\n');
  await click('#topbar .btn-primary', 'Importer');
  await waitFor('!!document.querySelector(".import-text")', 'fenêtre import');
  await js(`(() => { const t = document.querySelector('.import-text'); t.value = ${JSON.stringify(list)}; t.dispatchEvent(new Event('input')); return true; })()`);
  await waitFor('document.querySelectorAll(".preview-row").length > 30', 'aperçu');
  const preview = await js('document.querySelector(".preview-sum").textContent');
  check(preview.includes('Commandant : 1') && preview.includes('Réserve : 1'), `aperçu des zones (${preview})`);
  await shot('03-import-apercu');
  await click('.modal .btn-primary', 'Importer');
  await waitFor('!!document.querySelector(".fix-row")', 'fenêtre noms non trouvés', 40000);
  await shot('04-noms-non-trouves');
  const unresolved = await js('window.__app.state.deck.unresolved.map((u) => u.name)');
  check(unresolved.length === 1 && unresolved[0] === 'Carte Imaginaire', `une seule carte introuvable (${unresolved})`);
  await click('.modal .btn-ghost', 'Plus tard');
  await waitFor('!document.querySelector(".modal")', 'fermeture');

  const st = await js(`(() => { const d = window.__app.state.deck; return {
    entries: d.entries.length,
    total: d.entries.filter((e) => e.zone !== 'side' && e.zone !== 'maybe').reduce((s, e) => s + e.qty, 0),
    cmd: d.entries.filter((e) => e.zone === 'commander').map((e) => d.cards[e.oracleId].name),
    fr: Object.values(d.cards).filter((c) => c.printedName).map((c) => c.name + '=' + c.printedName),
    links: d.links.length, pending: d.links.filter((l) => l.status === 'pending').length,
  }; })()`);
  check(st.cmd[0] === 'Ghave, Guru of Spores', 'commandant importé');
  check(st.total === 64, `64 cartes jouées (obtenu ${st.total})`);
  check(st.fr.includes('Dark Ritual=Rituel sombre') && st.fr.includes('Blood Artist=Artiste sanguinaire') && st.fr.includes('Sol Ring=Anneau solaire'), `noms FR (${st.fr})`);
  check(st.links > 100 && st.pending === st.links, `suggestions générées (${st.links})`);
  await waitFor('document.querySelectorAll(".tile img.card-img").length > 20', 'images du board');
  await sleep(800);
  const broken = await js('[...document.querySelectorAll(".tile img.card-img")].filter((i) => !i.complete || i.naturalWidth === 0).length');
  check(broken === 0, `images chargées via le cache (${broken} en échec)`);
  await shot('05-board-type');

  // sélection d'une carte
  await js(`(() => { const d = window.__app.state.deck; const id = Object.values(d.cards).find((c) => c.name === 'Soul Warden').oracleId; document.querySelector('.tile[data-id="' + id + '"]').click(); return true; })()`);
  await waitFor('!!document.querySelector("#inspector .card-title")', 'inspecteur');
  await shot('06-inspecteur-carte');

  // groupement par coût et piles
  await click('.seg-btn', 'Coût');
  await waitFor('!!document.querySelector(".stack-g3")', 'colonnes par coût');
  await shot('07-board-cout');
  await click('.seg-btn', 'Type');

  // Graphe
  await js('window.__app.select(null); true');
  await click('.main-tabs .tab', 'Graphe');
  await waitFor('!!document.querySelector(".graph-canvas canvas")', 'graphe');
  await sleep(2500);
  await shot('08-graphe');
  const gcount = await js('document.querySelector(".graph-count").textContent');
  check(/\d+ cartes, (\d+ groupes?, )?\d+ liens/.test(gcount), `compteur du graphe (${gcount})`);
  // focus sur une carte
  await js(`(() => { const d = window.__app.state.deck; const id = Object.values(d.cards).find((c) => c.name === 'Blood Artist').oracleId; window.__app.select(id); return true; })()`);
  await sleep(700);
  await shot('09-graphe-focus');

  // Interactions
  await click('.main-tabs .tab', 'Interactions');
  await waitFor('!!document.querySelector(".link-group")', 'liste des interactions');
  await shot('10-interactions');
  const before = await js('window.__app.state.deck.links.filter((l) => l.status === "accepted").length');
  await click('.link-group .group-head .btn', 'Tout valider');
  await sleep(300);
  const after = await js('window.__app.state.deck.links.filter((l) => l.status === "accepted").length');
  check(after > before, `validation d'un groupe (${before} → ${after})`);
  await js('window.__app.undo(); true');
  const undone = await js('window.__app.state.deck.links.filter((l) => l.status === "accepted").length');
  check(undone === before, `annulation (Ctrl+Z) (${undone})`);
  await js('window.__app.redo(); true');
  // lien manuel
  await js(`(() => { const d = window.__app.state.deck; const a = Object.values(d.cards).find((c) => c.name === 'Sol Ring' ) || Object.values(d.cards).find((c) => c.name === 'Ephemerate'); const b = Object.values(d.cards).find((c) => c.name === 'Ghave, Guru of Spores'); window.__app.openLinkDialog({ from: a.oracleId, to: b.oracleId }); return true; })()`);
  await waitFor('!!document.querySelector(".kind-picker")', 'dialogue de lien');
  await click('.kind-opt', 'Combo');
  await js(`(() => { const t = document.querySelector('.ld textarea'); t.value = 'Test manuel'; return true; })()`);
  await shot('11-dialogue-lien');
  await click('.modal .btn-primary', 'Créer le lien');
  const manual = await js('window.__app.state.deck.links.filter((l) => l.origin === "manual").length');
  check(manual === 1, 'lien manuel créé');
  await click('.tab', 'Validés');
  await sleep(300);
  await shot('12-interactions-validees');

  // Réglages
  await click('#topbar .icon-btn[aria-label="Réglages"]');
  await waitFor('!!document.querySelector(".settings")', 'réglages');
  await shot('13-reglages');
  await click('.modal .btn-primary', 'Fermer');

  // Piles, glisser-déposer, menu contextuel, aperçu au survol
  await js('window.__app.select(null); true');
  await click('.main-tabs .tab', 'Board');
  await waitFor('window.__app.state.view === "board" && !!document.querySelector(".board-bar")', 'board');
  await click('.seg-btn', 'Mes piles');
  await waitFor('[...document.querySelectorAll(".board-bar .btn")].some((b) => b.textContent.includes("Nouvelle pile"))', 'mode piles');
  await click('.board-bar .btn', 'Nouvelle pile');
  await waitFor('!!document.querySelector(".modal input")', 'invite pile');
  await js(`(() => { const i = document.querySelector('.modal input'); i.value = 'Rampe'; document.querySelector('.modal .btn-primary').click(); return true; })()`);
  await waitFor('[...document.querySelectorAll(".stack-title")].some((t) => t.textContent === "Rampe")', 'pile créée');
  const dnd = (cardName, stackSel) => js(`(() => {
    const d = window.__app.state.deck; const id = Object.values(d.cards).find((c) => c.name === ${JSON.stringify(cardName)}).oracleId;
    const tile = document.querySelector('.tile[data-id="' + id + '"]');
    const target = ${stackSel};
    const dt = new DataTransfer();
    tile.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    tile.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return true; })()`);
  await dnd('Llanowar Elves', `[...document.querySelectorAll('.stack')].find((s) => s.querySelector('.stack-title').textContent === 'Rampe')`);
  await sleep(200);
  const pileOk = await js(`(() => { const d = window.__app.state.deck; const p = d.piles.find((x) => x.name === 'Rampe'); const id = Object.values(d.cards).find((c) => c.name === 'Llanowar Elves').oracleId; return d.entries.find((e) => e.oracleId === id).pile === p.id; })()`);
  check(pileOk, 'glisser une carte dans une pile');
  await dnd('Mulldrifter', `document.querySelector('.stack-maybe')`);
  await sleep(200);
  const maybeOk = await js(`(() => { const d = window.__app.state.deck; const id = Object.values(d.cards).find((c) => c.name === 'Mulldrifter').oracleId; return d.entries.find((e) => e.oracleId === id).zone === 'maybe'; })()`);
  check(maybeOk, 'glisser une carte vers « Peut-être »');
  await js(`(() => { const d = window.__app.state.deck; const id = Object.values(d.cards).find((c) => c.name === 'Opposition Agent').oracleId; const t = document.querySelector('.tile[data-id="' + id + '"]'); const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 })); return true; })()`);
  await waitFor('!!document.querySelector(".menu")', 'menu contextuel');
  await shot('16-menu-contextuel');
  await click('.menu-item', 'Déplacer vers Réserve');
  await sleep(200);
  const sideOk = await js(`(() => { const d = window.__app.state.deck; const id = Object.values(d.cards).find((c) => c.name === 'Opposition Agent').oracleId; return d.entries.find((e) => e.oracleId === id).zone === 'side'; })()`);
  check(sideOk, 'menu contextuel : déplacer vers la réserve');
  await shot('15-piles');
  await js(`(() => { const t = document.querySelectorAll('.tile')[3]; t.dispatchEvent(new MouseEvent('mouseenter', { clientX: 400, clientY: 300 })); return true; })()`);
  await sleep(700);
  const hov = await js('!document.getElementById("hover-preview").hidden && !!document.querySelector("#hover-preview img").src');
  check(hov, 'aperçu agrandi au survol');
  await js(`(() => { document.querySelectorAll('.tile')[3].dispatchEvent(new MouseEvent('mouseleave')); return true; })()`);
  await click('.seg-btn', 'Type');
  await waitFor('!!document.querySelector(".stack-gland")', 'retour au regroupement par type');

  // ---------------------------------------------------------------- version 1.1
  // Liens regroupés et suggestions faibles
  await js('window.__app.select(null); true');
  await click('.main-tabs .tab', 'Interactions');
  await click('.links-head .tab', 'À valider');
  await waitFor('!!document.querySelector(".group-row")', 'ligne de groupe');
  const nGroups = await js('document.querySelectorAll(".group-row").length');
  check(nGroups > 0, `liens regroupés (${nGroups} groupes)`);
  await click('.group-row .group-chip');
  await waitFor('!!document.querySelector(".group-members .link-row")', 'membres du groupe');
  await shot('20-groupes');
  const hadWeak = await js('!!document.querySelector(".weak-note")');
  const rowsBefore = await js('document.querySelectorAll(".link-row").length');
  await click('.chip-toggle', 'Masquer les suggestions faibles');
  await sleep(300);
  const rowsAfter = await js('document.querySelectorAll(".link-row").length');
  check(hadWeak ? rowsAfter > rowsBefore : true, `afficher les suggestions faibles (${rowsBefore} → ${rowsAfter})`);
  await click('.chip-toggle', 'Masquer les suggestions faibles');
  await click('.main-tabs .tab', 'Graphe');
  await waitFor('!!document.querySelector(".graph-canvas canvas")', 'graphe');
  await sleep(1800);
  const gc2 = await js('document.querySelector(".graph-count").textContent');
  check(/groupe/.test(gc2), `groupes dans le graphe (${gc2})`);
  await js(`(() => { const r = [...document.querySelectorAll('.graph-bar .chip-toggle')].find((b) => b.textContent === 'Regrouper'); return !!r; })()`);
  await shot('21-graphe-groupes');

  // Ajout direct d'une carte
  await click('.main-tabs .tab', 'Board');
  await waitFor('!!document.querySelector(".add-input")', 'champ d\'ajout');
  await js(`(() => { const i = document.querySelector('.add-input'); i.focus(); i.value = 'Rhys'; i.dispatchEvent(new Event('input')); return true; })()`);
  await waitFor('!!document.querySelector(".ac-item")', 'suggestions d\'ajout');
  await shot('22-ajout-direct');
  await js(`(() => { document.querySelector('.add-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  await waitFor('Object.values(window.__app.state.deck.cards).some((c) => c.name === "Rhystic Study")', 'carte ajoutée', 20000);
  check(true, 'ajout direct d\'une carte par recherche');
  await js(`(() => { const i = document.querySelector('.add-input'); i.value = 'artiste sangu'; i.dispatchEvent(new Event('input')); return true; })()`);
  await waitFor('[...document.querySelectorAll(".ac-item")].some((li) => li.textContent.includes("Artiste sanguinaire"))', 'suggestion par nom français (cache)');
  check(true, 'autocomplétion des noms français depuis le cache');
  await js(`(() => { const i = document.querySelector('.add-input'); i.value = ''; i.dispatchEvent(new Event('input')); i.blur(); return true; })()`);

  // Choix de l'impression
  const solId = await js(`Object.values(window.__app.state.deck.cards).find((c) => c.name === 'Sol Ring').oracleId`);
  await js(`window.__app.select(${JSON.stringify(solId)}); true`);
  await waitFor('!!document.querySelector("#inspector .insp-meta .link-btn") && document.querySelector("#inspector .card-title").textContent === "Anneau solaire"', 'panneau de Sol Ring');
  await click('#inspector .insp-meta .link-btn');
  await waitFor('document.querySelectorAll(".print-opt").length >= 2', 'impressions', 20000);
  await shot('23-impressions');
  await js(`(() => { const b = [...document.querySelectorAll('.print-opt')].find((x) => x.querySelector('.lang-fr')); b.click(); return true; })()`);
  await sleep(300);
  const chosen = await js(`(window.__app.state.deck.cards[${JSON.stringify(solId)}].chosenPrint || {}).lang`);
  check(chosen === 'fr', `impression VF choisie (${chosen})`);

  // Correction manuelle d'un rôle
  await waitFor('[...document.querySelectorAll("#inspector .role-toggle")].some((b) => b.textContent === "Protection")', 'rôles');
  await click('#inspector .role-toggle', 'Protection');
  await sleep(200);
  const roleSet = await js(`JSON.stringify((window.__app.state.deck.cardRoles || {})[${JSON.stringify(solId)}] || null)`);
  check(roleSet && roleSet.includes('protection') && roleSet.includes('ramp'), `rôle ajouté à la main (${roleSet})`);
  await click('#inspector .role-toggle', 'Protection');
  await sleep(200);
  const roleBack = await js(`(window.__app.state.deck.cardRoles || {})[${JSON.stringify(solId)}] === undefined`);
  check(roleBack, 'retour à la détection automatique');

  // Vue Analyse
  await js('window.__app.select(null); true');
  await click('.main-tabs .tab', 'Analyse');
  await waitFor('document.querySelectorAll(".bm-row").length === 5', 'repères');
  const manaRows = await js('document.querySelectorAll(".an-table tbody tr").length');
  check(manaRows === 3, `base de mana : 3 couleurs (${manaRows})`);
  await click('.an-panel .btn', 'Tirer une main');
  await waitFor('document.querySelectorAll(".hand-card").length === 7', 'main de départ');
  await click('.an-panel .btn', 'Mulligan');
  await sleep(150);
  const freeMull = await js('!document.querySelector(".hand-bottom") && document.querySelectorAll(".hand-card").length === 7');
  check(freeMull, 'premier mulligan gratuit');
  await click('.an-panel .btn', 'Mulligan');
  await waitFor('!!document.querySelector(".hand-bottom")', 'carte à remettre');
  await click('.hand-card');
  await sleep(150);
  const six = await js('document.querySelectorAll(".hand-card").length');
  check(six === 6, `deuxième mulligan : une carte sous la bibliothèque (${six})`);
  await shot('24-analyse');
  await click('.an-panel .btn', 'Analyser avec Commander Spellbook');
  await waitFor('!!document.querySelector(".modal .btn-primary")', 'confirmation Spellbook');
  await click('.modal .btn-primary', 'Analyser');
  await waitFor('!!document.querySelector(".combo")', 'combos', 20000);
  const sbInc = await js('window.__app.state.deck.spellbook.included.length');
  check(sbInc === 1, `combo complète trouvée (${sbInc})`);
  const bnum = await js('document.querySelector(".bracket-n").textContent');
  check(bnum === '3', `bracket minimal estimé (${bnum})`);
  await click('.combo .btn', 'Ajouter comme liens');
  await sleep(200);
  const csbLinks = await js('window.__app.state.deck.links.filter((l) => l.source === "spellbook").length');
  check(csbLinks === 1, `lien combo créé (${csbLinks})`);
  await js('document.querySelector(".bracket").scrollIntoView(); true');
  await shot('25-combos-bracket');

  // Versions et comparaison
  const menuItem = async (label) => {
    await click('#topbar .icon-btn[aria-label="Exporter et autres actions"]');
    await waitFor('!!document.querySelector(".menu")', 'menu');
    await click('.menu-item', label);
  };
  await menuItem('Enregistrer une version');
  await waitFor('!!document.querySelector(".modal input")', 'nom de version');
  await js(`(() => { const i = document.querySelector('.modal input'); i.value = 'Avant test'; document.querySelector('.modal .btn-primary').click(); return true; })()`);
  await waitFor('!document.querySelector(".modal")', 'version enregistrée');
  await sleep(300);
  await js(`window.__app.mutate((d) => { const id = Object.values(d.cards).find((c) => c.name === 'Llanowar Elves').oracleId; d.entries = d.entries.filter((e) => e.oracleId !== id); delete d.cards[id]; }, { relink: true }); true`);
  await menuItem('Versions du deck');
  await waitFor('!!document.querySelector(".ver-row")', 'liste des versions');
  await click('.ver-row .btn', 'Comparer');
  await waitFor('!!document.querySelector(".diff-col.rem li")', 'comparaison', 15000);
  const remTxt = await js('document.querySelector(".diff-col.rem").textContent');
  check(remTxt.includes('Llanowar Elves'), 'comparaison : carte retirée détectée');
  await shot('26-comparaison');
  await click('.modal .btn-primary', 'Fermer');
  await menuItem('Versions du deck');
  await waitFor('!!document.querySelector(".ver-row")', 'liste des versions');
  await js(`(() => { const row = [...document.querySelectorAll('.ver-row')].find((r) => r.textContent.includes('Avant test')); [...row.querySelectorAll('.btn')].find((b) => b.textContent === 'Restaurer').click(); return true; })()`);
  await waitFor('[...document.querySelectorAll(".modal")].some((m) => m.textContent.includes("Restaurer cette version"))', 'confirmation de restauration');
  await js(`(() => { const m = [...document.querySelectorAll('.modal')].find((x) => x.textContent.includes('Restaurer cette version')); m.querySelector('.btn-primary').click(); return true; })()`);
  await waitFor('Object.values(window.__app.state.deck.cards).some((c) => c.name === "Llanowar Elves")', 'restauration', 15000);
  check(true, 'restauration d\'une version');

  // Collection du deck (onglet 5) et import de l'inventaire
  await sleep(300);
  await click('.main-tabs .tab', 'Collection');
  await waitFor('!!document.querySelector("#view-collection .board-empty")', 'collection vide');
  await click('#view-collection .btn-primary', 'Importer des cartes');
  await waitFor('!!document.querySelector(".coll textarea")', 'import inventaire');
  await js(`(() => { const t = document.querySelector('.coll textarea'); t.value = '1 Sol Ring\\n1 Artiste sanguinaire\\n1 Ghave, Guru of Spores\\n12 Forest\\n1 Rhystic Study\\n1 Eternal Witness\\n1 Swords to Plowshares\\n2 Worldly Tutor\\n1 Carte Imaginaire'; return true; })()`);
  await click('.modal .btn-primary', 'Importer');
  await waitFor('window.__app.state.collection && Object.keys(window.__app.state.collection.cards).length === 8', 'inventaire importé', 20000);
  const fullData = await js('Object.values(window.__app.state.collection.cards).every((e) => e.card && e.card.oracleText !== undefined)');
  check(fullData, 'données complètes des cartes stockées dans l\'inventaire');
  const unres = await js('window.__app.state.collection.unresolved.length');
  check(unres === 1, `ligne non reconnue signalée (${unres})`);
  await waitFor('!!document.querySelector(".dc-tiles")', 'synthèse de la collection');
  await waitFor('document.querySelectorAll("#dc-sugg .dc-row.cand").length >= 2 && !document.querySelector("#dc-sugg [aria-live]")', 'suggestions de l\'inventaire', 20000);
  const sugg = await js('[...document.querySelectorAll("#dc-sugg .dc-row.cand strong")].map((n) => n.textContent)');
  check(sugg.includes('Eternal Witness') && sugg.includes('Swords to Plowshares') && !sugg.includes('Rhystic Study'), `suggestions : cartes possédées hors du deck (${sugg.join(', ')})`);
  const witnessSyn = await js(`(() => { const row = [...document.querySelectorAll('#dc-sugg .dc-row.cand')].find((r) => r.querySelector('strong').textContent === 'Eternal Witness'); return row.querySelector('.dc-why').textContent; })()`);
  check(/interaction/.test(witnessSyn), `interactions calculées (${witnessSyn})`);
  await shot('27-collection-deck');
  await js(`(() => { const row = [...document.querySelectorAll('#dc-sugg .dc-row.cand')].find((r) => r.querySelector('strong').textContent === 'Worldly Tutor'); [...row.querySelectorAll('.btn')].find((b) => b.textContent.includes('Ajouter')).click(); return true; })()`);
  await waitFor('Object.values(window.__app.state.deck.cards).some((c) => c.name === "Worldly Tutor")', 'carte de l\'inventaire ajoutée au deck');
  check(true, 'ajout au deck depuis les suggestions de l\'inventaire');
  await click('.main-tabs .tab', 'Board');
  await waitFor('document.querySelectorAll(".tile.missing").length > 0', 'cartes manquantes sur le board');
  const owned = await js(`(() => { const d = window.__app.state.deck; const id = Object.values(d.cards).find((c) => c.name === 'Blood Artist').oracleId; return !document.querySelector('.tile[data-id="' + id + '"]').classList.contains('missing'); })()`);
  check(owned, 'carte possédée non signalée');

  // Problèmes de construction
  const issues = await js(`window.__app.validate(window.__app.state.deck).map((i) => i.text)`);
  check(issues.some((t) => t.includes('Hors de l\'identité')), 'cartes hors identité signalées');
  check(issues.some((t) => t.includes('Bannie')), 'carte bannie signalée');
  check(issues.some((t) => t.includes('cartes au lieu de 100')), 'nombre de cartes signalé');

  // Sauvegarde puis rechargement complet de l'interface
  await js('window.__app.saveNow().then(() => true)');
  const acceptedBefore = await js('window.__app.state.deck.links.filter((l) => l.status === "accepted").length');
  const manualBefore = await js('window.__app.state.deck.links.filter((l) => l.origin === "manual").length');
  win.webContents.reload();
  await waitFor('!!(window.__app && window.__app.state.deck && document.querySelector(".tile"))', 'réouverture du dernier deck', 20000);
  const acceptedAfter = await js('window.__app.state.deck.links.filter((l) => l.status === "accepted").length');
  check(acceptedAfter === acceptedBefore && acceptedAfter > 0, `liens validés conservés après redémarrage (${acceptedBefore} / ${acceptedAfter})`);
  const manualAfter = await js('window.__app.state.deck.links.filter((l) => l.origin === "manual").length');
  check(manualAfter === manualBefore && manualAfter === 2, `liens manuels et combo conservés (${manualBefore} / ${manualAfter})`);

  // Bibliothèque
  await click('#topbar .back-btn');
  await waitFor('!!document.querySelector(".deck-tile")', 'tuile de deck');
  await sleep(600);
  await shot('14-bibliotheque');

  // Plusieurs decks : copie montée, cartes partagées, inventaire global
  const tileJs = (name) => `[...document.querySelectorAll('.deck-tile')].find((t) => t.querySelector('.deck-name').textContent === ${JSON.stringify(name)})`;
  const tileMenu = async (name, label) => {
    await js(`(() => { ${tileJs(name)}.querySelector('.tile-more').click(); return true; })()`);
    await waitFor('!!document.querySelector(".menu")', 'menu du deck');
    await click('.menu-item', label);
  };
  await tileMenu('Ghave aristocrates', 'Dupliquer');
  await waitFor(`!!${tileJs('Ghave aristocrates (copie)')}`, 'copie du deck');
  await tileMenu('Ghave aristocrates (copie)', 'Marquer comme monté');
  await waitFor(`!!${tileJs('Ghave aristocrates (copie)')}.querySelector('.tag-built')`, 'deck marqué monté');
  check(true, 'marquer un deck comme monté');
  await js(`(() => { ${tileJs('Ghave aristocrates')}.click(); return true; })()`);
  await waitFor('window.__app.state.deck && window.__app.state.deck.name === "Ghave aristocrates" && window.__app.state.view === "board"', 'ouverture du deck original');
  await waitFor('(window.__app.state.usageDecks || []).length === 2', 'utilisation des deux decks');
  await click('.main-tabs .tab', 'Collection');
  await waitFor('!!document.querySelector("#dc-inOther")', 'cartes rangées dans un autre deck');
  const inOther = await js('[...document.querySelectorAll("#dc-inOther .dc-row")].map((r) => r.querySelector("strong").textContent + " | " + r.querySelector(".dc-why").textContent)');
  check(inOther.some((t) => t.startsWith('Anneau solaire') && t.includes('Ghave aristocrates (copie)')), `Sol Ring à reprendre dans la copie montée (${inOther.join(' / ')})`);
  const shared = await js('document.querySelectorAll("#dc-shared .dc-row").length');
  check(shared === 0, 'aucune carte « partagée » : la copie est montée, donc prioritaire');
  await shot('28-collection-partagee');
  await click('.main-tabs .tab', 'Board');
  await waitFor('!!document.querySelector(".tile.own-inother .tile-missing.inother")', 'étiquette « Dans … » sur le board');
  check(true, 'board : carte rangée dans un autre deck signalée');

  // Inventaire global
  await click('.main-tabs .tab', 'Collection');
  await click('#view-collection .dc-head .btn', 'Ouvrir l\'inventaire');
  await waitFor('window.__app.state.view === "inventory" && document.querySelectorAll(".inv-row").length === 8', 'inventaire');
  const solRow = await js(`(() => { const r = [...document.querySelectorAll('.inv-row')].find((x) => x.querySelector('strong').textContent === 'Anneau solaire'); return r.querySelector('.inv-st').textContent + ' | ' + r.querySelectorAll('.deck-chip').length; })()`);
  check(solRow.includes('Il en manque 1') && solRow.endsWith('| 2'), `Sol Ring : 1 possédé pour 2 decks (${solRow})`);
  await shot('29-inventaire');
  await js(`(() => { const s = [...document.querySelectorAll('.inv-bar .inline-field')].find((l) => l.textContent.startsWith('Utilisation')).querySelector('select'); s.value = 'conflict'; s.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(200);
  const conflictNames = await js('[...document.querySelectorAll(".inv-row strong")].map((n) => n.textContent)');
  check(conflictNames.length >= 2 && conflictNames.includes('Anneau solaire') && !conflictNames.includes('Eternal Witness'), `filtre « pas assez d'exemplaires » (${conflictNames.join(', ')})`);
  await js(`(() => { const s = [...document.querySelectorAll('.inv-bar .inline-field')].find((l) => l.textContent.startsWith('Utilisation')).querySelector('select'); s.value = 'all'; s.dispatchEvent(new Event('change')); const t = [...document.querySelectorAll('.inv-bar .inline-field')].find((l) => l.textContent.startsWith('Trier')).querySelector('select'); t.value = 'qty'; t.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(200);
  const firstByQty = await js('document.querySelector(".inv-row strong").textContent');
  check(firstByQty === 'Forest', `tri par quantité : 12 Forest en tête (${firstByQty})`);
  await click('.inv-bar .seg-btn', 'Images');
  await waitFor('document.querySelectorAll(".inv-cell").length === 8', 'affichage en images');
  await shot('30-inventaire-images');
  await click('.inv-bar .seg-btn', 'Liste');
  await waitFor('document.querySelectorAll(".inv-row").length === 8', 'affichage en liste');
  // Ajouter à un deck depuis l'inventaire
  await js(`(() => { const r = [...document.querySelectorAll('.inv-row')].find((x) => x.querySelector('strong').textContent === 'Eternal Witness'); [...r.querySelectorAll('.btn')].find((b) => b.textContent.includes('Deck')).click(); return true; })()`);
  await waitFor('!!document.querySelector(".modal select")', 'choix du deck');
  await js(`(() => { const s = document.querySelector('.modal select'); s.value = [...s.options].find((o) => o.textContent.startsWith('Ghave aristocrates') && !o.textContent.includes('copie')).value; s.dispatchEvent(new Event('change')); return true; })()`);
  await click('.modal .btn-primary', 'Ajouter');
  await waitFor('!document.querySelector(".modal")', 'ajout');
  const origId = await js(`window.__app.state.decks.find((d) => d.name === 'Ghave aristocrates').id`);
  await waitFor(`window.mtg.decks.load(${JSON.stringify(origId)}).then((d) => Object.values(d.cards).some((c) => c.name === 'Eternal Witness'))`, 'carte ajoutée au deck fermé', 15000);
  check(true, 'ajout d\'une carte de l\'inventaire à un deck fermé');
  await waitFor(`(() => { const r = [...document.querySelectorAll('.inv-row')].find((x) => x.querySelector('strong').textContent === 'Eternal Witness'); return r && r.querySelectorAll('.deck-chip').length === 1; })()`, 'utilisation mise à jour');
  // Quantité modifiée puis enregistrée
  await js(`(() => { const r = [...document.querySelectorAll('.inv-row')].find((x) => x.querySelector('strong').textContent === 'Swords to Plowshares'); r.querySelector('[aria-label="Un exemplaire de plus"]').click(); return true; })()`);
  await sleep(900);
  const savedQty = await js(`window.mtg.collection.get().then((c) => Object.values(c.cards).find((e) => e.card && e.card.name === 'Swords to Plowshares').qty)`);
  check(savedQty === 2, `quantité enregistrée (${savedQty})`);
  // Liste d'achats
  await click('.inv-tabs .tab', 'À acquérir');
  await waitFor('!!document.querySelector(".inv-shop")', 'liste d\'achats');
  const shopNames = await js('[...document.querySelectorAll(".inv-shop .inv-row strong")].map((n) => n.textContent)');
  check(shopNames.includes('Anneau solaire') && shopNames.includes('Panharmonicon'), `liste d'achats pour tous les decks (${shopNames.length} cartes)`);
  await shot('31-a-acquerir');
  await click('#topbar .main-tabs .tab', 'Mes decks');
  await waitFor('!!document.querySelector(".deck-tile")', 'retour aux decks');

  // Modification juste avant la fermeture de la fenêtre : doit être enregistrée
  await js(`(() => { ${tileJs('Ghave aristocrates')}.click(); return true; })()`);
  await waitFor('window.__app.state.view === "board" && !!window.__app.state.deck && !!document.querySelector(".deck-title-input")', 'réouverture');
  await js(`(() => { const i = document.querySelector('.deck-title-input'); i.focus(); i.value = 'Ghave renommé'; i.blur(); return true; })()`);
  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  win.close(); // le lanceur vérifie ensuite le fichier du deck sur le disque
}
