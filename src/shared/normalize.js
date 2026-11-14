// Conversion d'objets carte Scryfall vers le format interne (stocké dans les decks).

function imgSet(u) {
  if (!u) return null;
  return { small: u.small || null, normal: u.normal || u.large || null, large: u.large || u.normal || null, artCrop: u.art_crop || null };
}

/** Images par face (une seule entrée pour les cartes à image unique). */
export function imagesOf(raw) {
  if (!raw) return null;
  if (raw.image_uris) return [imgSet(raw.image_uris)];
  if (Array.isArray(raw.card_faces) && raw.card_faces.some((f) => f.image_uris)) {
    return raw.card_faces.map((f) => imgSet(f.image_uris)).filter(Boolean);
  }
  return null;
}

function joinFaces(faces, key, sep) {
  const v = faces.map((f) => f[key]).filter((x) => x !== undefined && x !== null && x !== '');
  return v.length ? v.join(sep) : null;
}

export function normalizeToken(raw) {
  return {
    id: raw.id,
    oracleId: raw.oracle_id || null,
    name: raw.name,
    typeLine: raw.type_line || '',
    colors: raw.colors || [],
    power: raw.power ?? null,
    toughness: raw.toughness ?? null,
    keywords: raw.keywords || [],
    oracleText: raw.oracle_text || joinFaces(raw.card_faces || [], 'oracle_text', '\n') || '',
  };
}

/**
 * @param {object} en  objet carte Scryfall (impression anglaise de préférence)
 * @param {object|null} fr impression française éventuelle (même oracle_id)
 * @param {Array} tokens jetons normalisés
 */
export function normalizeCard(en, fr = null, tokens = []) {
  const rawFaces = Array.isArray(en.card_faces) && en.card_faces.length ? en.card_faces : [en];
  const frFaces = fr && Array.isArray(fr.card_faces) && fr.card_faces.length ? fr.card_faces : fr ? [fr] : [];
  const faces = rawFaces.map((f, i) => ({
    name: f.name,
    printedName: frFaces[i] ? frFaces[i].printed_name || null : null,
    manaCost: f.mana_cost || '',
    typeLine: f.type_line || en.type_line || '',
    printedTypeLine: frFaces[i] ? frFaces[i].printed_type_line || null : null,
    oracleText: f.oracle_text || '',
    printedText: frFaces[i] ? frFaces[i].printed_text || null : null,
    power: f.power ?? null,
    toughness: f.toughness ?? null,
    loyalty: f.loyalty ?? null,
    colors: f.colors || en.colors || [],
  }));
  const colors = en.colors || [...new Set(rawFaces.flatMap((f) => f.colors || []))];
  const oracleId = en.oracle_id || (rawFaces[0] && rawFaces[0].oracle_id) || en.id;
  return {
    oracleId,
    id: en.id,
    name: en.name,
    printedName: fr ? fr.printed_name || joinFaces(frFaces, 'printed_name', ' // ') : null,
    layout: en.layout || 'normal',
    manaCost: en.mana_cost ?? joinFaces(rawFaces, 'mana_cost', ' // ') ?? '',
    cmc: Number(en.cmc ?? 0),
    typeLine: en.type_line || joinFaces(rawFaces, 'type_line', ' // ') || '',
    oracleText: en.oracle_text ?? joinFaces(rawFaces, 'oracle_text', '\n\n') ?? '',
    colors,
    colorIdentity: en.color_identity || [],
    keywords: en.keywords || [],
    power: en.power ?? (rawFaces[0] && rawFaces[0].power) ?? null,
    toughness: en.toughness ?? (rawFaces[0] && rawFaces[0].toughness) ?? null,
    producedMana: en.produced_mana || [],
    legalCommander: en.legalities ? en.legalities.commander || 'unknown' : 'unknown',
    gameChanger: !!en.game_changer,
    rarity: en.rarity || '',
    set: en.set || '',
    setName: en.set_name || '',
    collectorNumber: en.collector_number || '',
    scryfallUri: en.scryfall_uri || '',
    printsUri: en.prints_search_uri || null,
    faces,
    tokens,
    tokenRefs: (en.all_parts || [])
      .filter((p) => p.component === 'token' && p.id !== en.id && !/^emblem/i.test(p.type_line || ''))
      .map((p) => p.id),
    images: { en: imagesOf(en), fr: fr ? imagesOf(fr) : null },
    fetchedAt: new Date().toISOString(),
  };
}

/** Nom affiché selon la préférence. */
export function displayName(card, lang) {
  if (!card) return '';
  if (lang === 'fr' && card.chosenPrint && card.chosenPrint.lang === 'fr' && card.chosenPrint.printedName) return card.chosenPrint.printedName;
  if (lang === 'fr' && card.printedName) return card.printedName;
  return card.name;
}

/** Images préférées (avec repli sur l'anglais). */
export function preferredImages(card, lang) {
  if (card && card.chosenPrint && card.chosenPrint.images && card.chosenPrint.images.length) return card.chosenPrint.images;
  if (!card || !card.images) return null;
  if (lang === 'fr' && card.images.fr && card.images.fr.length) return card.images.fr;
  return card.images.en;
}
