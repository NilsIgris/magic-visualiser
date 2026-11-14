// Client Commander Spellbook (https://commanderspellbook.com), d'après le client OpenAPI officiel
// @space-cow-media/spellbook-client 7.3.4 : POST /find-my-combos et POST /estimate-bracket,
// corps { main: [{card, quantity}], commanders: [{card, quantity}] }, réponses en camelCase.
// Consignes de l'API : requêtes rares, User-Agent nommé, gérer les 429, créditer Commander Spellbook.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SpellbookClient {
  constructor({ fetchImpl, base = 'https://backend.commanderspellbook.com', userAgent = 'MTGDeckLab/1.0', timeout = 30000 } = {}) {
    this.fetch = fetchImpl;
    this.base = base.replace(/\/$/, '');
    this.userAgent = userAgent;
    this.timeout = timeout;
  }

  async post(path, body) {
    const url = path.startsWith('http') ? path : this.base + path;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeout);
      let res;
      try {
        res = await this.fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        if (attempt < 1) { await sleep(1500); continue; }
        throw new Error(`Impossible de joindre Commander Spellbook (${e.name === 'AbortError' ? 'délai dépassé' : e.message}).`);
      } finally { clearTimeout(timer); }
      if (res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      if (!res.ok) throw new Error(`Commander Spellbook a refusé la requête (HTTP ${res.status}).`);
      return json;
    }
    throw new Error('Commander Spellbook limite le nombre de requêtes. Réessaie dans une minute.');
  }

  /** Combos présentes dans le deck et combos à une carte près. */
  async findMyCombos(deckRequest) {
    const merged = { identity: '', included: [], almostIncluded: [] };
    let url = '/find-my-combos';
    for (let page = 0; page < 4 && url; page++) {
      const json = await this.post(url, deckRequest);
      const r = (json && json.results) || {};
      merged.identity = r.identity || merged.identity;
      merged.included.push(...(r.included || []));
      merged.almostIncluded.push(...(r.almostIncluded || []));
      url = json && json.next ? json.next : null;
    }
    return merged;
  }

  async estimateBracket(deckRequest) {
    return this.post('/estimate-bracket', deckRequest);
  }
}

function slimVariant(v) {
  return {
    id: String(v.id),
    cards: (v.uses || []).map((u) => ({ name: u.card && u.card.name, oracleId: u.card && u.card.oracleId, mustBeCommander: !!u.mustBeCommander, zones: u.zoneLocations || [] })),
    templates: (v.requires || []).map((t) => t.template && t.template.name).filter(Boolean),
    produces: (v.produces || []).map((p) => p.feature && p.feature.name).filter(Boolean),
    description: v.description || '',
    easyPrerequisites: v.easyPrerequisites || '',
    notablePrerequisites: v.notablePrerequisites || '',
    manaNeeded: v.manaNeeded || '',
    popularity: v.popularity ?? null,
    bracketTag: v.bracketTag || null,
  };
}

/** Réduit les réponses à ce que l'application affiche et enregistre. */
export function slimSpellbook(combos, bracket) {
  const pop = (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0);
  return {
    fetchedAt: new Date().toISOString(),
    identity: combos.identity || '',
    included: combos.included.map(slimVariant).sort(pop),
    almost: combos.almostIncluded.map(slimVariant).sort(pop).slice(0, 40),
    bracket: bracket ? {
      tag: bracket.bracketTag || null,
      cards: (bracket.cards || []).map((c) => ({ name: c.card && c.card.name, oracleId: c.card && c.card.oracleId, gameChanger: !!c.gameChanger, massLandDenial: !!c.massLandDenial, extraTurn: !!c.extraTurn, banned: !!c.banned }))
        .filter((c) => c.gameChanger || c.massLandDenial || c.extraTurn || c.banned),
      combos: (bracket.combos || []).map((c) => ({ id: String(c.combo && c.combo.id), definitelyTwoCard: !!c.definitelyTwoCard, arguablyTwoCard: !!c.arguablyTwoCard, relevant: !!c.relevant, speed: c.speed ?? null, massLandDenial: !!c.massLandDenial, extraTurn: !!c.extraTurn, lock: !!c.lock })),
    } : null,
  };
}
