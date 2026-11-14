// Comparaison de deux listes (versions d'un deck, ou deux decks).

const ZONES = ['commander', 'main', 'side', 'maybe'];

/**
 * @param {{entries, cards}} a version de référence
 * @param {{entries, cards}} b version comparée
 * @returns {{added, removed, moved, same:number}} lignes { oracleId, name, qty, zone, from?, to? }
 */
export function diffDecks(a, b) {
  const count = (d) => {
    const m = new Map();
    for (const e of d.entries || []) {
      const k = `${e.oracleId}|${e.zone}`;
      m.set(k, (m.get(k) || 0) + e.qty);
    }
    return m;
  };
  const ca = count(a); const cb = count(b);
  const ids = new Set([...ca.keys(), ...cb.keys()].map((k) => k.split('|')[0]));
  const nameOf = (id) => ((b.cards || {})[id] || (a.cards || {})[id] || { name: '?' }).name;
  const added = []; const removed = []; const moved = [];
  let same = 0;
  for (const id of ids) {
    const plus = []; const minus = [];
    for (const z of ZONES) {
      const qa = ca.get(`${id}|${z}`) || 0; const qb = cb.get(`${id}|${z}`) || 0;
      same += Math.min(qa, qb);
      if (qb > qa) plus.push({ zone: z, qty: qb - qa });
      if (qa > qb) minus.push({ zone: z, qty: qa - qb });
    }
    // un exemplaire retiré d'une zone et ajouté dans une autre = déplacement
    while (plus.length && minus.length) {
      const p = plus[0]; const m = minus[0];
      const q = Math.min(p.qty, m.qty);
      moved.push({ oracleId: id, name: nameOf(id), qty: q, from: m.zone, to: p.zone });
      p.qty -= q; m.qty -= q;
      if (!p.qty) plus.shift();
      if (!m.qty) minus.shift();
    }
    for (const p of plus) added.push({ oracleId: id, name: nameOf(id), qty: p.qty, zone: p.zone });
    for (const m of minus) removed.push({ oracleId: id, name: nameOf(id), qty: m.qty, zone: m.zone });
  }
  const byName = (x, y) => x.name.localeCompare(y.name, 'fr');
  return { added: added.sort(byName), removed: removed.sort(byName), moved: moved.sort(byName), same };
}

/**
 * Cartes du deck (commandant + deck) qui manquent dans la collection.
 * @param {{entries, cards}} deck
 * @param {{cards: Object<string, {qty:number}>}} collection
 */
export function missingCards(deck, collection, { basicsOwned = true } = {}) {
  const need = new Map();
  for (const e of deck.entries || []) {
    if (e.zone !== 'commander' && e.zone !== 'main') continue;
    need.set(e.oracleId, (need.get(e.oracleId) || 0) + e.qty);
  }
  const out = [];
  for (const [id, n] of need) {
    const c = (deck.cards || {})[id];
    if (!c) continue;
    if (basicsOwned && /\bbasic\b/i.test(c.typeLine || '') && /\bland\b/i.test(c.typeLine || '')) continue;
    const own = ((collection && collection.cards) || {})[id] ? collection.cards[id].qty : 0;
    if (own < n) out.push({ oracleId: id, name: c.name, need: n, own, missing: n - own });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name, 'fr'));
}
