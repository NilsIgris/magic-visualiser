// Fonctions de la version 1.1 : probabilités, comparaison, collection, bracket, groupes, versions, Spellbook.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hyperPmf, hyperAtLeast, cardsSeen, shuffle } from '../src/shared/prob.js';
import { diffDecks, missingCards } from '../src/shared/diff.js';
import { estimateBracket, localFlags } from '../src/shared/bracket.js';
import { groupLinks, membersOf, groupScore, isWeakPending } from '../src/shared/grouping.js';
import { parseDeckText } from '../src/shared/parser.js';
import { preferredImages, displayName } from '../src/shared/normalize.js';
import { Storage } from '../src/main/storage.js';
import { SpellbookClient, slimSpellbook } from '../src/main/spellbook.js';
import { ScryfallClient } from '../src/main/scryfall.js';
import { resolveItems, MemoryCache } from '../src/main/resolve.js';
import { startMock } from './mock-scryfall.mjs';
import { newerVersion } from '../src/shared/version.js';
import { CARDS } from './fixtures/cards.mjs';

test('loi hypergéométrique : valeurs connues', () => {
  // 1 carte précise dans 99 : P(l'avoir dans 7) = 7/99
  assert.ok(Math.abs(hyperAtLeast(99, 1, 7, 1) - 7 / 99) < 1e-12);
  // somme des probabilités = 1
  const s = Array.from({ length: 8 }, (_, k) => hyperPmf(99, 37, 7, k)).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(s - 1) < 1e-12);
  // cas limites
  assert.equal(hyperAtLeast(99, 0, 7, 1), 0);
  assert.equal(hyperAtLeast(99, 99, 7, 7), 1);
  assert.equal(hyperPmf(10, 3, 5, 4), 0);
  assert.equal(cardsSeen(1, true), 8);
  assert.equal(cardsSeen(1, false), 7);
  const sh = shuffle([1, 2, 3, 4, 5], () => 0.5);
  assert.deepEqual([...sh].sort(), [1, 2, 3, 4, 5]);
});

test('comparaison de versions : ajouts, retraits, déplacements', () => {
  const cards = { a: { name: 'Alpha' }, b: { name: 'Beta' }, c: { name: 'Gamma' } };
  const A = { cards, entries: [{ oracleId: 'a', zone: 'main', qty: 1 }, { oracleId: 'b', zone: 'main', qty: 1 }, { oracleId: 'c', zone: 'main', qty: 10 }] };
  const B = { cards, entries: [{ oracleId: 'a', zone: 'maybe', qty: 1 }, { oracleId: 'c', zone: 'main', qty: 12 }] };
  const d = diffDecks(A, B);
  assert.deepEqual(d.removed.map((r) => [r.name, r.qty]), [['Beta', 1]]);
  assert.deepEqual(d.added.map((r) => [r.name, r.qty]), [['Gamma', 2]]);
  assert.deepEqual(d.moved.map((r) => [r.name, r.from, r.to]), [['Alpha', 'main', 'maybe']]);
  assert.equal(d.same, 10);
});

test('cartes manquantes : quantités, terrains de base', () => {
  const deck = { cards: { a: { name: 'Sol Ring', typeLine: 'Artifact' }, f: { name: 'Forest', typeLine: 'Basic Land — Forest' } }, entries: [{ oracleId: 'a', zone: 'main', qty: 1 }, { oracleId: 'f', zone: 'main', qty: 10 }, { oracleId: 'a', zone: 'side', qty: 3 }] };
  assert.deepEqual(missingCards(deck, { cards: {} }).map((m) => m.name), ['Sol Ring'], 'réserve ignorée, terrains de base possédés');
  assert.equal(missingCards(deck, { cards: {} }, { basicsOwned: false }).length, 2);
  assert.equal(missingCards(deck, { cards: { a: { qty: 1 } } }).length, 0);
  assert.equal(missingCards(deck, { cards: { f: { qty: 4 } } }, { basicsOwned: false }).find((m) => m.name === 'Forest').missing, 6);
});

test('bracket minimal', () => {
  const base = { gameChangers: [], twoCardCombos: 0, massLandDenial: [], extraTurns: [] };
  assert.equal(estimateBracket(base).min, 1);
  assert.equal(estimateBracket({ ...base, extraTurns: ['Time Warp'] }).min, 2);
  assert.equal(estimateBracket({ ...base, gameChangers: ['A', 'B', 'C'] }).min, 3);
  assert.equal(estimateBracket({ ...base, gameChangers: ['A', 'B', 'C', 'D'] }).min, 4);
  assert.equal(estimateBracket({ ...base, twoCardCombos: 1 }).min, 3);
  assert.equal(estimateBracket({ ...base, massLandDenial: ['Armageddon'] }).min, 4);
  assert.equal(estimateBracket({ ...base, twoCardCombos: null }).unknownCombos, true);
  const f = localFlags([{ name: 'Time Warp', oracleText: 'Target player takes an extra turn after this one.' }, { name: 'Armageddon', oracleText: 'Destroy all lands.' }, { name: 'Sol Ring', oracleText: '{T}: Add {C}{C}.' }]);
  assert.deepEqual(f, { extraTurns: ['Time Warp'], massLandDenial: ['Armageddon'] });
});

test('groupes de liens', () => {
  const mk = (i, to, rule, score = 20, status = 'pending') => ({ id: `l${i}`, from: `s${i}`, to, kind: 'trigger', origin: 'auto', status, reasons: [{ rule }], score });
  const links = [1, 2, 3, 4, 5].map((i) => mk(i, 'T', 'etb')).concat([mk(6, 'U', 'etb', 60), mk(7, 'T', 'dies', 70)]);
  links.push({ id: 'm1', from: 's1', to: 'T', kind: 'trigger', origin: 'manual', status: 'accepted', reasons: [] });
  const { groups, singles } = groupLinks(links);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 5);
  assert.equal(singles.length, 3, 'liens rares et manuels non groupés');
  assert.equal(membersOf(groups[0].id, links).length, 5);
  assert.ok(groupScore(groups[0]) > 20, 'la relation d\'ensemble vaut plus qu\'un lien isolé');
  assert.ok(isWeakPending(links[0]));
  assert.ok(!isWeakPending(links[5]));
  assert.ok(!isWeakPending(links[7]), 'lien manuel jamais masqué');
  const bySource = groupLinks([1, 2, 3, 4].map((i) => ({ id: `x${i}`, from: 'E', to: `t${i}`, kind: 'enable', origin: 'auto', status: 'pending', reasons: [{ rule: 'blink' }] })));
  assert.equal(bySource.groups[0].side, 'from');
});

test('CSV avec colonne Scryfall ID (ManaBox)', () => {
  const t = 'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID\nSol Ring,c21,Commander 2021,263,normal,uncommon,2,1,4cbc6901-6a4a-4d0a-83ea-7eefa3b35021';
  const r = parseDeckText(t);
  assert.equal(r.items[0].qty, 2);
  assert.equal(r.items[0].sid, '4cbc6901-6a4a-4d0a-83ea-7eefa3b35021');
});

test('impression choisie : visuel et nom prioritaires', () => {
  const card = { name: 'Sol Ring', printedName: 'Anneau solaire', images: { en: [{ normal: 'en' }], fr: [{ normal: 'fr' }] }, chosenPrint: { lang: 'en', images: [{ normal: 'chosen' }] } };
  assert.equal(preferredImages(card, 'fr')[0].normal, 'chosen');
  assert.equal(displayName(card, 'fr'), 'Anneau solaire');
  card.chosenPrint = { lang: 'fr', printedName: 'Anneau du soleil', images: [{ normal: 'c2' }] };
  assert.equal(displayName(card, 'fr'), 'Anneau du soleil');
  delete card.chosenPrint;
  assert.equal(preferredImages(card, 'fr')[0].normal, 'fr');
});

test('versions et collection sur disque', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgdl-st-'));
  const st = new Storage(dir);
  await st.init();
  const deck = { id: '11111111-2222-4333-8444-555555555555', name: 'Test', entries: [{ oracleId: 'a', zone: 'main', qty: 3 }], cards: { a: { name: 'A' } }, links: [], piles: [] };
  await st.saveDeck(deck);
  const v = await st.saveVersion(deck.id, { name: 'V1', deck });
  for (let i = 0; i < 12; i++) await st.saveVersion(deck.id, { name: `auto ${i}`, deck, auto: true });
  const list = await st.listVersions(deck.id);
  assert.equal(list.filter((x) => x.auto).length, 10, 'versions automatiques limitées à 10');
  assert.ok(list.some((x) => x.vid === v.vid && x.count === 3));
  const full = await st.loadVersion(deck.id, v.vid);
  assert.equal(full.deck.entries[0].qty, 3);
  await assert.rejects(st.loadVersion(deck.id, '../etc'), /invalide/);
  await st.deleteVersion(deck.id, v.vid);
  assert.ok(!(await st.listVersions(deck.id)).some((x) => x.vid === v.vid));
  const c = await st.saveCollection({ cards: { a: { qty: 2, name: 'A' } } });
  assert.equal((await st.getCollection()).cards.a.qty, 2);
  assert.ok(c.updatedAt);
  await st.deleteDeck(deck.id);
  assert.ok(!fs.existsSync(st.versionsDir(deck.id)), 'versions supprimées avec le deck');
});

test('Commander Spellbook (serveur simulé) et Scryfall ID', async () => {
  const mock = await startMock();
  try {
    const sb = new SpellbookClient({ fetchImpl: fetch, base: `${mock.base}/csb` });
    const req = { main: [{ card: 'Doubling Season', quantity: 1 }, { card: 'Blood Artist', quantity: 1 }, { card: 'Viscera Seer', quantity: 1 }, { card: 'Demonic Tutor', quantity: 1 }], commanders: [{ card: 'Ghave, Guru of Spores', quantity: 1 }] };
    const res = slimSpellbook(await sb.findMyCombos(req), await sb.estimateBracket(req));
    assert.equal(res.included.length, 1);
    assert.deepEqual(res.included[0].cards.map((c) => c.name), ['Ghave, Guru of Spores', 'Doubling Season']);
    assert.deepEqual(res.included[0].produces, ['Infinite Saproling creature tokens', 'Infinite death triggers']);
    assert.equal(res.almost.length, 1, 'il manque Reassembling Skeleton');
    assert.deepEqual(res.bracket.cards.map((c) => c.name), ['Demonic Tutor']);
    assert.equal(res.bracket.combos[0].definitelyTwoCard, true);
    const csbCalls = mock.log.filter((l) => l.path.startsWith('/csb/'));
    assert.ok(csbCalls.every((l) => l.ua && l.ua.startsWith('MTGDeckLab')), 'User-Agent nommé');

    const client = new ScryfallClient({ fetchImpl: fetch, base: mock.base, minDelay: 20 });
    const sol = CARDS.find((c) => c.name === 'Sol Ring');
    const r = await resolveItems(client, [{ name: 'nom quelconque', sid: sol.id }], { cache: new MemoryCache() });
    assert.equal([...r.resolved.values()][0].name, 'Sol Ring', 'résolu par Scryfall ID');
  } finally { await mock.close(); }
});

test('comparaison de versions', () => {
  assert.equal(newerVersion('1.2.0', '1.1.0'), true);
  assert.equal(newerVersion('1.1.0', '1.1.0'), false);
  assert.equal(newerVersion('v1.10.0', '1.9.3'), true);
  assert.equal(newerVersion('1.0.9', '1.1.0'), false);
});
