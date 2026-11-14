// Moteur de suggestions d'interactions entre cartes.
// Principe : précision avant exhaustivité. Si une condition de déclencheur n'est pas
// comprise à coup sûr (mot inconnu, condition complexe), aucun lien n'est suggéré.
// Les liens proposés sont des suggestions : l'utilisateur les valide ou les rejette.

export const LINK_KINDS = {
  trigger: { label: 'Déclenche', color: '#E3A23F' },
  enable: { label: 'Alimente', color: '#5B9BE6' },
  amplify: { label: 'Amplifie', color: '#D46FB8' },
  tribal: { label: 'Tribal', color: '#A88BE3' },
  synergy: { label: 'Synergie', color: '#4FB8A8' },
  combo: { label: 'Combo', color: '#E8606F' },
  protect: { label: 'Protège', color: '#9DC46A' },
  tutor: { label: 'Va chercher', color: '#7FC6E8' },
  anti: { label: 'Anti-synergie', color: '#C9776B' },
};

/** Rôles fonctionnels d'une carte (modèle de construction Commander). */
export const FUNCTIONS = {
  ramp: 'Rampe',
  draw: 'Avantage de cartes',
  removal: 'Interaction ciblée',
  wipe: 'Balai',
  tutor: 'Tuteur',
  protection: 'Protection',
  recursion: 'Récupération',
};

const LINK_BASE = { combo: 1, anti: 0.9, amplify: 0.85, trigger: 0.7, enable: 0.7, protect: 0.65, synergy: 0.55, tutor: 0.5, tribal: 0.45 };

const CARD_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery', 'tribal'];
const PERMANENT_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'];
const SUPERTYPES = ['basic', 'legendary', 'snow', 'world', 'ongoing'];
const COLOR_WORDS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const KEYWORDS_WITH = ['flying', 'deathtouch', 'lifelink', 'haste', 'trample', 'defender', 'vigilance', 'reach', 'menace', 'first strike', 'double strike', 'hexproof', 'indestructible', 'ward', 'flash'];
const NOUN_PLURALS = {
  creatures: 'creature', artifacts: 'artifact', enchantments: 'enchantment', lands: 'land', planeswalkers: 'planeswalker',
  battles: 'battle', instants: 'instant', sorceries: 'sorcery', permanents: 'permanent', spells: 'spell', tokens: 'token', cards: 'card',
};
const IRREGULAR_PLURALS = {
  elf: 'elves', dwarf: 'dwarves', wolf: 'wolves', werewolf: 'werewolves', mouse: 'mice', ox: 'oxen', fungus: 'fungi',
  octopus: 'octopuses', djinn: 'djinn', sheep: 'sheep', fish: 'fish', 'elk': 'elk', 'moonfolk': 'moonfolk', 'kithkin': 'kithkin',
  'merfolk': 'merfolk', 'treefolk': 'treefolk', 'kor': 'kor', 'nephilim': 'nephilim', 'phyrexian': 'phyrexians', 'cyclops': 'cyclopes',
  'thief': 'thieves', 'leech': 'leeches', 'sphinx': 'sphinxes', 'fox': 'foxes', 'lynx': 'lynxes',
};

// Mots-clés qui posent des marqueurs +1/+1.
const COUNTER_KEYWORDS = ['adapt', 'bolster', 'evolve', 'outlast', 'training', 'modular', 'mentor', 'support', 'graft', 'reinforce', 'backup', 'fabricate', 'unleash', 'riot', 'amass', 'proliferate', 'monstrosity', 'renown', 'scavenge', 'tribute', 'exploit'];
// 'exploit' ne pose pas de marqueurs mais sacrifie : traité à part.
const COUNTER_KEYWORDS_REAL = COUNTER_KEYWORDS.filter((k) => k !== 'exploit');
const GRAVEYARD_KEYWORDS = ['flashback', 'unearth', 'escape', 'delve', 'embalm', 'eternalize', 'disturb', 'jump-start', 'retrace', 'scavenge', 'threshold', 'delirium', 'encore', 'aftermath'];
const MILL_KEYWORDS = ['dredge', 'surveil'];
const DISCARD_KEYWORDS = ['cycling', 'channel', 'connive'];

export function pluralize(w) {
  const l = w.toLowerCase();
  if (IRREGULAR_PLURALS[l]) return IRREGULAR_PLURALS[l];
  if (/[^aeiou]y$/.test(l)) return l.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/.test(l)) return l + 'es';
  return l + 's';
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Analyse une ligne de type Scryfall ("Legendary Creature — Elf Druid"). */
export function parseTypeLine(tl) {
  const txt = String(tl || '');
  const [left, right = ''] = txt.split(/\s+—\s+/);
  const lw = left.toLowerCase().split(/\s+/).filter(Boolean);
  const types = new Set(lw.filter((w) => CARD_TYPES.includes(w)));
  if (types.has('tribal')) types.add('kindred');
  const supers = new Set(lw.filter((w) => SUPERTYPES.includes(w)));
  const subs = new Set(right.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase()));
  const token = lw.includes('token');
  return { types, supers, subs, token };
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function makeObj({ typeLine, colors, power, toughness, mv, token = false, keywords = [], text = '' }) {
  const t = parseTypeLine(typeLine);
  const kw = new Set((keywords || []).map((k) => k.toLowerCase()));
  return {
    types: t.types, supers: t.supers, subs: t.subs,
    colors: new Set(colors || []),
    power: num(power), toughness: num(toughness), mv: num(mv),
    token: token || t.token,
    keywords: kw,
    changeling: kw.has('changeling') || /is every creature type/i.test(text || ''),
    generic: false,
  };
}

function genericObj(type) {
  return { types: new Set([type]), supers: new Set(), subs: new Set(), colors: new Set(), power: null, toughness: null, mv: null, token: false, keywords: new Set(), changeling: false, generic: true };
}

function isPermanentObj(o) { return PERMANENT_TYPES.some((t) => o.types.has(t)); }

// ---------------------------------------------------------------------------
// Faces et texte
// ---------------------------------------------------------------------------

function cardFaces(card) {
  if (Array.isArray(card.faces) && card.faces.length) return card.faces;
  return [{ name: card.name, typeLine: card.typeLine, oracleText: card.oracleText, power: card.power, toughness: card.toughness, colors: card.colors }];
}

/** Faces qui peuvent arriver sur le champ de bataille en tant que permanent. */
function permanentFaces(card) {
  const faces = cardFaces(card);
  const layout = card.layout || 'normal';
  if (layout === 'modal_dfc' || layout === 'split') return faces; // chaque face peut être jouée
  return [faces[0]]; // transform, flip, adventure, meld, normal : face avant
}

function castFaces(card) {
  const faces = cardFaces(card);
  const layout = card.layout || 'normal';
  if (['modal_dfc', 'split', 'adventure', 'prepare'].includes(layout)) return faces;
  return [faces[0]];
}

function selfNames(card) {
  const names = new Set();
  const add = (n) => {
    if (!n) return;
    names.add(n);
    const short = n.split(',')[0].trim();
    if (short !== n && short.length >= 3) names.add(short);
  };
  add(card.name);
  for (const f of cardFaces(card)) add(f.name);
  for (const n of [...names]) if (n.includes(' // ')) n.split(' // ').forEach(add);
  return [...names].sort((a, b) => b.length - a.length);
}

/** Texte prêt à analyser : sans rappels entre parenthèses, nom de la carte remplacé par "~". */
export function prepareText(card, text) {
  let t = String(text || '');
  // retirer le texte de rappel (peut être imbriqué une fois)
  for (let i = 0; i < 2; i++) t = t.replace(/\([^()]*\)/g, '');
  for (const n of selfNames(card)) {
    t = t.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRe(n)}(?![A-Za-z0-9])`, 'g'), '~');
  }
  t = t.replace(/\bthis (creature|artifact|enchantment|permanent|land|planeswalker|card|spell|vehicle|equipment|aura|token|battle|saga|class|case|room|siege)\b/gi, '~');
  t = t.replace(/[ \t]+/g, ' ');
  return t;
}

function sentencesOf(text) {
  const out = [];
  for (const para of text.split('\n')) {
    const p = para.trim();
    if (!p) continue;
    for (const s of p.split(/(?<=[.!])\s+(?=[A-Z~•"])/)) {
      const st = s.trim();
      if (st) out.push(st);
    }
  }
  return out;
}

function snippet(s) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 200 ? t.slice(0, 197) + '…' : t;
}

// ---------------------------------------------------------------------------
// Descripteurs ("another nontoken creature you control", "an artifact or creature"…)
// ---------------------------------------------------------------------------

function makeContext(objectsAll) {
  const subToCanon = new Map(); // forme (singulier ou pluriel, minuscule) -> sous-type minuscule
  const creatureSubs = new Set();
  const nonLandSubs = new Set();
  for (const o of objectsAll) {
    for (const s of o.subs) {
      subToCanon.set(s, s);
      subToCanon.set(pluralize(s), s);
      if (o.types.has('creature') || o.types.has('kindred')) creatureSubs.add(s);
      if (!o.types.has('land')) nonLandSubs.add(s);
    }
  }
  return { subToCanon, creatureSubs, nonLandSubs };
}

function canonSub(word, ctx) {
  const l = word.toLowerCase();
  if (ctx.subToCanon.has(l)) return ctx.subToCanon.get(l);
  // sous-type absent du deck : forme singulière approximative (le lien sera de toute façon vide)
  for (const [sg, pl] of Object.entries(IRREGULAR_PLURALS)) if (pl === l) return sg;
  if (/ies$/.test(l)) return l.slice(0, -3) + 'y';
  if (/(ches|shes|xes|ses|zes)$/.test(l)) return l.slice(0, -2);
  if (/s$/.test(l) && !/ss$/.test(l)) return l.slice(0, -1);
  return l;
}

function hasSub(o, sub, ctx) {
  if (o.subs.has(sub)) return true;
  if (o.changeling && ctx.creatureSubs.has(sub)) return true;
  return false;
}

/** Retourne un prédicat (objet) => booléen, ou null si le descripteur n'est pas compris. */
export function parseDescriptor(raw, ctx, { context = 'permanent' } = {}) {
  let s = ` ${String(raw).replace(/[,;]/g, ' , ').replace(/\s+/g, ' ').trim()} `;
  if (/\b(opponents?|opponent's)\b/i.test(s)) return { opponent: true };
  s = s.replace(/\b(you control|under your control|you own|of yours|each player controls|a player controls)\b/gi, ' ');
  s = s.replace(/\b(one|two|three|four|five) or more\b/gi, ' ');
  s = s.replace(/\b(each turn|this turn)\b/gi, ' ');
  const cons = [];
  s = s.replace(/\bwith (power|toughness|mana value) (\d+) or (greater|more|less|fewer)\b/gi, (_, a, n, d) => {
    cons.push({ attr: a.toLowerCase(), n: Number(n), ge: /greater|more/i.test(d) }); return ' ';
  });
  s = s.replace(new RegExp(`\\bwith (${KEYWORDS_WITH.join('|')})\\b`, 'gi'), (_, k) => { cons.push({ kw: k.toLowerCase() }); return ' '; });
  if (/\b(with|without|that|if|named|chosen|attacking|blocking|tapped|untapped|face-down|enchanted|equipped|from|exiled|target|those|it|them|card's)\b/i.test(s)) return null;
  if (/\band\b(?!\/or)/i.test(s)) return null;
  if (/~/.test(s)) return null;

  const rawParts = s.split(/\s*,\s*(?:or\s+|and\/or\s+)?|\s+(?:and\/or|or)\s+/).map((p) => p.trim()).filter(Boolean);
  if (!rawParts.length) return null;
  let other = false;
  const parts = [];
  for (const part of rawParts) {
    const words = part.split(/\s+/).filter(Boolean);
    const adjs = [];
    let noun = null;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const lw = w.toLowerCase();
      if (['a', 'an', 'any', 'each', 'the', 'your', 'first', 'second', 'third', 'x', 'all', 'one'].includes(lw)) continue;
      if (lw === 'another' || lw === 'other') { other = true; continue; }
      const isLast = i === words.length - 1;
      const sing = NOUN_PLURALS[lw] || lw;
      let term = null;
      if (CARD_TYPES.includes(sing)) term = { k: 'type', v: sing === 'tribal' ? 'kindred' : sing };
      else if (sing === 'permanent' || sing === 'spell' || sing === 'token' || sing === 'card') term = { k: sing };
      else if (SUPERTYPES.includes(lw)) term = { k: 'super', v: lw };
      else if (COLOR_WORDS[lw]) term = { k: 'color', v: COLOR_WORDS[lw] };
      else if (['colorless', 'multicolored', 'monocolored', 'historic', 'nontoken'].includes(lw)) term = { k: lw };
      else if (/^non-?/i.test(w)) {
        const rest = w.replace(/^non-?/i, '');
        const rl = rest.toLowerCase();
        if (CARD_TYPES.includes(rl)) term = { k: 'not', t: { k: 'type', v: rl } };
        else if (COLOR_WORDS[rl]) term = { k: 'not', t: { k: 'color', v: COLOR_WORDS[rl] } };
        else if (SUPERTYPES.includes(rl)) term = { k: 'not', t: { k: 'super', v: rl } };
        else if (/^[A-Z]/.test(rest)) term = { k: 'not', t: { k: 'sub', v: canonSub(rest, ctx) } };
        else return null;
      } else if (/^[A-Z][a-zA-Z'\-]*$/.test(w)) term = { k: 'sub', v: canonSub(w, ctx) };
      else return null; // mot inconnu : on ne devine pas
      const nounLike = ['type', 'permanent', 'spell', 'token', 'card', 'sub'].includes(term.k);
      if (isLast && nounLike) noun = term; else adjs.push(term);
    }
    parts.push({ adjs, noun });
  }
  const lastNoun = parts[parts.length - 1].noun;
  if (!lastNoun) return null;
  for (const p of parts) if (!p.noun) p.noun = lastNoun;

  const termOk = (t, o) => {
    switch (t.k) {
      case 'type': return o.types.has(t.v);
      case 'permanent': return isPermanentObj(o);
      case 'spell': return !o.types.has('land');
      case 'token': return o.token;
      case 'card': return true;
      case 'super': return !o.generic && o.supers.has(t.v);
      case 'color': return !o.generic && o.colors.has(t.v);
      case 'colorless': return !o.generic && o.colors.size === 0;
      case 'multicolored': return !o.generic && o.colors.size >= 2;
      case 'monocolored': return !o.generic && o.colors.size === 1;
      case 'historic': return !o.generic && (o.supers.has('legendary') || o.types.has('artifact') || o.subs.has('saga'));
      case 'nontoken': return !o.token;
      case 'sub': return !o.generic && hasSub(o, t.v, ctx);
      case 'not': return !o.generic ? !termOk(t.t, o) : t.t.k === 'type' ? !o.types.has(t.t.v) : false;
      default: return false;
    }
  };
  const consOk = (o) => cons.every((c) => {
    if (o.generic) return false;
    if (c.kw) return o.keywords.has(c.kw);
    const v = c.attr === 'power' ? o.power : c.attr === 'toughness' ? o.toughness : o.mv;
    if (v === null) return false;
    return c.ge ? v >= c.n : v <= c.n;
  });
  const pred = (o) => {
    if (context === 'permanent' && !isPermanentObj(o)) return false;
    if (!consOk(o)) return false;
    return parts.some((p) => termOk(p.noun, o) && p.adjs.every((a) => termOk(a, o)));
  };
  const nouns = parts.map((p) => p.noun);
  return { pred, other, nouns };
}

// ---------------------------------------------------------------------------
// Profil d'une carte : ce qu'elle fournit, ce qu'elle écoute
// ---------------------------------------------------------------------------

function buildProfile(card, isCommander) {
  const kw = new Set((card.keywords || []).map((k) => k.toLowerCase()));
  const faces = cardFaces(card);
  const permObjs = [];
  for (const f of permanentFaces(card)) {
    const o = makeObj({ typeLine: f.typeLine || card.typeLine, colors: f.colors || card.colors, power: f.power, toughness: f.toughness, mv: card.cmc, keywords: card.keywords, text: f.oracleText });
    if (isPermanentObj(o)) permObjs.push(o);
  }
  const castObjs = [];
  for (const f of castFaces(card)) {
    const o = makeObj({ typeLine: f.typeLine || card.typeLine, colors: f.colors || card.colors, power: f.power, toughness: f.toughness, mv: card.cmc, keywords: card.keywords, text: f.oracleText });
    if (!o.types.has('land')) castObjs.push(o);
  }
  const tokenObjs = (card.tokens || [])
    .filter((t) => t && t.typeLine && !/^emblem/i.test(t.typeLine))
    .map((t) => ({ ...makeObj({ typeLine: t.typeLine, colors: t.colors, power: t.power, toughness: t.toughness, mv: 0, token: true, keywords: t.keywords, text: t.oracleText }), tokenName: t.name, tokenText: t.oracleText || '' }));

  const cardObjs = faces.map((f) => makeObj({ typeLine: f.typeLine || card.typeLine, colors: f.colors || card.colors, power: f.power, toughness: f.toughness, mv: card.cmc, keywords: card.keywords, text: f.oracleText }));
  const text = faces.map((f) => prepareText(card, f.oracleText)).join('\n');
  return {
    id: card.oracleId, card, kw, permObjs, castObjs, tokenObjs, cardObjs, text,
    sentences: sentencesOf(text), isCommander,
    enters: [], listens: {}, provides: {},
  };
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

/**
 * @param {Array} cards cartes normalisées (voir README technique)
 * @param {{commanderIds?: string[]}} opts
 * @returns {{suggestions: Array<{from,to,kind,reasons}>, roles: Object<string, {listens:string[], provides:string[]}>}}
 */
export function analyzeDeck(cards, opts = {}) {
  const commanderIds = new Set(opts.commanderIds || []);
  const profiles = cards.map((c) => buildProfile(c, commanderIds.has(c.oracleId)));
  const ctx = makeContext(profiles.flatMap((p) => [...p.permObjs, ...p.tokenObjs, ...p.castObjs]));
  const allObjs = profiles.flatMap((p) => [...p.permObjs, ...p.tokenObjs]);

  for (const p of profiles) extractFeatures(p, ctx);

  const edges = new Map();
  const add = (from, to, kind, reason) => {
    if (from.id === to.id) return;
    const key = `${from.id}|${to.id}|${kind}`;
    let e = edges.get(key);
    if (!e) { e = { from: from.id, to: to.id, kind, reasons: [] }; edges.set(key, e); }
    const rk = `${reason.rule}|${reason.origin || ''}|${reason.detail || ''}`;
    if (!e.reasons.some((r) => `${r.rule}|${r.origin || ''}|${r.detail || ''}` === rk)) e.reasons.push(reason);
  };

  for (const B of profiles) {
    const L = B.listens;
    for (const A of profiles) {
      if (A === B) continue;
      const P = A.provides;

      // 1. Arrivées sur le champ de bataille
      for (const l of L.etb || []) {
        const hits = A.enters.filter((e) => l.pred(e.obj));
        if (hits.length) {
          const best = hits.find((h) => h.origin === 'self') || hits[0];
          add(A, B, 'trigger', { rule: 'etb', origin: best.origin, detail: best.detail || '', snippet: l.snippet });
        }
      }
      // 2. Clignotement -> effet d'arrivée propre
      if (L.selfEtb && P.blink) {
        const target = B.permObjs.find((o) => P.blink.some((b) => b.pred(o)));
        if (target) add(A, B, 'enable', { rule: 'blink', snippet: P.blink[0].snippet });
      }
      // 3. Doubleurs d'arrivée (Panharmonicon…)
      for (const d of L.etbDoubler || []) {
        const selfOk = P.selfEtb && A.permObjs.some((o) => d.pred(o));
        const listenerOk = (P.etbListener);
        if (selfOk || listenerOk) add(A, B, 'amplify', { rule: 'etbDouble', snippet: d.snippet });
      }
      // 4. Morts
      for (const l of L.dies || []) {
        const hits = A.enters.filter((e) => (e.origin === 'self' || e.origin === 'token') && e.obj.types.has('creature') && l.pred(e.obj));
        if (hits.length) {
          const best = hits.find((h) => h.origin === 'self') || hits[0];
          add(A, B, 'trigger', { rule: 'dies', origin: best.origin, detail: best.detail || '', snippet: l.snippet });
        }
        for (const o of P.sacOutlets || []) {
          if (allObjs.some((obj) => obj.types.has('creature') && o.pred(obj) && l.pred(obj))) {
            add(A, B, 'enable', { rule: 'diesOutlet', snippet: o.snippet });
            break;
          }
        }
      }
      if (L.selfDies) {
        for (const o of P.sacOutlets || []) {
          if (B.permObjs.some((obj) => obj.types.has('creature') && o.pred(obj))) { add(A, B, 'enable', { rule: 'selfDiesOutlet', snippet: o.snippet }); break; }
        }
      }
      // 5. Attaques
      for (const l of L.attack || []) {
        const hits = A.enters.filter((e) => (e.origin === 'self' || e.origin === 'token') && e.obj.types.has('creature') && l.pred(e.obj));
        if (hits.length) add(A, B, 'trigger', { rule: 'attack', origin: hits[0].origin, detail: hits[0].detail || '', snippet: l.snippet });
      }
      // 6. Sorts lancés
      for (const l of L.cast || []) {
        if (A.castObjs.some((o) => l.pred(o))) add(A, B, 'trigger', { rule: 'cast', snippet: l.snippet });
      }
      // 7. Gain de PV, perte de PV adverse, pioche, défausse
      if (L.lifegain && P.lifegain) add(A, B, 'trigger', { rule: 'lifegain', snippet: L.lifegain.snippet });
      if (L.oppLoss && P.oppLoss) add(A, B, 'trigger', { rule: 'oppLoss', snippet: L.oppLoss.snippet });
      if (L.draw && P.draw) add(A, B, 'trigger', { rule: 'draw', snippet: L.draw.snippet });
      if (L.discard && P.discard) add(A, B, 'trigger', { rule: 'discard', snippet: L.discard.snippet });
      // 8. Cimetière
      if (L.graveyard && P.mill) add(A, B, 'enable', { rule: 'mill', snippet: L.graveyard.snippet });
      // 9. Sacrifices
      for (const l of L.sacrifice || []) {
        let done = false;
        for (const o of P.sacOutlets || []) {
          if (allObjs.some((obj) => o.pred(obj) && l.pred(obj))) { add(A, B, 'trigger', { rule: 'sac', snippet: l.snippet }); done = true; break; }
        }
        if (!done) {
          const tok = A.tokenObjs.find((t) => /sacrifice ~|sacrifice this/i.test(prepareText({ name: t.tokenName }, t.tokenText)) && l.pred(t));
          if (tok) add(A, B, 'trigger', { rule: 'sacToken', detail: tok.tokenName || '', snippet: l.snippet });
        }
      }
      // 10. Création de jetons
      for (const l of L.tokens || []) {
        const tok = A.tokenObjs.find((t) => l.pred(t));
        if (tok) add(A, B, l.amplify ? 'amplify' : 'trigger', { rule: l.amplify ? 'tokensAmp' : 'tokens', detail: tok.tokenName || '', snippet: l.snippet });
      }
      // 11. Marqueurs +1/+1
      if (L.counters && P.counters) add(A, B, L.counters.amplify ? 'amplify' : 'enable', { rule: L.counters.amplify ? 'countersAmp' : 'counters', snippet: L.counters.snippet });
      // 12. Commandant
      if (L.commander && A.isCommander) add(A, B, 'synergy', { rule: 'commander', snippet: L.commander.snippet });
      // 13. Tuteurs
      for (const t of P.tutor || []) {
        if (B.cardObjs.some((o) => t.pred(o))) { add(A, B, 'tutor', { rule: 'tutor', snippet: t.snippet }); break; }
      }
      // 14. Réducteurs de coût
      for (const c of P.costReduce || []) {
        if (B.castObjs.some((o) => c.pred(o))) { add(A, B, 'enable', { rule: 'costReduce', snippet: c.snippet }); break; }
      }
      // 15. Protection et équipement du commandant
      if (B.isCommander) {
        const cmdCreature = B.permObjs.some((o) => o.types.has('creature'));
        let protectedIt = false;
        for (const pr of P.protect || []) {
          if (pr.creatureOnly && !cmdCreature) continue;
          if (!B.permObjs.length) continue;
          add(A, B, 'protect', { rule: 'protect', snippet: pr.snippet });
          protectedIt = true;
          break;
        }
        if (P.voltron && cmdCreature && !protectedIt) add(A, B, 'synergy', { rule: 'voltron', snippet: P.voltron.snippet });
      }
      // 16. Anti-synergies (effets symétriques qui gênent tes propres cartes)
      for (const h of P.hoses || []) {
        if (isVictim(h.key, B, allObjs)) add(A, B, 'anti', { rule: 'anti', detail: h.key, snippet: h.snippet });
      }
    }
  }

  // 17. Tribal (uniquement si aucun autre lien automatique n'existe déjà pour la paire)
  const pairHas = new Set([...edges.values()].map((e) => `${e.from}|${e.to}`));
  for (const B of profiles) {
    if (!B.listens.tribal || !B.listens.tribal.size) continue;
    for (const A of profiles) {
      if (A === B || pairHas.has(`${A.id}|${B.id}`)) continue;
      for (const sub of B.listens.tribal) {
        const hit = A.enters.find((e) => (e.origin === 'self' || e.origin === 'token') && hasSub(e.obj, sub, ctx));
        if (hit) {
          add(A, B, 'tribal', { rule: 'tribal', origin: hit.origin, detail: displaySub(sub), snippet: B.listens.tribalSnippets.get(sub) || '' });
          break;
        }
      }
    }
  }

  const suggestions = [...edges.values()];
  scoreSuggestions(suggestions, new Map(profiles.map((p) => [p.id, p.card])));
  const roles = {};
  for (const p of profiles) roles[p.id] = { ...describeRoles(p), functions: cardFunctions(p) };
  return { suggestions, roles };
}

function isBasicLand(card) { return /\bbasic\b/i.test(card.typeLine || '') && /\bland\b/i.test(card.typeLine || ''); }

/**
 * Score de pertinence 0-100 : un lien partagé par beaucoup de cartes pour la même raison
 * (ex. 21 créatures qui déclenchent Cathars' Crusade) vaut moins, pris seul, qu'un lien rare.
 */
export function scoreSuggestions(list, cardsById) {
  const cntTo = new Map(); const cntFrom = new Map();
  const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const e of list) { const r = e.reasons[0].rule; inc(cntTo, `${e.to}|${e.kind}|${r}`); inc(cntFrom, `${e.from}|${e.kind}|${r}`); }
  const pairs = new Set(list.map((e) => `${e.from}|${e.to}`));
  for (const e of list) {
    const r = e.reasons[0];
    const n = Math.max(cntTo.get(`${e.to}|${e.kind}|${r.rule}`), cntFrom.get(`${e.from}|${e.kind}|${r.rule}`));
    const spec = specificity(n);
    let of = r.origin === 'reanimate' || r.origin === 'ramp' ? 0.6 : 1;
    const from = cardsById.get(e.from);
    if (from && isBasicLand(from)) of *= 0.5;
    const bi = pairs.has(`${e.to}|${e.from}`) ? 0.15 : 0;
    e.score = Math.round(Math.min(1, (LINK_BASE[e.kind] ?? 0.5) * spec * of + bi) * 100);
  }
}

export function specificity(n) { return 1 / (1 + 0.35 * Math.log2(Math.max(1, n))); }

/** Le niveau d'un score (pour l'affichage). */
export function scoreLevel(score) {
  if (score === undefined || score === null) return 'strong';
  return score >= 50 ? 'strong' : score >= 30 ? 'medium' : 'weak';
}

function hasActivatedAbility(p) {
  return /(^|\n)[^"\n]*?(\{[^}]+\}|\btap\b|\bsacrifice\b|\bpay\b|\bremove\b)[^:\n]{0,80}:/i.test(p.text) || /(^|\n)equip\b/i.test(p.text);
}

/** Met une carte du cimetière sur le champ de bataille (réanimation au sens strict). */
function fromGraveyard(B) {
  return /\bfrom (?:a|your|any|their owners?'?) graveyards?\b[^.]*\bonto the battlefield\b|\bonto the battlefield\b[^.]*\bfrom (?:a|your|any) graveyards?\b|\breturn [^.]*?\bfrom your graveyard to the battlefield\b/i.test(B.text);
}

function isVictim(key, B, allObjs) {
  const L = B.listens;
  const creatureListener = (ls) => (ls || []).some((l) => allObjs.some((o) => o.types.has('creature') && l.pred(o)));
  switch (key) {
    case 'graveyard': return !!(L.graveyard || L.dies || L.selfDies || fromGraveyard(B));
    case 'graveyardCage': return !!(L.graveyard || fromGraveyard(B));
    case 'etb': return creatureListener(L.etb) || (!!L.selfEtb && B.permObjs.some((o) => o.types.has('creature')));
    case 'dies': return !!(L.dies || (L.selfDies && B.permObjs.some((o) => o.types.has('creature'))));
    case 'artifactAbilities': return B.permObjs.some((o) => o.types.has('artifact')) && hasActivatedAbility(B);
    case 'creatureAbilities': return B.permObjs.some((o) => o.types.has('creature')) && hasActivatedAbility(B);
    case 'lifegain': return !!L.lifegain;
    case 'draw': return !!L.draw;
    case 'cast': return !!L.cast;
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Rôles fonctionnels (rampe, pioche, interaction…)
// ---------------------------------------------------------------------------

const FN = {
  manaAbility: /(^|\n)[^\n]*?(?:\{T\}|\{Q\})[^:\n]*:[^\n]*?\badd\b/i,
  ritual: /\badd \{/i,
  landRamp: /\bsearch your library for [^.]*?\blands? cards?\b[^.]*?\bonto the battlefield\b|\bput (?:a|up to \w+|any number of) land cards? from your (?:hand|graveyard) onto the battlefield\b|\bplay an additional land\b|\bplay (?:two|three) additional lands\b|\byou may play (?:an|two) additional lands?\b/i,
  multiDraw: /\bdraws? (?:two|three|four|five|six|seven|x|that many|\d+) cards?\b|\bdraws? cards? equal\b|\bdraws? a card for each\b|\bdraw (?:two|three) cards\b/i,
  draw: /\bdraws? (?:a|an additional|one) cards?\b/i,
  impulse: /\bexile the top [^.]*?cards? of your library\b[^]*?\byou may (?:play|cast)\b/i,
  removal: [
    /\b(?:destroy|exile) (?:up to (?:one|two|three|x) )?(?:another )?(?:other )?target\b([^.;]*)/i,
    /\bcounter target\b/i,
    /\bdeals? (?:\d+|x|that much|damage equal to [^.]*?) (?:damage )?to (?:any target|target (?:creature|planeswalker|creature or planeswalker|attacking creature|blocking creature|attacking or blocking creature)|up to (?:one|two|three) targets?|another target)/i,
    /\breturn (?:up to (?:one|two) )?(?:another )?target (?:nonland permanent|creature|artifact|enchantment|permanent|planeswalker|artifact or creature|creature or planeswalker)\b([^.]*?) to (?:its|their) owners?'? hands?\b/i,
    /\b(?:target|each) (?:player|opponent) sacrifices (?:a|an|one|two) (?:creature|attacking creature|permanent|nonland permanent|artifact|enchantment|planeswalker)/i,
    /\btarget creature (?:an opponent controls )?gets -(?:\d+|x)\/-(?:\d+|x)/i,
    /\bfights? (?:target|another target|up to one target) creature\b/i,
  ],
  wipe: [
    /\b(?:destroy|exile) all (?:other )?(?:nonland |nontoken |non-[a-z]+ |attacking |tapped |nonartifact |noncreature )?(?:creatures|artifacts|enchantments|permanents|planeswalkers|nonland permanents|artifacts and enchantments|creatures and planeswalkers|artifacts, creatures, and enchantments|other permanents)\b/i,
    /\bdeals? (?:\d+|x) damage to each (?:other )?creature\b/i,
    /\b(?:all|each) (?:other )?creatures? gets? -(?:\d+|x)\/-(?:\d+|x)/i,
    /\breturn all (?:nonland permanents|creatures|permanents|artifacts|enchantments)[^.]* to (?:their|its) owners?'? hands?\b/i,
    /\beach player sacrifices all\b/i,
    /\bdestroy each (?:creature|artifact|nonland permanent|permanent)\b/i,
  ],
  tutor: /\bsearch your library for\b([^.]*)/i,
  recursion: /\breturn [^.]*?\bcards? from (?:your|a) graveyard to (?:your hand|the battlefield)\b|\b(?:put|return) target [^.]*?cards? from (?:your|a) graveyard (?:onto the battlefield|into your hand)\b|\byou may cast [^.]*? from your graveyard\b/i,
};

/** Rôles fonctionnels détectés dans le texte Oracle. */
export function cardFunctions(p) {
  const out = [];
  const addF = (key, s) => { if (!out.some((x) => x.key === key)) out.push({ key, snippet: snippet(s || '') }); };
  const isLand = p.cardObjs.length && p.cardObjs[0].types.has('land');
  const isSpell = p.cardObjs.some((o) => o.types.has('instant') || o.types.has('sorcery'));
  if (isLand) return out;
  for (const s of p.sentences) {
    if (FN.landRamp.test(s)) addF('ramp', s);
    if (!isSpell && FN.manaAbility.test(s)) addF('ramp', s);
    if (isSpell && FN.ritual.test(s) && FN.landRamp.test(s)) addF('ramp', s);
    if (FN.multiDraw.test(s) && !/\b(?:target|each) opponent\b[^.]*\bdraws?\b/i.test(s)) addF('draw', s);
    else if (FN.draw.test(s) && !RE.drawL.test(s) && (/\b(?:whenever|at the beginning)\b/i.test(s) || /:/.test(s)) && !/\b(?:an|each|target) opponent draws?\b/i.test(s)) addF('draw', s);
    if (FN.impulse.test(s)) addF('draw', s);
    for (const re of FN.removal) {
      const m = s.match(re);
      if (!m) continue;
      const tail = m[1] || '';
      if (/\byou control\b|\byou own\b|\bcards?\b|\bgraveyard\b/i.test(tail)) continue;
      addF('removal', s); break;
    }
    for (const re of FN.wipe) if (re.test(s)) { addF('wipe', s); break; }
    const tm = s.match(FN.tutor);
    if (tm && !/^\s*(?:up to (?:one|two|three) |a |an |two )?(?:basic )?(?:land|basic land|forest|island|swamp|mountain|plains)[a-z ,]* cards?\b/i.test(tm[1]) && !/\bopponent\b/i.test(s)) addF('tutor', s);
    if (FN.recursion.test(s)) addF('recursion', s);
  }
  if (p.provides.protect) addF('protection', p.provides.protect[0].snippet);
  if (p.provides.costReduce && !isSpell) addF('ramp', p.provides.costReduce[0].snippet);
  if (p.tokenObjs.some((t) => (t.tokenName || '').toLowerCase() === 'treasure')) addF('ramp', 'Crée des Trésors');
  if (p.tokenObjs.some((t) => (t.tokenName || '').toLowerCase() === 'clue')) addF('draw', 'Crée des Indices');
  return out;
}

function displaySub(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ---------------------------------------------------------------------------
// Extraction des déclencheurs et des effets
// ---------------------------------------------------------------------------

const RE = {
  etb: /\bwhenever (.+?) (?:enters|enter)\b(?: the battlefield)?(?: under ([a-z' ]+?) control)?/i,
  selfEtb: /\bwhen(?:ever)? ~(?: or [^,.]+?)? (?:enters|is turned face up)\b/i,
  dies: /\bwhenever (.+?) (?:dies|die|(?:is|are) put into (?:a|your|an opponent's) graveyard from the battlefield)\b/i,
  selfDies: /\bwhen(?:ever)? ~ (?:dies|is put into a graveyard from the battlefield)\b/i,
  attack: /\bwhenever (.+?) attacks?\b(.{0,12})/i,
  youAttack: /\bwhenever you attack\b/i,
  cast: /\bwhenever (you|a player|an opponent|each player) casts? (?:or cop(?:y|ies) )?(.+?) spells?\b([^,.]*)/i,
  lifegainL: /\bwhenever you gain life\b|\bwhenever you gain (?:one or more )?life\b|\bif you would gain life\b/i,
  oppLossL: /\bwhenever (?:an|each) opponent loses life\b|\bwhenever a player loses life\b/i,
  drawL: /\bwhenever you draw (?:a|your (?:first|second|third) card|one or more cards?)\b/i,
  discardL: /\bwhenever you discard\b/i,
  graveyardL: /\b(?:from|in) your graveyard\b|\bcards? in (?:your|all|each player's) graveyards?\b/i,
  sacL: /\bwhenever (?:you|a player) sacrifices? (.+?)(?:,|$)/i,
  tokensL: /\bwhenever you create (.+?)\btokens?\b/i,
  tokensAmp: /\bif (?:an effect|one or more effects|you) would (?:create|put) (?:one or more |a |an )?(.*?)\btokens?\b/i,
  tokensAmp2: /\bif one or more tokens would be created\b/i,
  countersL: /\bwhenever one or more \+1\/\+1 counters are put on\b|\bwith (?:a|one or more) \+1\/\+1 counters? on (?:it|them)\b|\bfor each \+1\/\+1 counter\b|\bnumber of \+1\/\+1 counters\b|\bremove (?:a|an|one|two|three|x|\d+|any number of) \+1\/\+1 counters? from\b|\bproliferate\b/i,
  countersAmp: /\bif one or more \+1\/\+1 counters would be put on\b|\bthat many plus one \+1\/\+1 counters\b|\bwould put one or more counters on (?:a|each) (?:permanent|creature)s? you control\b/i,
  countersP: /\bput(?:s)? (?:a|an|one|two|three|four|five|six|x|\d+|that many|[a-z]+ additional) \+1\/\+1 counters?\b|\benters with (?:a|an|one|two|three|four|five|six|x|\d+|that many|[a-z]+ additional) \+1\/\+1 counters?\b|\bproliferate\b/i,
  lifegainP: /\b(?:you )?gains? (?:\d+|x|that much) life\b|\bgains? life equal\b|\bgains? an amount of life\b|\b(?:has|have|gains?) lifelink\b/i,
  oppLossP: /\b(?:each|target|that|defending) (?:opponent|player)s? loses? (?:\d+|x|that much|life|half)\b|\bdeals? (?:\d+|x|that much) damage to (?:each opponent|target opponent|any target|target player|each player|target player or planeswalker)\b|\bloses? (?:\d+|x) life and you gain\b/i,
  drawP: /\bdraws? (?:a|an|one|two|three|four|five|six|seven|x|\d+|that many) cards?\b|\bdraws? (?:an? )?additional cards?\b|\bdraws? cards? equal\b|\binvestigate\b/i,
  discardP: /\bdiscards? (?:a|one|two|three|x|\d+|that many|your hand|any number of|up to \w+) (?:cards?|card)?|\bdiscard your hand\b/i,
  millP: /\bmills? (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+|that many|half) cards?\b|\bsurveil\b|\bput the top [^.]*? cards? of your library into your graveyard\b/i,
  blinkP: /\bexile\b[^.]*\.?[^.]*\breturn (?:it|them|that card|those cards|the exiled cards?|each card exiled this way|that permanent|those permanents)\b[^.]*\bto the battlefield\b/i,
  blinkTarget: /\bexile (?:up to (?:one|two|three|x) )?(?:another )?(?:target |each |all |any number of target )?([a-z ]+?)(?: you control| you own)\b/i,
  etbDoubler: /\bif (?:an? |another )?(.+?) entering(?: the battlefield)? causes a triggered ability\b/i,
  sacOutletCost: /\bsacrifice (?:a|an|another|one or more|x|two|three|any number of) ([^:,.]+?)(?:\s*:|\s*,[^.]*:)/i,
  sacOutletAdd: /\bas an additional cost to cast [^,]+, sacrifice (?:a|an|another|one or more|x|two|three) ([^.]+?)\./i,
  sacOutletMay: /\byou may sacrifice (?:a|an|another|one or more|x|two|three|any number of) ([^.]+?)\. (?:if you do|when you do)\b/i,
  reanimateP: /\b(?:return|put)s? [^.]*?\bcreature cards?\b[^.]*?\b(?:onto|to) the battlefield\b/i,
  rampP: /\bsearch your library for [^.]*?\blands? cards?\b[^.]*?\bonto the battlefield\b|\bput (?:a|up to \w+|any number of) land cards? from your (?:hand|graveyard) onto the battlefield\b|\bplay an additional land\b|\bplay (?:two|three) additional lands\b/i,
  commanderL: /\byour commanders?\b|\bcommanders? you (?:control|own)\b/i,
  tutor: /\bsearch your library (?:and(?: your)? graveyard |and\/or graveyard )?for (?:a|an|up to (?:one|two|three|four|x)|any number of|two|three|x) ([^,.]+?) cards?\b( with (?:power|toughness|mana value) \d+ or (?:less|greater|more|fewer))?([^,.]{0,4})/i,
  protectGrant: /\b(?:gains?|have|has)\b[^.]*?\b(hexproof|indestructible|shroud|protection from|ward)\b|\bpermanents you control phase out\b/i,
  costReduce: /(?:^|[.;]\s*|,\s*)(?:each\s+)?([A-Za-z ,'-]*?)\s*spells? you cast costs? ((?:\{[^}]+\})+) less\b/i,
  hoses: [
    ['graveyard', /\bif (?:a|an|one or more) (?:card|cards|nontoken card|card or token|cards or tokens)[^.]*? would be put into (?:a|any) graveyard from anywhere[^.]*?exile (?:it|them) instead\b/i],
    ['graveyardCage', /\bcreature cards in graveyards[^.]*can't enter the battlefield\b/i],
    ['etb', /\b(?:creatures?|permanents?)(?: or [a-z]+)? entering(?: the battlefield)?(?: or dying)? (?:don't|doesn't) cause abilities to trigger\b/i],
    ['dies', /\b(?:entering(?: the battlefield)? or dying|creatures? dying) (?:don't|doesn't) cause abilities to trigger\b/i],
    ['artifactAbilities', /\bactivated abilities of artifacts(?: and creatures| or creatures)? can't be activated\b/i],
    ['creatureAbilities', /\bactivated abilities of (?:creatures|artifacts and creatures|artifacts or creatures) can't be activated\b/i],
    ['lifegain', /\b(?:players|each player) can't gain life\b|\bif a player would gain life, that player gains no life instead\b/i],
    ['draw', /\beach player can't draw more than one card each turn\b/i],
    ['cast', /\beach player can't cast more than one spell each turn\b/i],
  ],
};

function extractFeatures(p, ctx) {
  const L = p.listens; const P = p.provides;
  const ss = p.sentences;

  // --- Ce que la carte fait arriver sur le champ de bataille
  for (const o of p.permObjs) p.enters.push({ obj: o, origin: 'self' });
  for (const t of p.tokenObjs) p.enters.push({ obj: t, origin: 'token', detail: t.tokenName || '' });

  for (const s of ss) {
    // --- Écoutes
    let m;
    if ((m = s.match(RE.etb))) {
      const desc = m[1].replace(/^~ or /i, '').replace(/^~,\s*/i, '');
      const ctl = (m[2] || '').toLowerCase();
      if (!/~/.test(desc) && !/opponent/.test(ctl)) {
        const d = parseDescriptor(desc, ctx);
        if (d && !d.opponent) {
          L.etb = L.etb || []; L.etb.push({ pred: d.pred, snippet: snippet(s) });
          P.etbListener = true;
        }
      }
    }
    if (RE.selfEtb.test(s)) { L.selfEtb = true; P.selfEtb = true; }
    if ((m = s.match(RE.dies))) {
      const desc = m[1].replace(/^~ or /i, '');
      if (!/~/.test(desc)) {
        const d = parseDescriptor(desc, ctx);
        if (d && !d.opponent) { L.dies = L.dies || []; L.dies.push({ pred: d.pred, snippet: snippet(s) }); }
      }
    }
    if (RE.selfDies.test(s)) L.selfDies = true;
    if ((m = s.match(RE.attack))) {
      const desc = m[1];
      const after = m[2] || '';
      if (!/~/.test(desc) && !/^\s*(you|one of your|a planeswalker you)/i.test(after)) {
        const d = parseDescriptor(desc, ctx);
        if (d && !d.opponent) { L.attack = L.attack || []; L.attack.push({ pred: (o) => o.types.has('creature') && d.pred(o), snippet: snippet(s) }); }
      }
    }
    if (RE.youAttack.test(s)) { L.attack = L.attack || []; L.attack.push({ pred: (o) => o.types.has('creature'), snippet: snippet(s) }); }
    if ((m = s.match(RE.cast))) {
      const who = m[1].toLowerCase();
      const trail = (m[3] || '').trim();
      const trailOk = !trail || /^(with (power|toughness|mana value) \d+ or (greater|more|less|fewer)|each turn|this turn)$/i.test(trail);
      if (who !== 'an opponent' && trailOk) {
        const d = parseDescriptor(`${m[2]} spell ${trail}`.trim(), ctx, { context: 'spell' });
        if (d && !d.opponent) { L.cast = L.cast || []; L.cast.push({ pred: d.pred, snippet: snippet(s) }); }
      }
    }
    if (RE.lifegainL.test(s) && !L.lifegain) L.lifegain = { snippet: snippet(s) };
    if (RE.oppLossL.test(s) && !L.oppLoss) L.oppLoss = { snippet: snippet(s) };
    if (RE.drawL.test(s) && !L.draw) L.draw = { snippet: snippet(s) };
    if (RE.discardL.test(s) && !L.discard) L.discard = { snippet: snippet(s) };
    if (RE.graveyardL.test(s) && !L.graveyard) L.graveyard = { snippet: snippet(s) };
    if ((m = s.match(RE.sacL))) {
      const d = parseDescriptor(m[1], ctx, { context: 'any' });
      if (d && !d.opponent) { L.sacrifice = L.sacrifice || []; L.sacrifice.push({ pred: d.pred, snippet: snippet(s) }); }
    }
    if ((m = s.match(RE.tokensL))) {
      const desc = m[1].trim();
      const d = desc ? parseDescriptor(`${desc} token`, ctx, { context: 'any' }) : { pred: () => true };
      if (d && !d.opponent) { L.tokens = L.tokens || []; L.tokens.push({ pred: d.pred, snippet: snippet(s), amplify: false }); }
    }
    if ((m = s.match(RE.tokensAmp))) {
      const desc = (m[1] || '').trim();
      const d = desc ? parseDescriptor(`${desc} token`, ctx, { context: 'any' }) : { pred: () => true };
      if (d && !d.opponent) { L.tokens = L.tokens || []; L.tokens.push({ pred: d.pred, snippet: snippet(s), amplify: true }); }
    } else if (RE.tokensAmp2.test(s)) { L.tokens = L.tokens || []; L.tokens.push({ pred: () => true, snippet: snippet(s), amplify: true }); }
    const isCounterProvider = RE.countersP.test(s);
    if (RE.countersAmp.test(s)) L.counters = { snippet: snippet(s), amplify: true };
    else if (RE.countersL.test(s) && !L.counters && (!isCounterProvider || /\bproliferate\b/i.test(s) || /\bfor each\b|\bwhenever\b/i.test(s))) L.counters = { snippet: snippet(s), amplify: false };
    if ((m = s.match(RE.etbDoubler))) {
      const d = parseDescriptor(m[1], ctx);
      if (d && !d.opponent) { L.etbDoubler = L.etbDoubler || []; L.etbDoubler.push({ pred: d.pred, snippet: snippet(s) }); }
    }
    if (RE.commanderL.test(s) && !p.isCommander && !L.commander) L.commander = { snippet: snippet(s) };

    // --- Effets fournis
    if ((m = s.match(RE.lifegainP)) && !RE.lifegainL.test(s)) {
      const before = s.slice(0, m.index);
      // « Its controller gains life… » (Swords to Plowshares) profite à l'adversaire
      if (!/\b(?:its controller|that player|target player|its owner|their controller|an opponent|each opponent|that creature's controller|target opponent)\s*$/i.test(before)) P.lifegain = true;
    }
    if (RE.oppLossP.test(s) && !RE.oppLossL.test(s)) P.oppLoss = true;
    if (RE.drawP.test(s) && !RE.drawL.test(s)) {
      const before = s.slice(0, s.search(RE.drawP));
      if (!/\b(opponent|opponents)\b[^,.]*$/i.test(before)) P.draw = true;
    }
    if ((m = s.match(RE.discardP)) && !RE.discardL.test(s)) {
      const before = s.slice(0, m.index);
      if (!/\b(opponent|opponents)\b[^,.]*$/i.test(before) && !/\btarget player\b[^,.]*$/i.test(before)) P.discard = true;
    }
    if (RE.millP.test(s)) {
      const mm = s.match(RE.millP);
      const before = s.slice(0, mm.index);
      if (!/\b(target opponent|each opponent|target player)\b[^,.]*$/i.test(before)) P.mill = true;
    }
    if (RE.countersP.test(s)) P.counters = true;
    if (RE.blinkP.test(s)) {
      const t = s.match(RE.blinkTarget);
      let d = null;
      if (t) d = parseDescriptor(t[1], ctx);
      P.blink = P.blink || [];
      P.blink.push({ pred: d && d.pred ? d.pred : (o) => o.types.has('creature'), snippet: snippet(s) });
    }
    for (const re of [RE.sacOutletCost, RE.sacOutletAdd, RE.sacOutletMay]) {
      const sm = s.match(re);
      if (sm && !/~/.test(sm[1])) {
        const d = parseDescriptor(sm[1].replace(/\s+(?:you control|from among)\b.*$/i, ' you control'), ctx, { context: 'any' });
        if (d && !d.opponent) { P.sacOutlets = P.sacOutlets || []; P.sacOutlets.push({ pred: d.pred, snippet: snippet(s) }); }
      }
    }
    if (RE.reanimateP.test(s)) {
      if (!p.enters.some((e) => e.origin === 'reanimate')) p.enters.push({ obj: genericObj('creature'), origin: 'reanimate' });
    } else if (/\bput (?:a|up to \w+|any number of) creature cards? from your hand onto the battlefield\b/i.test(s)) {
      if (!p.enters.some((e) => e.origin === 'reanimate')) p.enters.push({ obj: genericObj('creature'), origin: 'reanimate' });
    }
    if (RE.rampP.test(s) && !p.enters.some((e) => e.origin === 'ramp')) p.enters.push({ obj: genericObj('land'), origin: 'ramp' });

    // Tuteurs (hors recherche de terrains, déjà comptée comme rampe)
    if ((m = s.match(RE.tutor))) {
      const desc = m[1].trim();
      const known = m[2] || '';
      const after = m[3] || '';
      if (!/\bland\b/i.test(desc) && !/^\s*with\b/i.test(after) && !/\bnamed\b/i.test(desc)) {
        const d = parseDescriptor(`${desc} card${known}`, ctx, { context: 'any' });
        if (d && !d.opponent) { P.tutor = P.tutor || []; P.tutor.push({ pred: d.pred, snippet: snippet(s) }); }
      }
    }
    // Protection accordée à tes permanents
    const mineScoped = /\byou control\b/i.test(s) || (/\b(?:equipped|enchanted) creature\b/i.test(s) && p.permObjs.some((o) => o.subs.has('equipment') || o.subs.has('aura')));
    if (RE.protectGrant.test(s) && mineScoped && !/\bopponents?\b/i.test(s)) {
      P.protect = P.protect || [];
      P.protect.push({ snippet: snippet(s), creatureOnly: /\bcreatures?\b/i.test(s) && !/\bpermanents?\b/i.test(s) });
    }
    // Réducteurs de coût
    if ((m = s.match(RE.costReduce)) && !/\bopponents?\b/i.test(s)) {
      const desc = m[1].replace(/\s+and\s+/gi, ' or ').trim();
      const d = desc ? parseDescriptor(`${desc} spell`, ctx, { context: 'spell' }) : { pred: (o) => !o.types.has('land') };
      if (d && !d.opponent) { P.costReduce = P.costReduce || []; P.costReduce.push({ pred: d.pred, snippet: snippet(s) }); }
    }
    // Effets symétriques qui gênent tes propres cartes
    for (const [key, re] of RE.hoses) {
      if (re.test(s) && (key === 'graveyard' || !/\bopponents?\b/i.test(s))) {
        P.hoses = P.hoses || [];
        if (!P.hoses.some((h) => h.key === key)) P.hoses.push({ key, snippet: snippet(s) });
      }
    }
  }

  // Équipements et auras bénéfiques (pour un commandant créature)
  const isEquip = p.permObjs.some((o) => o.subs.has('equipment'));
  const isAura = p.permObjs.some((o) => o.subs.has('aura')) && /\benchant creature\b/i.test(p.text);
  const boost = p.text.match(/[^.\n]*\b(?:equipped|enchanted) creature (?:gets \+|has |gains |can't be blocked)[^.\n]*/i);
  const harmful = /\benchanted creature (?:can't attack|can't block|doesn't untap|loses all abilities|gets -\d)/i.test(p.text) || /\b(?:equipped|enchanted) creature gets [+-]\d+\/-\d/i.test(p.text);
  if ((isEquip || isAura) && !harmful && boost) P.voltron = { snippet: snippet(boost[0]) };

  // Mots-clés
  if (p.kw.has('prowess')) { L.cast = L.cast || []; L.cast.push({ pred: (o) => !o.types.has('creature') && !o.types.has('land'), snippet: 'Prowess' }); }
  if (p.kw.has('lifelink')) P.lifegain = true;
  if (p.kw.has('madness') && !L.discard) L.discard = { snippet: 'Madness' };
  if (GRAVEYARD_KEYWORDS.some((k) => p.kw.has(k)) && !L.graveyard) L.graveyard = { snippet: [...p.kw].filter((k) => GRAVEYARD_KEYWORDS.includes(k)).map(cap).join(', ') };
  if (MILL_KEYWORDS.some((k) => p.kw.has(k))) P.mill = true;
  if (DISCARD_KEYWORDS.some((k) => p.kw.has(k))) P.discard = true;
  if (p.kw.has('cycling')) P.draw = true;
  if (COUNTER_KEYWORDS_REAL.some((k) => p.kw.has(k))) P.counters = true;
  if (p.kw.has('proliferate') && !L.counters) L.counters = { snippet: 'Proliferate', amplify: false };
  if (p.kw.has('exploit')) { P.sacOutlets = P.sacOutlets || []; P.sacOutlets.push({ pred: (o) => o.types.has('creature'), snippet: 'Exploit' }); }
  // Jetons qui fournissent des effets (Nourriture -> vie, Indice -> pioche, Sang -> défausse)
  for (const t of p.tokenObjs) {
    const n = (t.tokenName || '').toLowerCase();
    if (n === 'food') P.lifegain = true;
    if (n === 'clue') P.draw = true;
    if (n === 'blood') { P.discard = true; P.draw = true; }
  }

  // Tribal : sous-types mentionnés dans le texte (hors "create … token" et "named …")
  const tribalText = p.text
    .replace(/\bnamed [^,.]+/g, ' ')
    .replace(/\bcreates? [^.]*?\btokens?\b/gi, ' ');
  const mentioned = new Set();
  const snippets = new Map();
  for (const s of sentencesOf(tribalText)) {
    for (const w of s.match(/\b[A-Z][a-zA-Z'\-]+\b/g) || []) {
      const lw = w.toLowerCase();
      if (!ctx.subToCanon.has(lw)) continue;
      const sub = ctx.subToCanon.get(lw);
      if (!ctx.nonLandSubs.has(sub)) continue; // Forest, Island… : pas du tribal
      // ignorer les mots qui sont des types de carte ou des mots-clés usuels
      if (CARD_TYPES.includes(sub)) continue;
      mentioned.add(sub);
      if (!snippets.has(sub)) snippets.set(sub, snippet(s));
    }
  }
  L.tribal = mentioned; L.tribalSnippets = snippets;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

export const HOSE_LABEL = {
  graveyard: 'le cimetière et les morts',
  graveyardCage: 'la réanimation',
  etb: "les effets d'arrivée",
  dies: 'les effets de mort',
  artifactAbilities: 'les capacités des artefacts',
  creatureAbilities: 'les capacités des créatures',
  lifegain: 'le gain de vie',
  draw: 'la pioche multiple',
  cast: 'les sorts multiples',
};

function describeRoles(p) {
  const L = p.listens; const P = p.provides;
  const listens = []; const provides = [];
  if (L.etb) listens.push("Arrivée d'un permanent");
  if (L.selfEtb) listens.push("Effet à sa propre arrivée");
  if (L.dies) listens.push('Mort de créatures');
  if (L.selfDies) listens.push('Effet à sa propre mort');
  if (L.attack) listens.push('Attaques');
  if (L.cast) listens.push('Sorts lancés');
  if (L.lifegain) listens.push('Gain de points de vie');
  if (L.oppLoss) listens.push('Perte de vie adverse');
  if (L.draw) listens.push('Pioche');
  if (L.discard) listens.push('Défausse');
  if (L.graveyard) listens.push('Cimetière');
  if (L.sacrifice) listens.push('Sacrifices');
  if (L.tokens) listens.push(L.tokens.some((t) => t.amplify) ? 'Multiplie les jetons' : 'Création de jetons');
  if (L.counters) listens.push(L.counters.amplify ? 'Multiplie les marqueurs +1/+1' : 'Marqueurs +1/+1');
  if (L.etbDoubler) listens.push("Double les déclencheurs d'arrivée");
  if (L.commander) listens.push('Commandant');
  if (L.tribal && L.tribal.size) listens.push(`Types : ${[...L.tribal].map(displaySub).join(', ')}`);
  if (p.tokenObjs.length) provides.push(`Jetons : ${[...new Set(p.tokenObjs.map((t) => t.tokenName))].join(', ')}`);
  if (P.sacOutlets) provides.push('Sacrifie');
  if (P.blink) provides.push('Fait sortir et revenir');
  if (P.lifegain) provides.push('Gain de points de vie');
  if (P.oppLoss) provides.push('Fait perdre des PV');
  if (P.draw) provides.push('Pioche');
  if (P.discard) provides.push('Défausse');
  if (P.mill) provides.push('Remplit le cimetière');
  if (P.counters) provides.push('Marqueurs +1/+1');
  if (p.enters.some((e) => e.origin === 'reanimate')) provides.push('Met des créatures en jeu');
  if (p.enters.some((e) => e.origin === 'ramp')) provides.push('Met des terrains en jeu');
  if (P.tutor) provides.push('Va chercher des cartes');
  if (P.costReduce) provides.push('Réduit des coûts');
  if (P.protect) provides.push('Protège tes permanents');
  if (P.voltron) provides.push('Renforce une créature');
  if (P.hoses) provides.push(`Gêne : ${P.hoses.map((h) => HOSE_LABEL[h.key]).join(', ')}`);
  return { listens, provides };
}

// ---------------------------------------------------------------------------
// Fusion avec les liens existants d'un deck
// ---------------------------------------------------------------------------

export function linkKey(from, to, kind) { return `${from}|${to}|${kind}`; }

/**
 * Fusionne les suggestions recalculées avec les liens enregistrés.
 * - liens manuels : conservés tant que les deux cartes sont dans le deck
 * - suggestions validées / rejetées : statut conservé
 * - nouvelles suggestions : statut "pending"
 * - suggestions en attente qui ne sont plus proposées : retirées
 */
export function mergeLinks(existing, suggestions, presentIds) {
  const present = new Set(presentIds);
  const out = [];
  const byKey = new Map();
  for (const l of existing || []) {
    if (!present.has(l.from) || !present.has(l.to)) continue;
    byKey.set(l.origin === 'manual' ? `m:${l.id}` : linkKey(l.from, l.to, l.kind), l);
  }
  const seen = new Set();
  for (const s of suggestions) {
    const k = linkKey(s.from, s.to, s.kind);
    seen.add(k);
    const prev = byKey.get(k);
    if (prev) out.push({ ...prev, reasons: s.reasons, score: s.score, stale: undefined });
    else out.push({ id: `a:${k}`, from: s.from, to: s.to, kind: s.kind, origin: 'auto', status: 'pending', reasons: s.reasons, score: s.score, note: '' });
  }
  for (const [k, l] of byKey) {
    if (k.startsWith('m:')) { out.push(l); continue; }
    if (seen.has(k)) continue;
    if (l.status === 'accepted' || l.status === 'rejected') out.push({ ...l, stale: true });
  }
  return out;
}

/** Composantes fortement connexes (Tarjan) de taille > 1 : boucles possibles. */
export function findLoops(nodeIds, links) {
  const adj = new Map(nodeIds.map((id) => [id, []]));
  for (const l of links) if (adj.has(l.from) && adj.has(l.to)) adj.get(l.from).push(l.to);
  let index = 0; const stack = []; const on = new Set(); const idx = new Map(); const low = new Map(); const out = [];
  const strong = (v) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
    for (const w of adj.get(v)) {
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = []; let w;
      do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) out.push(comp);
    }
  };
  for (const v of nodeIds) if (!idx.has(v)) strong(v);
  return out;
}
