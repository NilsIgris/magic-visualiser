import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeckText, parseCardLine, normalizeName } from '../src/shared/parser.js';
import { analyzeDeck, parseDescriptor, mergeLinks, findLoops, prepareText } from '../src/shared/analyzer.js';
import { normalizeCard, normalizeToken } from '../src/shared/normalize.js';
import { CARDS, TOKENS } from './fixtures/cards.mjs';

// ---------------------------------------------------------------- parseur
test('ligne simple, x, édition et numéro', () => {
  assert.deepEqual(parseCardLine('4 Lightning Bolt'), { qty: 4, name: 'Lightning Bolt', set: null, cn: null, zone: null, pile: null });
  assert.equal(parseCardLine('4x Lightning Bolt').name, 'Lightning Bolt');
  const a = parseCardLine('1 Sol Ring (C21) 263');
  assert.equal(a.name, 'Sol Ring'); assert.equal(a.set, 'c21'); assert.equal(a.cn, '263');
  const b = parseCardLine('1 Delver of Secrets // Insectile Aberration (ISD) 51 *F*');
  assert.equal(b.name, 'Delver of Secrets // Insectile Aberration'); assert.equal(b.set, 'isd'); assert.equal(b.cn, '51');
  assert.equal(parseCardLine('Sol Ring').qty, 1);
  assert.equal(parseCardLine('1 Xenagos, the Reveler').name, 'Xenagos, the Reveler');
  assert.equal(parseCardLine('1 Atraxa, Praetors\' Voice *CMDR*').zone, 'commander');
  const c = parseCardLine('1x Sol Ring (c21) 263 [Ramp]');
  assert.equal(c.pile, 'Ramp'); assert.equal(c.set, 'c21');
  assert.equal(parseCardLine('1 Ghave, Guru of Spores [Commander{top}]').zone, 'commander');
  assert.equal(parseCardLine('1 Éclair').name, 'Éclair');
  assert.equal(parseCardLine('1 Fire/Ice').name, 'Fire // Ice');
  assert.equal(parseCardLine('12'), null);
});

test('export Arena avec en-têtes', () => {
  const t = `Commander\n1 Ghave, Guru of Spores (C11) 200\n\nDeck\n1 Sol Ring (C21) 263\n10 Forest (M21) 274\n\nSideboard\n1 Duress (M20) 96`;
  const r = parseDeckText(t);
  assert.equal(r.format, 'arena');
  assert.deepEqual(r.items.map((i) => [i.name, i.qty, i.zone]), [
    ['Ghave, Guru of Spores', 1, 'commander'], ['Sol Ring', 1, 'main'], ['Forest', 10, 'main'], ['Duress', 1, 'side'],
  ]);
});

test('liste simple : bloc final de 1-2 cartes = commandant', () => {
  const t = `1 Sol Ring\n1 Forest\n\n1 Ghave, Guru of Spores`;
  const r = parseDeckText(t);
  assert.equal(r.items.find((i) => i.name.startsWith('Ghave')).zone, 'commander');
  assert.equal(r.items.find((i) => i.name === 'Sol Ring').zone, 'main');
});

test('liste simple sans bloc : tout dans le deck, doublons fusionnés, commentaires ignorés', () => {
  const r = parseDeckText(`// mon deck\n2 Forest\n3 Forest\nSol Ring\n`);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].qty, 5);
  assert.equal(r.ignored.length, 1);
});

test('MTGO SB:', () => {
  const r = parseDeckText(`4 Lightning Bolt\nSB: 2 Duress`);
  assert.equal(r.items[1].zone, 'side');
});

test('CSV avec guillemets, point-virgule et zone', () => {
  const t = `Quantity;Name;Set code;Collector number;Board\n1;"Krenko, Mob Boss";m13;141;Commander\n2;Forest;m21;274;Main\n1;"Fire // Ice";mh2;290;Maybeboard`;
  const r = parseDeckText(t);
  assert.equal(r.format, 'csv');
  assert.deepEqual(r.items.map((i) => [i.name, i.qty, i.set, i.cn, i.zone]), [
    ['Krenko, Mob Boss', 1, 'm13', '141', 'commander'], ['Forest', 2, 'm21', '274', 'main'], ['Fire // Ice', 1, 'mh2', '290', 'maybe'],
  ]);
});

test('CSV catégorie libre -> pile', () => {
  const r = parseDeckText(`Count,Name,Category\n1,Sol Ring,Ramp`);
  assert.equal(r.items[0].pile, 'Ramp');
  assert.equal(r.items[0].zone, 'main');
});

test('normalisation des noms', () => {
  assert.equal(normalizeName('  Rituel   Sombre '), 'rituel sombre');
  assert.equal(normalizeName('Éclair'), 'eclair');
  assert.equal(normalizeName('Ajani’s Pridemate'), "ajani's pridemate");
});

// ---------------------------------------------------------------- analyse
const tokById = new Map(Object.values(TOKENS).map((t) => [t.id, normalizeToken(t)]));
const deckCards = CARDS.map((c) => {
  const nc = normalizeCard(c);
  nc.tokens = nc.tokenRefs.map((id) => tokById.get(id)).filter(Boolean);
  return nc;
});
const byName = (n) => deckCards.find((c) => c.name === n).oracleId;
const ghave = byName('Ghave, Guru of Spores');
const { suggestions, roles } = analyzeDeck(deckCards, { commanderIds: [ghave] });
const has = (a, b, kind) => suggestions.some((s) => s.from === byName(a) && s.to === byName(b) && (!kind || s.kind === kind));

test('texte préparé : rappel retiré, nom remplacé', () => {
  const c = deckCards.find((x) => x.name === 'Ephemerate');
  const t = prepareText(c, c.oracleText);
  assert.ok(!t.includes('upkeep'));
  const k = deckCards.find((x) => x.name === 'Krenko, Mob Boss');
  assert.ok(prepareText(k, 'Krenko attacks').startsWith('~'));
});

test('arrivée de créature -> Soul Warden (et pas les non-permanents)', () => {
  assert.ok(has('Blood Artist', 'Soul Warden', 'trigger'));
  assert.ok(has('Ghave, Guru of Spores', 'Soul Warden', 'trigger'));
  assert.ok(has('Reanimate', 'Soul Warden', 'trigger'), 'Reanimate fait arriver une créature');
  assert.ok(!has('Sol Ring', 'Soul Warden'));
  assert.ok(!has('Ephemerate', 'Soul Warden'));
  assert.ok(!has('Forest', 'Soul Warden'));
  assert.ok(!has('Dark Ritual', 'Soul Warden'));
});

test('jetons créés -> arrivées', () => {
  // Smothering Tithe crée des Trésors (artefacts) : pas une créature
  assert.ok(!has('Smothering Tithe', 'Soul Warden'));
  const e = suggestions.find((s) => s.from === byName('Avenger of Zendikar') && s.to === byName('Impact Tremors'));
  assert.ok(e, 'Avenger -> Impact Tremors');
});

test('condition de force : Garruk\'s Packleader', () => {
  assert.ok(has('Avenger of Zendikar', "Garruk's Packleader", 'trigger'));
  assert.ok(has('Mayhem Devil', "Garruk's Packleader", 'trigger'), '3/3 compte');
  assert.ok(!has('Llanowar Elves', "Garruk's Packleader"));
  assert.ok(!has('Reanimate', "Garruk's Packleader"), 'créature inconnue : pas de supposition');
});

test('gain de vie -> Ajani\'s Pridemate ; "gain control" ne compte pas', () => {
  assert.ok(has('Soul Warden', "Ajani's Pridemate", 'trigger'));
  assert.ok(has('Blood Artist', "Ajani's Pridemate", 'trigger'));
  assert.ok(!has('Sol Ring', "Ajani's Pridemate"));
});

test('morts et sacrifices', () => {
  assert.ok(has('Llanowar Elves', 'Blood Artist', 'trigger'));
  assert.ok(has('Viscera Seer', 'Blood Artist', 'enable'));
  assert.ok(has('Ghave, Guru of Spores', 'Blood Artist', 'enable'));
  assert.ok(has('Viscera Seer', 'Pitiless Plunderer', 'enable'));
  assert.ok(has('Viscera Seer', 'Mayhem Devil', 'trigger'));
  assert.ok(has('Pitiless Plunderer', 'Mayhem Devil', 'trigger'), 'Trésors sacrifiés');
  assert.ok(has('Viscera Seer', 'Chasm Skulker', 'enable'), 'effet à sa propre mort');
  assert.ok(!has('Sol Ring', 'Blood Artist'));
});

test('clignotement et doubleur d\'arrivée', () => {
  assert.ok(has('Ephemerate', 'Mulldrifter', 'enable'));
  assert.ok(has('Ephemerate', 'Elvish Visionary', 'enable'), '"this creature" reconnu');
  assert.ok(!has('Ephemerate', 'Llanowar Elves'));
  assert.ok(has('Mulldrifter', 'Panharmonicon', 'amplify'));
  assert.ok(has('Soul Warden', 'Panharmonicon', 'amplify'));
  assert.ok(!has('Llanowar Elves', 'Panharmonicon'));
});

test('jetons et marqueurs', () => {
  assert.ok(has('Ghave, Guru of Spores', 'Doubling Season', 'amplify'));
  assert.ok(has('Avenger of Zendikar', 'Doubling Season', 'amplify'));
  assert.ok(!has('Sol Ring', 'Doubling Season'));
  assert.ok(has('Ajani\'s Pridemate', 'Hardened Scales', 'amplify'));
  assert.ok(has('Ajani\'s Pridemate', 'Doubling Season', 'amplify'), 'marqueurs génériques');
  assert.ok(has('Avenger of Zendikar', 'Ghave, Guru of Spores', 'enable'), 'marqueurs -> Ghave');
});

test('terrains et rampe -> Landfall', () => {
  assert.ok(has('Forest', 'Avenger of Zendikar', 'trigger'));
  assert.ok(has('Cultivate', 'Avenger of Zendikar', 'trigger'));
  assert.ok(has('Turntimber Symbiosis // Turntimber, Serpentine Wood', 'Avenger of Zendikar', 'trigger'), 'face terrain d\'une MDFC');
  assert.ok(!has('Sol Ring', 'Avenger of Zendikar'));
});

test('sorts lancés, pioche, tribal', () => {
  assert.ok(has('Ephemerate', 'Young Pyromancer', 'trigger'));
  assert.ok(has('Cultivate', 'Young Pyromancer', 'trigger'));
  assert.ok(!has('Sol Ring', 'Young Pyromancer'));
  assert.ok(has('Mulldrifter', 'Chasm Skulker', 'trigger'));
  assert.ok(has('Skullclamp', 'Chasm Skulker', 'trigger'));
  assert.ok(!has('Smothering Tithe', 'Chasm Skulker'), 'la pioche adverse ne compte pas');
  assert.ok(has('Llanowar Elves', 'Elvish Archdruid', 'tribal'));
  assert.ok(has('Elvish Visionary', 'Elvish Archdruid', 'tribal'));
  assert.ok(!has('Forest', 'Cultivate'), 'pas de tribal sur les types de terrain');
});

test('enchantement-créature non-créature (Purphoros) écoute bien les arrivées', () => {
  assert.ok(has('Llanowar Elves', 'Purphoros, God of the Forge', 'trigger'));
});

test('rôles décrits', () => {
  assert.ok(roles[byName('Soul Warden')].listens.includes("Arrivée d'un permanent"));
  assert.ok(roles[byName('Viscera Seer')].provides.includes('Sacrifie'));
});

test('aucune boucle sur soi-même', () => {
  assert.ok(!suggestions.some((s) => s.from === s.to));
});

// ---------------------------------------------------------------- descripteurs
test('descripteurs : refus des formulations non comprises', () => {
  const ctx = { subToCanon: new Map([['elf', 'elf'], ['elves', 'elf']]), creatureSubs: new Set(['elf']), nonLandSubs: new Set(['elf']) };
  assert.equal(parseDescriptor('a creature with a funny ability', ctx), null);
  assert.equal(parseDescriptor('equipped creature', ctx), null);
  assert.ok(parseDescriptor('a creature an opponent controls', ctx).opponent);
  const d = parseDescriptor('another Elf you control', ctx);
  assert.ok(d && d.pred);
  const elf = { types: new Set(['creature']), supers: new Set(), subs: new Set(['elf']), colors: new Set(['G']), power: 1, toughness: 1, mv: 1, token: false, keywords: new Set(), changeling: false, generic: false };
  const gob = { ...elf, subs: new Set(['goblin']) };
  assert.equal(d.pred(elf), true);
  assert.equal(d.pred(gob), false);
  assert.equal(d.pred({ ...gob, changeling: true }), true);
  const e = parseDescriptor('one or more other nontoken creatures you control', ctx);
  assert.equal(e.pred(elf), true);
  assert.equal(e.pred({ ...elf, token: true }), false);
});

// ---------------------------------------------------------------- fusion
test('fusion des liens : statuts conservés, liens manuels gardés, cartes retirées purgées', () => {
  const sug = [{ from: 'a', to: 'b', kind: 'trigger', reasons: [] }, { from: 'b', to: 'c', kind: 'trigger', reasons: [] }];
  let links = mergeLinks([], sug, ['a', 'b', 'c']);
  assert.equal(links.length, 2);
  links[0].status = 'accepted';
  links[1].status = 'rejected';
  links.push({ id: 'm1', from: 'c', to: 'a', kind: 'combo', origin: 'manual', status: 'accepted', reasons: [] });
  const again = mergeLinks(links, sug, ['a', 'b', 'c']);
  assert.equal(again.find((l) => l.from === 'a').status, 'accepted');
  assert.equal(again.find((l) => l.from === 'b').status, 'rejected');
  assert.ok(again.find((l) => l.id === 'm1'));
  const removed = mergeLinks(again, [sug[0]], ['a', 'b']);
  assert.equal(removed.length, 1);
});

test('boucles détectées', () => {
  const loops = findLoops(['a', 'b', 'c', 'd'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, { from: 'c', to: 'd' }]);
  assert.equal(loops.length, 1);
  assert.deepEqual(loops[0].sort(), ['a', 'b', 'c']);
});

test('normalisation : MDFC avec deux faces et images par face', () => {
  const m = deckCards.find((c) => c.layout === 'modal_dfc');
  assert.equal(m.faces.length, 2);
  assert.equal(m.images.en.length, 2);
  assert.equal(m.faces[1].typeLine, 'Land');
});
