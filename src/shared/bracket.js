// Estimation du bracket Commander minimal d'après les règles publiées par Wizards of the Coast
// (brackets 1 à 5 ; Game Changers limités à 3 en bracket 3, aucun en 1-2 ; pas de destruction
// massive de terrains en 1-3 ; pas de combo infinie à deux cartes en 1-2, ni tôt dans la partie en 3 ;
// tours supplémentaires absents en 1, rares et non enchaînés en 2-3).
// Le bracket dépend aussi de l'intention du joueur : ce calcul ne donne qu'un plancher.

export const BRACKET_NAMES = { 1: 'Exhibition', 2: 'Core', 3: 'Upgraded', 4: 'Optimized', 5: 'cEDH' };

/**
 * @param {{gameChangers: string[], twoCardCombos: number|null, massLandDenial: string[], extraTurns: string[]}} f
 *   twoCardCombos = null si l'analyse des combos n'a pas été faite.
 */
export function estimateBracket(f) {
  let min = 1;
  const reasons = [];
  const raise = (n, text) => { if (n > min) min = n; reasons.push({ bracket: n, text }); };
  const gc = f.gameChangers.length;
  if (f.extraTurns.length) raise(2, `${f.extraTurns.length} carte${f.extraTurns.length > 1 ? 's' : ''} de tour supplémentaire : interdit en bracket 1, toléré en petit nombre et sans enchaînement en 2-3.`);
  if (gc > 3) raise(4, `${gc} Game Changers : plus de 3 impose le bracket 4.`);
  else if (gc > 0) raise(3, `${gc} Game Changer${gc > 1 ? 's' : ''} : aucun n'est permis en bracket 1-2, 3 au maximum en bracket 3.`);
  if (f.twoCardCombos) raise(3, `${f.twoCardCombos} combo${f.twoCardCombos > 1 ? 's' : ''} à deux cartes : interdit en bracket 1-2 ; en bracket 3 seulement si elle ne se met pas en place tôt dans la partie (sinon bracket 4).`);
  if (f.massLandDenial.length) raise(4, `Destruction massive de terrains (${f.massLandDenial.join(', ')}) : interdite en bracket 1-3.`);
  return { min, reasons, unknownCombos: f.twoCardCombos === null };
}

/** Détection locale (hors Commander Spellbook) des tours supplémentaires et de la destruction massive de terrains. */
export function localFlags(cards) {
  const extraTurns = []; const massLandDenial = [];
  for (const c of cards) {
    const t = c.oracleText || '';
    if (/\btakes? (?:an|two|x) extra turns?\b/i.test(t)) extraTurns.push(c.name);
    if (/\bdestroy all (?:nonbasic )?lands\b|\beach player sacrifices (?:all|x|two|three|four|five|half) (?:nonbasic )?lands\b|\blands don't untap\b/i.test(t)) massLandDenial.push(c.name);
  }
  return { extraTurns, massLandDenial };
}
