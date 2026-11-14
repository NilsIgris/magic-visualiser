// Phrases d'explication des liens, en français.
import { displayName } from '../../shared/normalize.js';
import { HOSE_LABEL } from '../../shared/analyzer.js';

const ORIGIN = {
  self: (a) => `${a} arrive sur le champ de bataille`,
  token: (a, d) => `${a} crée des jetons${d ? ` ${d}` : ''} qui arrivent sur le champ de bataille`,
  reanimate: (a) => `${a} met une créature sur le champ de bataille`,
  ramp: (a) => `${a} met un terrain sur le champ de bataille`,
};

const RULES = {
  etb: (a, b, r) => `${(ORIGIN[r.origin] || ORIGIN.self)(a, r.detail)} : ça déclenche ${b}.`,
  blink: (a, b) => `${a} fait sortir puis revenir ${b}, ce qui relance son effet d'arrivée.`,
  etbDouble: (a, b) => `${b} fait se déclencher une fois de plus les capacités d'arrivée liées à ${a}.`,
  dies: (a, b, r) => (r.origin === 'token' ? `Les jetons${r.detail ? ` ${r.detail}` : ''} créés par ${a} peuvent mourir et déclencher ${b}.` : `${a} peut mourir et déclencher ${b}.`),
  diesOutlet: (a, b) => `${a} permet de sacrifier des créatures, ce qui déclenche ${b}.`,
  selfDiesOutlet: (a, b) => `${a} peut sacrifier ${b} pour profiter de son effet de mort.`,
  attack: (a, b, r) => (r.origin === 'token' ? `Les jetons de ${a} peuvent attaquer et déclencher ${b}.` : `${a} peut attaquer et déclencher ${b}.`),
  cast: (a, b) => `Lancer ${a} déclenche ${b}.`,
  lifegain: (a, b) => `${a} te fait gagner des points de vie, ce qui déclenche ${b}.`,
  oppLoss: (a, b) => `${a} fait perdre des points de vie aux adversaires, ce qui déclenche ${b}.`,
  draw: (a, b) => `${a} te fait piocher, ce qui déclenche ${b}.`,
  discard: (a, b) => `${a} te fait défausser, ce qui déclenche ${b}.`,
  mill: (a, b) => `${a} remplit ton cimetière, ressource utilisée par ${b}.`,
  sac: (a, b) => `${a} sacrifie des permanents, ce qui déclenche ${b}.`,
  sacToken: (a, b, r) => `${a} crée des jetons${r.detail ? ` ${r.detail}` : ''} qui se sacrifient, ce qui déclenche ${b}.`,
  tokens: (a, b, r) => `${a} crée des jetons${r.detail ? ` ${r.detail}` : ''}, ce qui déclenche ${b}.`,
  tokensAmp: (a, b, r) => `${b} augmente le nombre de jetons${r.detail ? ` ${r.detail}` : ''} créés par ${a}.`,
  counters: (a, b) => `${a} pose des marqueurs +1/+1, que ${b} exploite.`,
  countersAmp: (a, b) => `${b} augmente les marqueurs posés par ${a}.`,
  commander: (a, b) => `${b} tire parti de ton commandant ${a}.`,
  tribal: (a, b, r) => `${a} est de type ${r.detail}, un type que ${b} favorise.`,
  tutor: (a, b) => `${a} peut aller chercher ${b} dans ta bibliothèque.`,
  costReduce: (a, b) => `${a} réduit le coût de ${b}.`,
  protect: (a, b) => `${a} peut protéger ton commandant ${b}.`,
  voltron: (a, b) => `${a} peut équiper ou enchanter ton commandant ${b} pour le renforcer.`,
  anti: (a, b, r) => `${a} bloque ${HOSE_LABEL[r.detail] || 'certains effets'} pour tous les joueurs, toi compris : ${b} en pâtit.`,
};

// Libellés des groupes de liens. side 'to' : les membres sont les sources ; side 'from' : les cibles.
const GROUP_TO = {
  etb: (n) => `${n} cartes qui arrivent en jeu`,
  etbDouble: (n) => `${n} effets d'arrivée`,
  dies: (n) => `${n} créatures qui peuvent mourir`,
  diesOutlet: (n) => `${n} façons de sacrifier`,
  attack: (n) => `${n} attaquants possibles`,
  cast: (n) => `${n} sorts qui la déclenchent`,
  lifegain: (n) => `${n} sources de gain de vie`,
  oppLoss: (n) => `${n} sources de perte de vie adverse`,
  draw: (n) => `${n} sources de pioche`,
  discard: (n) => `${n} sources de défausse`,
  mill: (n) => `${n} cartes qui remplissent le cimetière`,
  sac: (n) => `${n} sources de sacrifice`,
  sacToken: (n) => `${n} créateurs de jetons à sacrifier`,
  tokens: (n) => `${n} créateurs de jetons`,
  tokensAmp: (n) => `${n} créateurs de jetons`,
  counters: (n) => `${n} cartes à marqueurs +1/+1`,
  countersAmp: (n) => `${n} cartes à marqueurs +1/+1`,
  tribal: (n) => `${n} cartes du bon type`,
  protect: (n) => `${n} protections`,
  voltron: (n) => `${n} équipements et auras`,
};
const GROUP_FROM = {
  etb: (n) => `${n} cartes déclenchées par son arrivée`,
  blink: (n) => `${n} cartes à effet d'arrivée`,
  etbDouble: (n) => `${n} cartes amplifiées`,
  dies: (n) => `${n} cartes déclenchées par sa mort`,
  diesOutlet: (n) => `${n} cartes qui profitent des sacrifices`,
  selfDiesOutlet: (n) => `${n} cartes à effet de mort`,
  cast: (n) => `${n} cartes déclenchées quand tu la lances`,
  lifegain: (n) => `${n} cartes qui réagissent au gain de vie`,
  draw: (n) => `${n} cartes qui réagissent à la pioche`,
  tokens: (n) => `${n} cartes qui réagissent aux jetons`,
  tokensAmp: (n) => `${n} doubleurs de jetons`,
  counters: (n) => `${n} cartes qui exploitent les marqueurs`,
  countersAmp: (n) => `${n} doubleurs de marqueurs`,
  commander: (n) => `${n} cartes qui utilisent ton commandant`,
  tutor: (n) => `${n} cartes qu'elle peut aller chercher`,
  costReduce: (n) => `${n} sorts moins chers`,
  anti: (n) => `${n} cartes gênées`,
  tribal: (n) => `${n} cartes qui favorisent son type`,
};

export function describeGroup(g) {
  const n = g.members.length;
  const f = (g.side === 'to' ? GROUP_TO : GROUP_FROM)[g.rule];
  return f ? f(n) : `${n} cartes`;
}

export function describeReason(reason, fromCard, toCard, lang) {
  const a = `« ${displayName(fromCard, lang)} »`;
  const b = `« ${displayName(toCard, lang)} »`;
  const f = RULES[reason.rule];
  return f ? f(a, b, reason) : `${a} → ${b}`;
}

export function describeLink(link, deck, lang) {
  const a = deck.cards[link.from]; const b = deck.cards[link.to];
  if (!a || !b) return '';
  if (link.origin === 'manual') return link.note || 'Lien ajouté manuellement.';
  return (link.reasons || []).map((r) => describeReason(r, a, b, lang)).join(' ');
}
