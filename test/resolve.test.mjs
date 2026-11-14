import test from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-scryfall.mjs';
import { ScryfallClient } from '../src/main/scryfall.js';
import { resolveItems, MemoryCache, itemKey } from '../src/main/resolve.js';
import { parseDeckText } from '../src/shared/parser.js';

test('résolution EN + FR + édition + jetons + introuvables, débit respecté', async () => {
  const mock = await startMock();
  try {
    const client = new ScryfallClient({ fetchImpl: fetch, base: mock.base, minDelay: 100 });
    const cache = new MemoryCache();
    const text = `Commander\n1 Ghave, Guru of Spores\nDeck\n1 Rituel sombre\n1 artiste sanguinaire\n1 Sol Ring (tst) 8\n1 Turntimber Symbiosis\n1 Blod Artist\n1 Carte Qui N Existe Pas\n1 Krenko, Mob Boss`;
    const parsed = parseDeckText(text);
    const progress = [];
    const r = await resolveItems(client, parsed.items, { wantFr: true, cache, onProgress: (p) => progress.push(p.stage) });
    const get = (n) => r.resolved.get(itemKey(parsed.items.find((i) => i.name === n)));

    assert.equal(get('Ghave, Guru of Spores').name, 'Ghave, Guru of Spores');
    assert.equal(get('Ghave, Guru of Spores').tokens[0].name, 'Saproling', 'jeton récupéré');
    assert.equal(get('Rituel sombre').name, 'Dark Ritual', 'nom français résolu');
    assert.equal(get('Rituel sombre').printedName, 'Rituel sombre');
    assert.ok(get('Rituel sombre').images.fr[0].normal.includes('/img/normal/'));
    assert.ok(get('Rituel sombre').images.en[0].normal, 'visuel anglais aussi');
    assert.equal(get('artiste sanguinaire').name, 'Blood Artist', 'casse et accents ignorés');
    assert.equal(get('Sol Ring').name, 'Sol Ring');
    assert.equal(get('Sol Ring').printedName, 'Anneau solaire', 'impression FR trouvée pour une carte saisie en anglais');
    assert.equal(get('Turntimber Symbiosis').layout, 'modal_dfc', 'face avant d\'une MDFC');
    assert.equal(get('Blod Artist').name, 'Blood Artist', 'recherche approximative');
    assert.equal(get('Krenko, Mob Boss').printedName, null, 'pas d\'impression FR : repli anglais');
    assert.equal(r.unresolved.length, 1);
    assert.ok(r.unresolved[0].startsWith('carte qui n existe pas'));
    assert.ok(progress.includes('foreign') && progress.includes('french') && progress.includes('tokens'));

    // en-têtes et débit
    assert.ok(mock.log.every((l) => l.ua && l.ua.startsWith('MTGDeckLab') && l.accept));
    const gaps = mock.log.slice(1).map((l, i) => l.t - mock.log[i].t);
    assert.ok(Math.min(...gaps) >= 95, `écart minimal ${Math.min(...gaps)} ms`);

    // second passage : tout vient du cache
    const before = mock.log.length;
    const r2 = await resolveItems(client, parsed.items.filter((i) => !i.name.startsWith('Carte') && i.name !== 'Blod Artist'), { wantFr: true, cache });
    assert.equal(r2.unresolved.length, 0);
    assert.equal(mock.log.length, before, 'aucune requête quand tout est en cache');
  } finally {
    await mock.close();
  }
});
