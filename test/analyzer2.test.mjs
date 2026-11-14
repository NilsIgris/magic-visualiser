// Règles ajoutées en 1.1 : tuteurs, protection, réducteurs, équipements, anti-synergies, rôles, score.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDeck, scoreLevel, specificity } from '../src/shared/analyzer.js';
import { normalizeCard, normalizeToken } from '../src/shared/normalize.js';
import { CARDS, TOKENS } from './fixtures/cards.mjs';

const tok = new Map(Object.values(TOKENS).map((t) => [t.id, normalizeToken(t)]));
const deckCards = CARDS.map((c) => { const n = normalizeCard(c); n.tokens = n.tokenRefs.map((i) => tok.get(i)).filter(Boolean); return n; });
const id = (n) => deckCards.find((c) => c.name === n).oracleId;
const ghave = id('Ghave, Guru of Spores');
const { suggestions, roles } = analyzeDeck(deckCards, { commanderIds: [ghave] });
const has = (a, b, kind) => suggestions.some((s) => s.from === id(a) && s.to === id(b) && (!kind || s.kind === kind));
const fns = (n) => roles[id(n)].functions.map((f) => f.key).sort();

test('tuteurs : cible les cartes correspondantes, pas les tuteurs génériques', () => {
  assert.ok(has('Worldly Tutor', 'Soul Warden', 'tutor'));
  assert.ok(has('Worldly Tutor', 'Avenger of Zendikar', 'tutor'));
  assert.ok(!has('Worldly Tutor', 'Sol Ring'));
  assert.ok(!suggestions.some((s) => s.from === id('Demonic Tutor') && s.kind === 'tutor'), 'Demonic Tutor : pas 99 liens');
  assert.ok(!suggestions.some((s) => s.from === id('Cultivate') && s.kind === 'tutor'), 'chercher un terrain = rampe');
});

test('protection : vers le commandant seulement', () => {
  assert.ok(has('Swiftfoot Boots', 'Ghave, Guru of Spores', 'protect'));
  assert.ok(has('Heroic Intervention', 'Ghave, Guru of Spores', 'protect'));
  assert.ok(!has('Swiftfoot Boots', 'Soul Warden'));
  assert.ok(!has('Swords to Plowshares', 'Ghave, Guru of Spores'));
  assert.ok(!has('Skullclamp', 'Ghave, Guru of Spores'), '+1/-1 n\'est pas un renfort');
});

test('réducteur de coût : sorts du bon type', () => {
  assert.ok(has('Etherium Sculptor', 'Sol Ring', 'enable'));
  assert.ok(has('Etherium Sculptor', 'Skullclamp', 'enable'));
  assert.ok(!has('Etherium Sculptor', 'Soul Warden', 'enable'), 'une créature non-artefact');
  assert.ok(!has('Etherium Sculptor', 'Etherium Sculptor'));
});

test('anti-synergies symétriques', () => {
  assert.ok(has('Rest in Peace', 'Blood Artist', 'anti'), 'plus de morts');
  assert.ok(has('Rest in Peace', 'Eternal Witness', 'anti'), 'cimetière vide');
  assert.ok(has('Rest in Peace', 'Reanimate', 'anti'));
  assert.ok(!has('Rest in Peace', 'Sol Ring'));
  assert.ok(!has('Rest in Peace', 'Turntimber Symbiosis // Turntimber, Serpentine Wood'), 'met en jeu depuis la bibliothèque');
  assert.ok(has('Torpor Orb', 'Soul Warden', 'anti'));
  assert.ok(has('Torpor Orb', 'Mulldrifter', 'anti'));
  assert.ok(!has('Torpor Orb', 'Blood Artist'));
  assert.ok(has('Stony Silence', 'Sol Ring', 'anti'));
  assert.ok(has('Stony Silence', 'Skullclamp', 'anti'), "équiper est une capacité activée");
  assert.ok(has('Stony Silence', 'Arcane Signet', 'anti'));
  assert.ok(!has('Stony Silence', 'Panharmonicon'), 'pas de capacité activée');
});

test('« Its controller gains life » ne compte pas comme ton gain de vie', () => {
  assert.ok(!has('Swords to Plowshares', "Ajani's Pridemate"));
});

test('rôles fonctionnels', () => {
  assert.deepEqual(fns('Sol Ring'), ['ramp']);
  assert.deepEqual(fns('Arcane Signet'), ['ramp']);
  assert.deepEqual(fns('Llanowar Elves'), ['ramp']);
  assert.deepEqual(fns('Cultivate'), ['ramp']);
  assert.deepEqual(fns('Etherium Sculptor'), ['ramp']);
  assert.deepEqual(fns('Smothering Tithe'), ['ramp']);
  assert.deepEqual(fns('Dark Ritual'), [], 'rituel : pas de la rampe durable');
  assert.deepEqual(fns('Mulldrifter'), ['draw']);
  assert.deepEqual(fns('Rhystic Study'), ['draw']);
  assert.deepEqual(fns('Skullclamp'), ['draw']);
  assert.deepEqual(fns('Chasm Skulker'), [], 'réagit à la pioche, ne pioche pas');
  assert.deepEqual(fns('Elvish Visionary'), [], 'une seule carte à l\'arrivée');
  assert.deepEqual(fns('Swords to Plowshares'), ['removal']);
  assert.deepEqual(fns('Counterspell'), ['removal']);
  assert.deepEqual(fns('Ephemerate'), [], 'vise ta propre créature');
  assert.deepEqual(fns('Wrath of God'), ['wipe']);
  assert.deepEqual(fns('Demonic Tutor'), ['tutor']);
  assert.deepEqual(fns('Worldly Tutor'), ['tutor']);
  assert.deepEqual(fns('Heroic Intervention'), ['protection']);
  assert.deepEqual(fns('Swiftfoot Boots'), ['protection']);
  assert.deepEqual(fns('Eternal Witness'), ['recursion']);
  assert.deepEqual(fns('Reanimate'), ['recursion']);
  assert.deepEqual(fns('Forest'), []);
  assert.deepEqual(fns('Evolving Wilds'), [], 'terrain');
});

test('score : un lien rare pèse plus qu\'un lien partagé par vingt cartes', () => {
  const get = (a, b) => suggestions.find((s) => s.from === id(a) && s.to === id(b));
  const rare = get('Soul Warden', "Ajani's Pridemate");
  const common = get('Llanowar Elves', "Cathars' Crusade");
  assert.ok(rare.score > common.score, `${rare.score} > ${common.score}`);
  assert.equal(scoreLevel(rare.score), 'strong');
  assert.equal(scoreLevel(common.score), 'weak');
  assert.ok(suggestions.every((s) => Number.isInteger(s.score) && s.score >= 0 && s.score <= 100));
  assert.equal(specificity(1), 1);
  assert.ok(specificity(16) < specificity(2));
});
