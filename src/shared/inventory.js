// Inventaire : répartition des exemplaires possédés entre les decks. Module pur (testé).
//
// Modèle :
//  - un deck « monté » a ses cartes physiquement rangées dedans : ses exemplaires sont réservés en priorité ;
//  - la demande d'un deck = zones Commandant + Deck (la réserve et « Peut-être » ne réservent rien) ;
//  - les terrains de base peuvent être considérés comme possédés sans limite (réglage).

export function isBasicLand(card) {
  return !!card && /\bbasic\b/i.test(card.typeLine || '') && /\bland\b/i.test(card.typeLine || '');
}

/**
 * Index des cartes utilisées par chaque deck.
 * @param {Array<{id, name, built, entries, cards}>} decks
 * @returns {{byCard: Map<string, Array<{deckId, name, built, qty}>>, cardInfo: Map<string, object>}}
 */
export function usageIndex(decks) {
  const byCard = new Map();
  const cardInfo = new Map();
  for (const d of decks) {
    const per = new Map();
    for (const e of d.entries || []) {
      if (e.zone !== 'main' && e.zone !== 'commander') continue;
      per.set(e.oracleId, (per.get(e.oracleId) || 0) + (e.qty || 0));
      const c = (d.cards || {})[e.oracleId];
      if (c && !cardInfo.has(e.oracleId)) cardInfo.set(e.oracleId, c);
    }
    for (const [id, qty] of per) {
      if (!qty) continue;
      if (!byCard.has(id)) byCard.set(id, []);
      byCard.get(id).push({ deckId: d.id, name: d.name, built: !!d.built, qty });
    }
  }
  for (const list of byCard.values()) list.sort((a, b) => (b.built - a.built) || a.name.localeCompare(b.name, 'fr'));
  return { byCard, cardInfo };
}

export function ownedQty(collection, oracleId) {
  const e = collection && collection.cards ? collection.cards[oracleId] : null;
  return e ? e.qty || 0 : 0;
}

/**
 * Situation d'une carte pour un deck donné.
 * @param {number} owned exemplaires possédés
 * @param {number} need exemplaires demandés par ce deck
 * @param {Array<{deckId, name, built, qty}>} others demande des AUTRES decks
 * @returns {{status: 'free'|'shared'|'inOther'|'missing', missing:number, takeFrom:Array, shortIn:Array, shortBy:number, builtOthers:number, othersTotal:number}}
 *   free    : assez d'exemplaires pour ce deck et tous les autres
 *   shared  : assez pour ce deck, mais en la gardant ici d'autres decks (non montés) en manqueront
 *   inOther : tu la possèdes, mais les exemplaires sont rangés dans des decks montés : il faut les y reprendre
 *   missing : tu n'en possèdes pas assez, même en défaisant tes autres decks
 */
export function cardStatus(owned, need, others = []) {
  const othersTotal = others.reduce((s, o) => s + o.qty, 0);
  const builtList = others.filter((o) => o.built);
  const builtOthers = builtList.reduce((s, o) => s + o.qty, 0);
  const base = { missing: 0, takeFrom: [], shortIn: [], shortBy: 0, builtOthers, othersTotal };
  if (owned < need) return { ...base, status: 'missing', missing: need - owned, takeFrom: owned > 0 ? builtList : [] };
  if (owned - builtOthers < need) {
    // exemplaires libres insuffisants : il faut en reprendre dans des decks montés
    return { ...base, status: 'inOther', takeFrom: builtList, shortBy: need - Math.max(0, owned - builtOthers) };
  }
  const remaining = owned - builtOthers - need;
  const unbuiltNeed = othersTotal - builtOthers;
  if (unbuiltNeed > remaining) {
    return { ...base, status: 'shared', shortIn: others.filter((o) => !o.built), shortBy: unbuiltNeed - remaining };
  }
  return { ...base, status: 'free' };
}

/**
 * Situation de chaque carte (Commandant + Deck) d'un deck par rapport à l'inventaire et aux autres decks.
 * @param {{id, entries, cards}} deck
 */
export function deckOwnership(deck, collection, byCard, { basicsOwned = true } = {}) {
  const need = new Map();
  for (const e of deck.entries || []) {
    if (e.zone !== 'main' && e.zone !== 'commander') continue;
    need.set(e.oracleId, (need.get(e.oracleId) || 0) + e.qty);
  }
  const rows = [];
  for (const [id, n] of need) {
    const card = (deck.cards || {})[id];
    if (!card) continue;
    if (basicsOwned && isBasicLand(card)) continue;
    const others = (byCard.get(id) || []).filter((o) => o.deckId !== deck.id);
    const owned = ownedQty(collection, id);
    rows.push({ oracleId: id, name: card.name, need: n, owned, others, ...cardStatus(owned, n, others) });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export function summarizeOwnership(rows) {
  const s = { free: 0, shared: 0, inOther: 0, missing: 0, missingCopies: 0 };
  for (const r of rows) { s[r.status]++; s.missingCopies += r.missing; }
  return s;
}

/**
 * Lignes de l'inventaire avec l'utilisation par les decks.
 * status : 'unused' (aucun deck), 'free' (assez pour tous les decks), 'conflict' (pas assez pour tous les decks).
 */
export function inventoryRows(collection, byCard, { basicsOwned = true, cardOf = (e) => e.card } = {}) {
  const rows = [];
  for (const [id, entry] of Object.entries((collection && collection.cards) || {})) {
    const decks = byCard.get(id) || [];
    const need = decks.reduce((s, d) => s + d.qty, 0);
    const owned = entry.qty || 0;
    // terrains de base « possédés sans limite » : jamais en manque
    const basic = basicsOwned && isBasicLand(cardOf(entry, id));
    rows.push({
      oracleId: id, entry, owned, need, decks, basic,
      available: basic ? owned : Math.max(0, owned - need),
      status: need === 0 ? 'unused' : basic || owned >= need ? 'free' : 'conflict',
    });
  }
  return rows;
}

/**
 * Cartes à acquérir pour pouvoir monter tous les decks en même temps (ou un seul deck).
 * @param {{deckId?: string, basicsOwned?: boolean}} opts
 */
export function shoppingList(collection, byCard, cardInfo, { deckId = null, basicsOwned = true } = {}) {
  const out = [];
  for (const [id, decks] of byCard) {
    const card = cardInfo.get(id);
    if (!card) continue;
    if (basicsOwned && isBasicLand(card)) continue;
    const owned = ownedQty(collection, id);
    if (deckId) {
      const mine = decks.find((d) => d.deckId === deckId);
      if (!mine || mine.qty <= owned) continue;
      out.push({ oracleId: id, name: card.name, need: mine.qty, owned, missing: mine.qty - owned, decks: [mine] });
      continue;
    }
    const need = decks.reduce((s, d) => s + d.qty, 0);
    if (need > owned) out.push({ oracleId: id, name: card.name, need, owned, missing: need - owned, decks });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** La carte entre-t-elle dans l'identité couleur (null = identité inconnue, tout passe) ? */
export function fitsIdentity(card, identity) {
  if (!identity) return true;
  return (card.colorIdentity || []).every((c) => identity.has(c));
}
