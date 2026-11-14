// Regroupement des liens répétitifs : « 21 cartes qui arrivent en jeu → Cathars' Crusade »
// devient une seule entrée au lieu de 21. Pur, sans interface.
import { specificity } from './analyzer.js';

export const GROUP_MIN = 4;

function ruleOf(l) { return l.origin === 'manual' ? 'manual' : (l.reasons && l.reasons[0] ? l.reasons[0].rule : 'other'); }

/**
 * @param {Array} links liens déjà filtrés (statut, type…)
 * @param {{min?: number}} opts
 * @returns {{groups: Array<{id, side, anchor, kind, rule, members}>, singles: Array}}
 *   side = 'to' : plusieurs cartes agissent sur la même carte (anchor = cible)
 *   side = 'from' : une carte agit sur plusieurs cartes (anchor = source)
 */
export function groupLinks(links, { min = GROUP_MIN, sides = ['to', 'from'] } = {}) {
  const groups = [];
  const used = new Set();
  const bucket = (side) => {
    const m = new Map();
    for (const l of links) {
      if (used.has(l.id) || l.origin === 'manual') continue;
      const anchor = side === 'to' ? l.to : l.from;
      const key = `${side}|${anchor}|${l.kind}|${ruleOf(l)}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(l);
    }
    for (const [key, members] of m) {
      if (members.length < min) continue;
      const [, anchor, kind, rule] = key.split('|');
      groups.push({ id: `g:${key}`, side, anchor, kind, rule, members });
      for (const l of members) used.add(l.id);
    }
  };
  for (const s of sides) bucket(s);
  const singles = links.filter((l) => !used.has(l.id));
  return { groups, singles };
}

/** Retrouve les membres d'un groupe à partir de son identifiant (indépendamment des filtres). */
export function membersOf(groupId, links) {
  if (!String(groupId).startsWith('g:')) return [];
  const { side, anchor, kind, rule } = parseGroupId(groupId);
  if (!side || !anchor) return [];
  return links.filter((l) => l.origin !== 'manual' && l.kind === kind && ruleOf(l) === rule && (side === 'to' ? l.to === anchor : l.from === anchor));
}

export function parseGroupId(groupId) {
  const [side, anchor, kind, rule] = String(groupId).slice(2).split('|');
  return { side, anchor, kind, rule };
}

/** Score d'un groupe pris dans son ensemble (la relation globale, sans pénalité de nombre). */
export function groupScore(g) {
  const best = Math.max(...g.members.map((l) => (l.score ?? 100)));
  return Math.min(100, Math.round(best / specificity(g.members.length)));
}

export function groupStatus(g) {
  const c = { accepted: 0, pending: 0, rejected: 0 };
  for (const l of g.members) c[l.status] = (c[l.status] || 0) + 1;
  return c;
}

/** Suggestions faibles (non groupées, en attente) à masquer quand l'option est active. */
export function isWeakPending(l) {
  return l.status === 'pending' && l.origin !== 'manual' && typeof l.score === 'number' && l.score < 30;
}
