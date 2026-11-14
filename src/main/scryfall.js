// Client Scryfall : débit limité (≥ 100 ms entre requêtes), en-têtes obligatoires,
// reprises sur 429 / 5xx. Aucune dépendance à Electron (testable sous Node).

export class ScryfallError extends Error {
  constructor(message, status, details) { super(message); this.status = status; this.details = details; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ScryfallClient {
  constructor({ fetchImpl, base = 'https://api.scryfall.com', userAgent = 'MTGDeckLab/1.0', minDelay = 110, timeout = 20000 } = {}) {
    this.fetch = fetchImpl;
    this.base = base.replace(/\/$/, '');
    this.userAgent = userAgent;
    this.minDelay = minDelay;
    this.timeout = timeout;
    this.last = 0;
    this.chain = Promise.resolve();
  }

  /** Les requêtes sont sérialisées pour respecter le délai demandé par Scryfall. */
  request(path, opts = {}) {
    const run = () => this._do(path, opts);
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  async _do(path, { method = 'GET', body, allow404 = true } = {}) {
    const url = path.startsWith('http') ? path : this.base + path;
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = this.last + this.minDelay - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeout);
      let res;
      try {
        res = await this.fetch(url, {
          method,
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/json;q=0.9,*/*;q=0.8',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        this.last = Date.now();
        if (attempt < 2) { await sleep(800 * (attempt + 1)); continue; }
        throw new ScryfallError(`Impossible de joindre Scryfall (${e.name === 'AbortError' ? 'délai dépassé' : e.message}).`, 0);
      }
      clearTimeout(timer);
      this.last = Date.now(); // délai compté depuis la fin de la requête précédente
      if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
      if (res.status >= 500 && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      if (res.status === 404 && allow404) return { notFound: true, json };
      if (!res.ok) {
        const msg = json && json.details ? json.details : `HTTP ${res.status}`;
        throw new ScryfallError(`Scryfall a refusé la requête : ${msg}`, res.status, json);
      }
      return { json };
    }
    throw new ScryfallError('Scryfall limite le nombre de requêtes. Réessaie dans une minute.', 429);
  }

  async collection(identifiers, onBatch) {
    const data = []; const notFound = [];
    for (let i = 0; i < identifiers.length; i += 75) {
      const batch = identifiers.slice(i, i + 75);
      const r = await this.request('/cards/collection', { method: 'POST', body: { identifiers: batch }, allow404: false });
      data.push(...((r.json && r.json.data) || []));
      notFound.push(...((r.json && r.json.not_found) || []));
      if (onBatch) onBatch(Math.min(i + 75, identifiers.length), identifiers.length);
    }
    return { data, notFound };
  }

  async search(q, { unique = 'cards', multilingual = false, maxPages = 3, order } = {}) {
    const params = new URLSearchParams({ q, unique });
    if (multilingual) params.set('include_multilingual', 'true');
    if (order) params.set('order', order);
    let url = `/cards/search?${params}`;
    const out = [];
    for (let page = 0; page < maxPages && url; page++) {
      const r = await this.request(url);
      if (r.notFound) break;
      out.push(...(r.json.data || []));
      url = r.json.has_more ? r.json.next_page : null;
    }
    return out;
  }

  /** Pages successives d'une recherche à partir d'une adresse complète. */
  async pages(url, maxPages = 3) {
    const out = [];
    let next = url;
    for (let page = 0; page < maxPages && next; page++) {
      const r = await this.request(next);
      if (r.notFound) break;
      out.push(...(r.json.data || []));
      next = r.json.has_more ? r.json.next_page : null;
    }
    return out;
  }

  async named(fuzzy) {
    const r = await this.request(`/cards/named?${new URLSearchParams({ fuzzy })}`);
    return r.notFound ? null : r.json;
  }

  async autocomplete(q) {
    const r = await this.request(`/cards/autocomplete?${new URLSearchParams({ q })}`);
    return r.notFound ? [] : r.json.data || [];
  }

  async symbology() {
    const r = await this.request('/symbology');
    return r.notFound ? [] : r.json.data || [];
  }
}
