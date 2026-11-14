import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDeck, applyImport, relink, stats, validate, exportArena, exportSimple, exportCsv, mainType, loopsOf } from '../src/renderer/js/deckops.js';
import { parseDeckText } from '../src/shared/parser.js';
import { normalizeCard, normalizeToken } from '../src/shared/normalize.js';
import { itemKey } from '../src/main/resolve.js';
import { CARDS, TOKENS } from './fixtures/cards.mjs';

const tok = new Map(Object.values(TOKENS).map((t) => [t.id, normalizeToken(t)]));
const norm = (c) => { const n = normalizeCard(c); n.tokens = n.tokenRefs.map((i) => tok.get(i)).filter(Boolean); return n; };
const byName = new Map(CARDS.map((c) => [c.name, norm(c)]));

function deckFrom(text) {
  const parsed = parseDeckText(text);
  const resolved = new Map();
  const unresolved = [];
  for (const it of parsed.items) {
    const c = byName.get(it.name);
    if (c) resolved.set(itemKey(it), c); else unresolved.push(itemKey(it));
  }
  const d = emptyDeck('deck-test-0001', 'Test');
  applyImport(d, parsed.items, resolved, unresolved, 'add', itemKey);
  relink(d);
  return d;
}

const TEXT = `Commander\n1 Ghave, Guru of Spores\n\nDeck\n1 Soul Warden\n1 Blood Artist\n1 Viscera Seer\n10 Forest\n2 Sol Ring\n1 Mulldrifter\n1 Jeweled Lotus\n1 Inconnue\n\nSideboard\n1 Ephemerate`;

test('import : zones, quantités, introuvables, liens', () => {
  const d = deckFrom(TEXT);
  assert.equal(d.entries.find((e) => e.zone === 'commander').oracleId, byName.get('Ghave, Guru of Spores').oracleId);
  assert.equal(d.unresolved.length, 1);
  assert.equal(d.unresolved[0].name, 'Inconnue');
  assert.ok(d.links.length > 0);
  assert.ok(d.links.every((l) => l.status === 'pending'));
  // la réserve n'est pas analysée
  const eph = byName.get('Ephemerate').oracleId;
  assert.ok(!d.links.some((l) => l.from === eph || l.to === eph));
});

test('import en mode ajout fusionne les quantités, mode remplacement repart de zéro', () => {
  const d = deckFrom(TEXT);
  const parsed = parseDeckText('3 Forest');
  const res = new Map([[itemKey(parsed.items[0]), byName.get('Forest')]]);
  applyImport(d, parsed.items, res, [], 'add', itemKey);
  assert.equal(d.entries.find((e) => e.oracleId === byName.get('Forest').oracleId).qty, 13);
  applyImport(d, parsed.items, res, [], 'replace', itemKey);
  assert.equal(d.entries.length, 1);
  assert.equal(Object.keys(d.cards).length, 1, 'cartes orphelines purgées');
});

test('statistiques', () => {
  const d = deckFrom(TEXT);
  const s = stats(d);
  assert.equal(s.total, 1 + 1 + 1 + 1 + 10 + 2 + 1 + 1);
  assert.equal(s.lands, 10);
  assert.equal(s.creatures, 5);
  assert.equal(s.curve[1], 1 + 1 + 2); // Soul Warden, Viscera Seer, 2 Sol Ring
});

test('validation Commander : identité, bannie, singleton, total, introuvables', () => {
  const d = deckFrom(TEXT);
  const texts = validate(d).map((i) => i.text);
  assert.ok(texts.some((t) => t.includes('Hors de l\'identité')), 'Mulldrifter est bleu');
  assert.ok(texts.some((t) => t.includes('Bannie')), 'Jeweled Lotus');
  assert.ok(texts.some((t) => t.includes('2 exemplaires')), 'Sol Ring x2');
  assert.ok(!texts.some((t) => t.includes('Forest') || t.includes('10 exemplaires')), 'terrains de base illimités');
  assert.ok(texts.some((t) => t.includes('au lieu de 100')));
  assert.ok(texts.some((t) => t.includes('Inconnue')));
});

test('export Arena puis réimport : même contenu', () => {
  const d = deckFrom(TEXT);
  const txt = exportArena(d);
  assert.ok(txt.startsWith('Commander\n1 Ghave, Guru of Spores (TST)'));
  const back = parseDeckText(txt);
  const sum = (items, z) => items.filter((i) => i.zone === z).reduce((s, i) => s + i.qty, 0);
  assert.equal(sum(back.items, 'commander'), 1);
  assert.equal(sum(back.items, 'main'), 17);
  assert.equal(sum(back.items, 'side'), 1);
});

test('export simple et CSV', () => {
  const d = deckFrom(TEXT);
  const s = exportSimple(d, { nameLang: 'en' });
  assert.ok(s.includes('// Commandant\n1 Ghave, Guru of Spores'));
  const csv = exportCsv(d, { nameLang: 'en' });
  assert.ok(csv.includes('"Ghave, Guru of Spores"'), 'virgule protégée');
  const rows = parseDeckText(csv.replace(/^﻿/, '')).items;
  assert.equal(rows.length, d.entries.length);
});

test('type principal', () => {
  assert.equal(mainType(byName.get('Forest')), 'land');
  assert.equal(mainType(byName.get('Purphoros, God of the Forge')), 'creature');
  assert.equal(mainType(byName.get('Turntimber Symbiosis // Turntimber, Serpentine Wood')), 'sorcery');
});

test('boucles sur liens validés uniquement', () => {
  const d = deckFrom(TEXT);
  assert.equal(loopsOf(d).length, 0);
  for (const l of d.links) l.status = 'accepted';
  assert.ok(loopsOf(d).length >= 1, 'Soul Warden et Blood Artist se déclenchent mutuellement');
});
