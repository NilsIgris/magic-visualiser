// Faux serveur Scryfall pour les tests (aucun accès réseau).
import http from 'node:http';
import { CARDS, TOKENS, FR_PRINTS } from './fixtures/cards.mjs';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function fill(obj, base) {
  return JSON.parse(JSON.stringify(obj).replaceAll('{{IMG}}', `${base}/img`));
}

const COLORS = { W: '#F8F2D5', U: '#9CC8EA', B: '#9A8E8C', R: '#EA9A82', G: '#9CCB9E' };

function cardSvg(name, kind) {
  const c = [...CARDS, ...FR_PRINTS, ...Object.values(TOKENS)].find((x) => x.id === name || (x.card_faces && x.card_faces.some((f) => JSON.stringify(f.image_uris || {}).includes(name))));
  const label = c ? (c.printed_name || c.name) : name;
  const color = c && c.colors && c.colors[0] ? COLORS[c.colors[0]] : '#C9C9C9';
  if (kind === 'art') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="626" height="457" viewBox="0 0 626 457"><rect width="626" height="457" fill="${color}"/><circle cx="313" cy="228" r="140" fill="#00000022"/><text x="313" y="240" font-size="44" text-anchor="middle" font-family="sans-serif" fill="#222">${escapeXml(label.slice(0, 18))}</text></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680" viewBox="0 0 488 680"><rect width="488" height="680" rx="24" fill="#151515"/><rect x="18" y="18" width="452" height="644" rx="14" fill="${color}"/><rect x="34" y="34" width="420" height="52" rx="6" fill="#ffffffcc"/><text x="46" y="70" font-size="26" font-family="serif" fill="#111">${escapeXml(label.slice(0, 26))}</text><rect x="34" y="100" width="420" height="300" fill="#00000022"/><rect x="34" y="420" width="420" height="220" rx="6" fill="#ffffffcc"/></svg>`;
}
function escapeXml(s) { return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }

export function startMock({ port = 0, delay = 0 } = {}) {
  const log = [];
  let base = '';
  const all = () => [...CARDS, ...Object.values(TOKENS)];
  const allPrints = () => [...all(), ...FR_PRINTS];
  const names = (c) => [c.name, ...(c.name.split(' // ')), ...((c.card_faces || []).map((f) => f.name))].map(norm);
  const pnames = (c) => [c.printed_name, ...((c.card_faces || []).map((f) => f.printed_name))].filter(Boolean).map(norm);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const t = Date.now();
    const isApi = !url.pathname.startsWith('/img') && !url.pathname.startsWith('/svg');
    if (isApi) log.push({ t, path: url.pathname + url.search, ua: req.headers['user-agent'], accept: req.headers.accept });
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
    const notFound = () => send(404, { object: 'error', code: 'not_found', status: 404, details: 'No cards found' });

    if (isApi && (!req.headers['user-agent'] || !req.headers.accept)) return send(400, { object: 'error', details: 'User-Agent and Accept required' });

    if (url.pathname.startsWith('/img/')) {
      const [, , kind, file] = url.pathname.split('/');
      return send(200, cardSvg(file.replace(/\.svg$/, ''), kind), 'image/svg+xml');
    }
    if (url.pathname.startsWith('/svg/')) {
      const sym = decodeURIComponent(url.pathname.slice(5)).replace(/\.svg$/, '');
      const col = COLORS[sym] || '#CAC5C0';
      return send(200, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="${col}"/><text x="50" y="66" font-size="48" text-anchor="middle" font-family="sans-serif" fill="#111">${escapeXml(sym)}</text></svg>`, 'image/svg+xml');
    }
    if (url.pathname === '/cards/collection' && req.method === 'POST') {
      let body = '';
      for await (const ch of req) body += ch;
      const { identifiers } = JSON.parse(body);
      if (identifiers.length > 75) return send(422, { object: 'error', details: 'Too many identifiers' });
      const data = []; const nf = [];
      for (const id of identifiers) {
        let c = null;
        if (id.id) c = allPrints().find((x) => x.id === id.id);
        else if (id.set && id.collector_number) c = all().find((x) => x.set === id.set && x.collector_number === id.collector_number);
        else if (id.name) c = all().find((x) => names(x).includes(norm(id.name)) && (!id.set || x.set === id.set));
        if (c) data.push(fill(c, base)); else nf.push(id);
      }
      return send(200, { object: 'list', not_found: nf, data });
    }
    if (url.pathname.startsWith('/csb/')) {
      let body = '';
      for await (const ch of req) body += ch;
      return send(200, spellbookResponse(url.pathname.slice(5), JSON.parse(body || '{}')));
    }
    if (url.pathname === '/cards/search' && /oracleid:/.test(url.searchParams.get('q') || '')) {
      const q = url.searchParams.get('q');
      const oid = (q.match(/oracleid:([0-9a-f-]{36})/) || [])[1];
      const langs = /lang:en or lang:fr/.test(q) ? ['en', 'fr'] : null;
      const out = allPrints().filter((c) => c.oracle_id === oid && (!langs || langs.includes(c.lang)));
      if (!out.length) return notFound();
      return send(200, { object: 'list', has_more: false, total_cards: out.length, data: out.map((c) => fill(c, base)) });
    }
    if (url.pathname === '/cards/search') {
      const q = url.searchParams.get('q') || '';
      const multi = url.searchParams.get('include_multilingual') === 'true';
      const langM = q.match(/\blang:(\w+)/);
      const lang = langM ? langM[1] : null;
      const rest = q.replace(/\blang:\w+/, '').trim();
      const exact = [...rest.matchAll(/!"([^"]+)"/g)].map((m) => norm(m[1]));
      const words = exact.length ? [] : rest.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean).map(norm);
      let pool = lang === 'fr' ? FR_PRINTS : lang === 'any' || multi ? allPrints() : all();
      if (lang === 'en') pool = all();
      const out = pool.filter((c) => {
        const ns = [...names(c), ...pnames(c)];
        if (exact.length) return exact.some((e) => ns.includes(e));
        return words.length && ns.some((n) => words.every((w) => n.includes(w)));
      });
      if (!out.length) return notFound();
      return send(200, { object: 'list', has_more: false, total_cards: out.length, data: out.map((c) => fill(c, base)) });
    }
    if (url.pathname === '/cards/named') {
      const f = norm(url.searchParams.get('fuzzy'));
      const c = all().find((x) => names(x).some((n) => n.includes(f) || lev(n, f) <= 2));
      return c ? send(200, fill(c, base)) : notFound();
    }
    if (url.pathname === '/cards/autocomplete') {
      const q = norm(url.searchParams.get('q'));
      return send(200, { object: 'catalog', data: CARDS.map((c) => c.name).filter((n) => norm(n).startsWith(q) || norm(n).includes(q)).slice(0, 20) });
    }
    if (url.pathname === '/symbology') {
      const syms = ['W', 'U', 'B', 'R', 'G', 'C', 'T', 'X', '0', '1', '2', '3', '4', '5', '6', '7'];
      return send(200, { object: 'list', data: syms.map((s) => ({ symbol: `{${s}}`, svg_uri: `${base}/svg/${s}.svg`, english: s })) });
    }
    return notFound();
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, server, log, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

// Réponses Commander Spellbook simulées (format du client OpenAPI 7.3.4, clés camelCase).
const CSB_COMBOS = [
  { id: '1001-2002', cards: ['Ghave, Guru of Spores', 'Doubling Season'], produces: ['Infinite Saproling creature tokens', 'Infinite death triggers'], twoCard: true },
  { id: '3003-4004', cards: ['Blood Artist', 'Viscera Seer', 'Reassembling Skeleton'], produces: ['Infinite lifegain'], twoCard: false },
];
const CSB_GC = ['Demonic Tutor', 'Worldly Tutor', 'Rhystic Study', 'Smothering Tithe'];
function variant(c) {
  return {
    id: c.id, status: 'OK',
    uses: c.cards.map((n) => { const k = CARDS.find((x) => x.name === n); return { card: { id: 1, name: n, oracleId: k ? k.oracle_id : null, typeLine: '' }, zoneLocations: ['B'], mustBeCommander: false, quantity: 1 }; }),
    requires: [], produces: c.produces.map((f) => ({ feature: { id: 1, name: f }, quantity: 1 })), of: [], includes: [],
    identity: 'WBG', manaNeeded: '{1}', manaValueNeeded: 1, easyPrerequisites: 'All permanents on the battlefield.', notablePrerequisites: '',
    description: 'Step one.\nStep two.\nRepeat.', notes: '', popularity: 1234, salt: null, saltVoteCount: 0, spoiler: false, bracketTag: 'S',
    legalities: {}, prices: {}, variantCount: 1,
  };
}
function spellbookResponse(path, body) {
  const names = new Set([...(body.main || []), ...(body.commanders || [])].map((c) => c.card));
  if (path === 'find-my-combos') {
    const included = CSB_COMBOS.filter((c) => c.cards.every((n) => names.has(n))).map(variant);
    const almostIncluded = CSB_COMBOS.filter((c) => c.cards.filter((n) => !names.has(n)).length === 1).map(variant);
    return { count: included.length, next: null, previous: null, results: { identity: 'WBG', included, includedByChangingCommanders: [], almostIncluded, almostIncludedByAddingColors: [], almostIncludedByChangingCommanders: [], almostIncludedByAddingColorsAndChangingCommanders: [] } };
  }
  if (path === 'estimate-bracket') {
    return {
      bracketTag: 'P',
      cards: [...names].map((n) => ({ card: { name: n, oracleId: (CARDS.find((x) => x.name === n) || {}).oracle_id || null }, quantity: 1, banned: false, gameChanger: CSB_GC.includes(n), massLandDenial: false, extraTurn: false })),
      combos: CSB_COMBOS.filter((c) => c.cards.every((n) => names.has(n))).map((c) => ({ combo: variant(c), relevant: true, borderlineRelevant: false, arguablyTwoCard: c.twoCard, definitelyTwoCard: c.twoCard, speed: 3, massLandDenial: false, extraTurn: false, lock: false, skipTurns: false, controlAllOpponents: false, controlSomeOpponents: false })),
    };
  }
  return { detail: 'not found' };
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

if (process.argv[1] && process.argv[1].endsWith('mock-scryfall.mjs')) {
  startMock({ port: Number(process.env.PORT || 4777) }).then(({ base }) => console.log(`mock scryfall on ${base}`));
}
