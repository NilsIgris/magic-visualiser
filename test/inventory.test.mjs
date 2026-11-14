// Répartition des exemplaires entre les decks (onglet Inventaire, version 1.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { usageIndex, cardStatus, deckOwnership, summarizeOwnership, inventoryRows, shoppingList, fitsIdentity, isBasicLand } from '../src/shared/inventory.js';

const cards = {
  sol: { name: 'Sol Ring', typeLine: 'Artifact', colorIdentity: [] },
  bolt: { name: 'Lightning Bolt', typeLine: 'Instant', colorIdentity: ['R'] },
  tutor: { name: 'Demonic Tutor', typeLine: 'Sorcery', colorIdentity: ['B'] },
  forest: { name: 'Forest', typeLine: 'Basic Land — Forest', colorIdentity: ['G'] },
};
const deck = (id, name, built, list) => ({ id, name, built, cards, entries: list.map(([oracleId, qty, zone = 'main']) => ({ oracleId, qty, zone })) });
const A = deck('A', 'Alpha', false, [['sol', 1], ['bolt', 1], ['tutor', 1], ['forest', 10]]);
const B = deck('B', 'Beta', true, [['sol', 1], ['bolt', 1, 'side']]);
const C = deck('C', 'Gamma', false, [['sol', 1], ['tutor', 1, 'maybe']]);

test('index d\'utilisation : seules les zones Commandant et Deck réservent', () => {
  const { byCard } = usageIndex([A, B, C]);
  assert.deepEqual(byCard.get('sol').map((d) => d.deckId), ['B', 'A', 'C'], 'decks montés en premier');
  assert.deepEqual(byCard.get('bolt').map((d) => d.deckId), ['A'], 'réserve ignorée');
  assert.deepEqual(byCard.get('tutor').map((d) => d.deckId), ['A'], '« Peut-être » ignoré');
});

test('statut d\'une carte pour un deck', () => {
  const o = (name, qty, built = false) => ({ deckId: name, name, qty, built });
  assert.equal(cardStatus(0, 1, []).status, 'missing');
  assert.equal(cardStatus(0, 1, []).missing, 1);
  assert.equal(cardStatus(1, 1, []).status, 'free');
  assert.equal(cardStatus(3, 1, [o('Y', 1), o('Z', 1)]).status, 'free');
  // 1 exemplaire, rangé dans un deck monté : il faut l'y reprendre
  const inOther = cardStatus(1, 1, [o('Y', 1, true)]);
  assert.equal(inOther.status, 'inOther');
  assert.deepEqual(inOther.takeFrom.map((x) => x.name), ['Y']);
  // 1 exemplaire, demandé aussi par un deck non monté : partagée, Z en manquera
  const shared = cardStatus(1, 1, [o('Z', 1)]);
  assert.equal(shared.status, 'shared');
  assert.deepEqual(shared.shortIn.map((x) => x.name), ['Z']);
  assert.equal(shared.shortBy, 1);
  // 2 exemplaires, 3 demandes (ici + Y monté + Z) : Y garde le sien, il en reste 1 pour ici, Z en manque
  const s2 = cardStatus(2, 1, [o('Y', 1, true), o('Z', 1)]);
  assert.equal(s2.status, 'shared');
  assert.deepEqual(s2.shortIn.map((x) => x.name), ['Z']);
  // 2 exemplaires, tous deux dans des decks montés
  const s3 = cardStatus(2, 1, [o('Y', 1, true), o('W', 1, true)]);
  assert.equal(s3.status, 'inOther');
  assert.equal(s3.shortBy, 1);
  // manque, alors qu'un exemplaire est dans un deck monté
  const s4 = cardStatus(1, 2, [o('Y', 1, true)]);
  assert.equal(s4.status, 'missing');
  assert.equal(s4.missing, 1);
});

test('situation d\'un deck complet', () => {
  const { byCard } = usageIndex([A, B, C]);
  const coll = { cards: { sol: { qty: 1 }, bolt: { qty: 1 } } };
  const rows = deckOwnership(A, coll, byCard);
  const by = Object.fromEntries(rows.map((r) => [r.oracleId, r]));
  assert.equal(by.sol.status, 'inOther', 'le seul Sol Ring est dans Beta (monté)');
  assert.equal(by.bolt.status, 'free');
  assert.equal(by.tutor.status, 'missing');
  assert.ok(!by.forest, 'terrains de base considérés possédés');
  assert.equal(deckOwnership(A, coll, byCard, { basicsOwned: false }).find((r) => r.oracleId === 'forest').missing, 10);
  assert.deepEqual(summarizeOwnership(rows), { free: 1, shared: 0, inOther: 1, missing: 1, missingCopies: 1 });
  // Beta (monté) garde son Sol Ring : pour Beta, Alpha et Gamma en manqueront
  const rb = deckOwnership(B, coll, byCard).find((r) => r.oracleId === 'sol');
  assert.equal(rb.status, 'shared');
  assert.deepEqual(rb.shortIn.map((x) => x.name), ['Alpha', 'Gamma']);
});

test('lignes d\'inventaire et liste d\'achats', () => {
  const { byCard, cardInfo } = usageIndex([A, B, C]);
  const coll = { cards: { sol: { qty: 2 }, bolt: { qty: 3 }, extra: { qty: 1 } } };
  const rows = Object.fromEntries(inventoryRows(coll, byCard).map((r) => [r.oracleId, r]));
  assert.equal(rows.sol.status, 'conflict');
  assert.equal(rows.sol.need, 3);
  assert.equal(rows.bolt.status, 'free');
  assert.equal(rows.bolt.available, 2);
  assert.equal(rows.extra.status, 'unused');
  const withBasics = { cards: { forest: { qty: 4, card: cards.forest } } };
  const fr = inventoryRows(withBasics, byCard)[0];
  assert.equal(fr.status, 'free', 'terrain de base possédé sans limite');
  assert.equal(inventoryRows(withBasics, byCard, { basicsOwned: false })[0].status, 'conflict');
  const shop = shoppingList(coll, byCard, cardInfo);
  assert.deepEqual(shop.map((s) => [s.name, s.missing]), [['Demonic Tutor', 1], ['Sol Ring', 1]]);
  const shopA = shoppingList(coll, byCard, cardInfo, { deckId: 'A' });
  assert.deepEqual(shopA.map((s) => s.name), ['Demonic Tutor'], 'pour Alpha seul, Sol Ring est possédé');
  assert.equal(shoppingList({ cards: {} }, byCard, cardInfo, { basicsOwned: false }).find((s) => s.name === 'Forest').missing, 10);
});

test('identité couleur et terrains de base', () => {
  assert.equal(fitsIdentity(cards.bolt, new Set(['R', 'G'])), true);
  assert.equal(fitsIdentity(cards.tutor, new Set(['R', 'G'])), false);
  assert.equal(fitsIdentity(cards.sol, new Set()), true);
  assert.equal(fitsIdentity(cards.tutor, null), true);
  assert.equal(isBasicLand(cards.forest), true);
  assert.equal(isBasicLand(cards.sol), false);
});
