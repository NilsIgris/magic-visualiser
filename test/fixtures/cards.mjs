// Données de test au format Scryfall (sous-ensemble des champs).
// Textes Oracle reproduits pour tester le moteur ; les noms français et identifiants sont fictifs.
// "{{IMG}}" est remplacé par l'adresse du serveur de test.

let n = 0;
const uid = (p) => `${p}-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function img(id) {
  return { small: `{{IMG}}/small/${id}.svg`, normal: `{{IMG}}/normal/${id}.svg`, large: `{{IMG}}/large/${id}.svg`, art_crop: `{{IMG}}/art/${id}.svg` };
}

function card(o) {
  const id = o.id || uid('c0c0c0c0');
  const oracle_id = o.oracle_id || uid('0a0a0a0a');
  const base = {
    object: 'card', id, oracle_id, lang: 'en', layout: 'normal', mana_cost: '', cmc: 0, colors: [], color_identity: [],
    keywords: [], legalities: { commander: 'legal' }, set: 'tst', set_name: 'Test Set', collector_number: String(n), rarity: 'common',
    scryfall_uri: `https://scryfall.com/card/tst/${n}`,
  };
  const c = { ...base, ...o, id, oracle_id };
  if (!c.card_faces) c.image_uris = img(id);
  return c;
}

export const TOKENS = {
  saproling: card({ name: 'Saproling', type_line: 'Token Creature — Saproling', colors: ['G'], power: '1', toughness: '1', layout: 'token', set: 'ttst' }),
  plant: card({ name: 'Plant', type_line: 'Token Creature — Plant', colors: ['G'], power: '0', toughness: '1', layout: 'token', set: 'ttst' }),
  goblin: card({ name: 'Goblin', type_line: 'Token Creature — Goblin', colors: ['R'], power: '1', toughness: '1', layout: 'token', set: 'ttst' }),
  treasure: card({ name: 'Treasure', type_line: 'Token Artifact — Treasure', oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.', layout: 'token', set: 'ttst' }),
};

const part = (t) => ({ object: 'related_card', id: t.id, component: 'token', name: t.name, type_line: t.type_line });

export const CARDS = [
  card({
    name: 'Ghave, Guru of Spores', mana_cost: '{2}{W}{B}{G}', cmc: 5, type_line: 'Legendary Creature — Fungus Shaman',
    oracle_text: 'Ghave, Guru of Spores enters with five +1/+1 counters on it.\n{1}, Remove a +1/+1 counter from a creature you control: Create a 1/1 green Saproling creature token.\n{1}, Sacrifice a creature: Put a +1/+1 counter on target creature.',
    colors: ['W', 'B', 'G'], color_identity: ['W', 'B', 'G'], power: '0', toughness: '0', rarity: 'mythic',
    all_parts: [part(TOKENS.saproling)],
  }),
  card({ name: 'Blood Artist', mana_cost: '{1}{B}', cmc: 2, type_line: 'Creature — Vampire', oracle_text: 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.', colors: ['B'], color_identity: ['B'], power: '0', toughness: '1' }),
  card({ name: 'Soul Warden', mana_cost: '{W}', cmc: 1, type_line: 'Creature — Human Cleric', oracle_text: 'Whenever another creature enters, you gain 1 life.', colors: ['W'], color_identity: ['W'], power: '1', toughness: '1' }),
  card({ name: "Ajani's Pridemate", mana_cost: '{1}{W}', cmc: 2, type_line: 'Creature — Cat Soldier', oracle_text: "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.", colors: ['W'], color_identity: ['W'], power: '2', toughness: '2' }),
  card({ name: 'Viscera Seer', mana_cost: '{B}', cmc: 1, type_line: 'Creature — Vampire Wizard', oracle_text: 'Sacrifice a creature: Scry 1.', colors: ['B'], color_identity: ['B'], power: '1', toughness: '1' }),
  card({ name: 'Doubling Season', mana_cost: '{4}{G}', cmc: 5, type_line: 'Enchantment', oracle_text: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.\nIf an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.', colors: ['G'], color_identity: ['G'], rarity: 'rare' }),
  card({ name: 'Hardened Scales', mana_cost: '{G}', cmc: 1, type_line: 'Enchantment', oracle_text: 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.', colors: ['G'], color_identity: ['G'] }),
  card({ name: 'Sol Ring', mana_cost: '{1}', cmc: 1, type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.', rarity: 'uncommon' }),
  card({ name: 'Panharmonicon', mana_cost: '{4}', cmc: 4, type_line: 'Artifact', oracle_text: 'If an artifact or creature entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.', rarity: 'rare' }),
  card({ name: 'Ephemerate', mana_cost: '{W}', cmc: 1, type_line: 'Instant', oracle_text: "Exile target creature you control, then return it to the battlefield under its owner's control.\nRebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)", keywords: ['Rebound'], colors: ['W'], color_identity: ['W'] }),
  card({ name: 'Mulldrifter', mana_cost: '{4}{U}', cmc: 5, type_line: 'Creature — Elemental', oracle_text: 'Flying\nWhen Mulldrifter enters, draw two cards.\nEvoke {2}{U} (You may cast this spell for its evoke cost. If you do, it\'s sacrificed when it enters.)', keywords: ['Flying', 'Evoke'], colors: ['U'], color_identity: ['U'], power: '2', toughness: '2' }),
  card({ name: 'Elvish Visionary', mana_cost: '{1}{G}', cmc: 2, type_line: 'Creature — Elf Shaman', oracle_text: 'When this creature enters, draw a card.', colors: ['G'], color_identity: ['G'], power: '1', toughness: '1' }),
  card({ name: 'Elvish Archdruid', mana_cost: '{1}{G}{G}', cmc: 3, type_line: 'Creature — Elf Druid', oracle_text: 'Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.', colors: ['G'], color_identity: ['G'], power: '2', toughness: '2', rarity: 'rare' }),
  card({ name: 'Llanowar Elves', mana_cost: '{G}', cmc: 1, type_line: 'Creature — Elf Druid', oracle_text: '{T}: Add {G}.', colors: ['G'], color_identity: ['G'], power: '1', toughness: '1' }),
  card({
    name: 'Avenger of Zendikar', mana_cost: '{5}{G}{G}', cmc: 7, type_line: 'Creature — Elemental',
    oracle_text: 'Reach\nWhen Avenger of Zendikar enters, create a 0/1 green Plant creature token for each land you control.\nLandfall — Whenever a land you control enters, you may put a +1/+1 counter on each Plant creature you control.',
    keywords: ['Reach', 'Landfall'], colors: ['G'], color_identity: ['G'], power: '5', toughness: '5', rarity: 'mythic', all_parts: [part(TOKENS.plant)],
  }),
  card({ name: 'Cultivate', mana_cost: '{2}{G}', cmc: 3, type_line: 'Sorcery', oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.', colors: ['G'], color_identity: ['G'] }),
  card({ name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)', color_identity: ['G'], produced_mana: ['G'] }),
  card({ name: 'Swamp', type_line: 'Basic Land — Swamp', oracle_text: '({T}: Add {B}.)', color_identity: ['B'], produced_mana: ['B'] }),
  card({ name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '({T}: Add {W}.)', color_identity: ['W'], produced_mana: ['W'] }),
  card({ name: 'Reanimate', mana_cost: '{B}', cmc: 1, type_line: 'Sorcery', oracle_text: 'Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.', colors: ['B'], color_identity: ['B'], rarity: 'rare' }),
  card({ name: 'Pitiless Plunderer', mana_cost: '{3}{B}', cmc: 4, type_line: 'Creature — Human Pirate', oracle_text: 'Whenever another creature you control dies, create a Treasure token.', colors: ['B'], color_identity: ['B'], power: '1', toughness: '4', all_parts: [part(TOKENS.treasure)] }),
  card({ name: 'Mayhem Devil', mana_cost: '{1}{B}{R}', cmc: 3, type_line: 'Creature — Devil', oracle_text: 'Whenever a player sacrifices a permanent, Mayhem Devil deals 1 damage to any target.', colors: ['B', 'R'], color_identity: ['B', 'R'], power: '3', toughness: '3' }),
  card({ name: 'Krenko, Mob Boss', mana_cost: '{2}{R}{R}', cmc: 4, type_line: 'Legendary Creature — Goblin Warrior', oracle_text: '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.', colors: ['R'], color_identity: ['R'], power: '3', toughness: '3', rarity: 'rare', all_parts: [part(TOKENS.goblin)] }),
  card({ name: 'Skullclamp', mana_cost: '{1}', cmc: 1, type_line: 'Artifact — Equipment', oracle_text: 'Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}', keywords: ['Equip'], legalities: { commander: 'legal' } }),
  card({ name: 'Chasm Skulker', mana_cost: '{2}{U}', cmc: 3, type_line: 'Creature — Squid Horror', oracle_text: 'Whenever you draw a card, put a +1/+1 counter on Chasm Skulker.\nWhen Chasm Skulker dies, create X 1/1 blue Squid creature tokens with islandwalk, where X is the number of +1/+1 counters on Chasm Skulker.', colors: ['U'], color_identity: ['U'], power: '1', toughness: '1', rarity: 'rare' }),
  card({ name: 'Dark Ritual', mana_cost: '{B}', cmc: 1, type_line: 'Instant', oracle_text: 'Add {B}{B}{B}.', colors: ['B'], color_identity: ['B'], legalities: { commander: 'legal' } }),
  card({ name: 'Jeweled Lotus', mana_cost: '{0}', cmc: 0, type_line: 'Artifact', oracle_text: '{T}, Sacrifice Jeweled Lotus: Add three mana of any one color. Spend this mana only to cast your commander.', legalities: { commander: 'banned' }, rarity: 'mythic' }),
  card({
    name: 'Turntimber Symbiosis // Turntimber, Serpentine Wood', layout: 'modal_dfc', cmc: 7, mana_cost: '{4}{G}{G}{G} // ', type_line: 'Sorcery // Land',
    colors: ['G'], color_identity: ['G'],
    card_faces: [
      { object: 'card_face', name: 'Turntimber Symbiosis', mana_cost: '{4}{G}{G}{G}', type_line: 'Sorcery', oracle_text: 'Look at the top seven cards of your library. You may put a creature card from among them onto the battlefield. If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it. Put the rest on the bottom of your library in a random order.', colors: ['G'], image_uris: img('mdfc-front') },
      { object: 'card_face', name: 'Turntimber, Serpentine Wood', mana_cost: '', type_line: 'Land', oracle_text: 'As Turntimber, Serpentine Wood enters, you may pay 3 life. If you don\'t, it enters tapped.\n{T}: Add {G}.', colors: [], image_uris: img('mdfc-back') },
    ],
  }),
  card({ name: 'Grave Titan', mana_cost: '{4}{B}{B}', cmc: 6, type_line: 'Creature — Giant', oracle_text: 'Deathtouch\nWhenever Grave Titan enters or attacks, create two 2/2 black Zombie creature tokens.', keywords: ['Deathtouch'], colors: ['B'], color_identity: ['B'], power: '6', toughness: '6', rarity: 'mythic' }),
  card({ name: 'Impact Tremors', mana_cost: '{1}{R}', cmc: 2, type_line: 'Enchantment', oracle_text: 'Whenever a creature you control enters, Impact Tremors deals 1 damage to each opponent.', colors: ['R'], color_identity: ['R'] }),
  card({ name: 'Garruk\'s Packleader', mana_cost: '{4}{G}', cmc: 5, type_line: 'Creature — Beast', oracle_text: 'Whenever another creature you control with power 3 or greater enters, you may draw a card.', colors: ['G'], color_identity: ['G'], power: '4', toughness: '4' }),
  card({ name: 'Young Pyromancer', mana_cost: '{1}{R}', cmc: 2, type_line: 'Creature — Human Shaman', oracle_text: 'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.', colors: ['R'], color_identity: ['R'], power: '2', toughness: '1' }),
  card({ name: 'Cathars\' Crusade', mana_cost: '{3}{W}{W}', cmc: 5, type_line: 'Enchantment', oracle_text: 'Whenever a creature you control enters, put a +1/+1 counter on each creature you control.', colors: ['W'], color_identity: ['W'], rarity: 'rare' }),
  card({ name: 'Purphoros, God of the Forge', mana_cost: '{3}{R}', cmc: 4, type_line: 'Legendary Enchantment Creature — God', oracle_text: 'Indestructible\nAs long as your devotion to red is less than five, Purphoros isn\'t a creature.\nWhenever another creature you control enters, Purphoros deals 2 damage to each opponent.\n{2}{R}: Creatures you control get +1/+0 until end of turn.', keywords: ['Indestructible'], colors: ['R'], color_identity: ['R'], power: '6', toughness: '5', rarity: 'mythic' }),
  card({ name: 'Opposition Agent', mana_cost: '{2}{B}', cmc: 3, type_line: 'Creature — Human Rogue', oracle_text: 'Flash\nYou control your opponents while they\'re searching their libraries.\nWhile an opponent is searching their library, they exile each card they find. You may play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast them.', keywords: ['Flash'], colors: ['B'], color_identity: ['B'], power: '3', toughness: '2' }),
  card({ name: 'Smothering Tithe', mana_cost: '{3}{W}', cmc: 4, type_line: 'Enchantment', oracle_text: 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.', colors: ['W'], color_identity: ['W'], rarity: 'rare', all_parts: [part(TOKENS.treasure)] }),
];

// Impressions françaises fictives pour tester la recherche par nom français.
export const FR_PRINTS = [
  { en: 'Dark Ritual', printed_name: 'Rituel sombre', printed_type_line: 'Éphémère', printed_text: 'Ajoutez {B}{B}{B}.' },
  { en: 'Sol Ring', printed_name: 'Anneau solaire', printed_type_line: 'Artefact', printed_text: '{T} : Ajoutez {C}{C}.' },
  { en: 'Blood Artist', printed_name: 'Artiste sanguinaire', printed_type_line: 'Créature : vampire', printed_text: 'Chaque fois que l\'Artiste sanguinaire ou une autre créature meurt, le joueur ciblé perd 1 point de vie et vous gagnez 1 point de vie.' },
].map((f) => {
  const en = CARDS.find((c) => c.name === f.en);
  const id = uid('f7f7f7f7');
  return { ...en, id, lang: 'fr', printed_name: f.printed_name, printed_type_line: f.printed_type_line, printed_text: f.printed_text, image_uris: img(id) };
});

// Cartes ajoutées pour les règles de la version 1.1 (tuteurs, protection, réducteurs, anti-synergies, rôles).
export const EXTRA = [
  card({ name: 'Worldly Tutor', mana_cost: '{G}', cmc: 1, type_line: 'Instant', oracle_text: 'Search your library for a creature card, reveal it, then shuffle and put that card on top.', colors: ['G'], color_identity: ['G'], game_changer: true }),
  card({ name: 'Demonic Tutor', mana_cost: '{1}{B}', cmc: 2, type_line: 'Sorcery', oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.', colors: ['B'], color_identity: ['B'], game_changer: true }),
  card({ name: 'Swiftfoot Boots', mana_cost: '{2}', cmc: 2, type_line: 'Artifact — Equipment', oracle_text: 'Equipped creature has hexproof and haste.\nEquip {1}', keywords: ['Equip'] }),
  card({ name: 'Heroic Intervention', mana_cost: '{1}{G}', cmc: 2, type_line: 'Instant', oracle_text: 'Permanents you control gain hexproof and indestructible until end of turn.', colors: ['G'], color_identity: ['G'] }),
  card({ name: 'Etherium Sculptor', mana_cost: '{1}{U}', cmc: 2, type_line: 'Artifact Creature — Vedalken Artificer', oracle_text: 'Artifact spells you cast cost {1} less to cast.', colors: ['U'], color_identity: ['U'], power: '1', toughness: '2' }),
  card({ name: 'Rest in Peace', mana_cost: '{1}{W}', cmc: 2, type_line: 'Enchantment', oracle_text: 'When Rest in Peace enters, exile all graveyards.\nIf a card or token would be put into a graveyard from anywhere, exile it instead.', colors: ['W'], color_identity: ['W'] }),
  card({ name: 'Torpor Orb', mana_cost: '{2}', cmc: 2, type_line: 'Artifact', oracle_text: "Creatures entering the battlefield don't cause abilities to trigger." }),
  card({ name: 'Stony Silence', mana_cost: '{1}{W}', cmc: 2, type_line: 'Enchantment', oracle_text: "Activated abilities of artifacts can't be activated.", colors: ['W'], color_identity: ['W'] }),
  card({ name: 'Swords to Plowshares', mana_cost: '{W}', cmc: 1, type_line: 'Instant', oracle_text: 'Exile target creature. Its controller gains life equal to its power.', colors: ['W'], color_identity: ['W'] }),
  card({ name: 'Wrath of God', mana_cost: '{2}{W}{W}', cmc: 4, type_line: 'Sorcery', oracle_text: "Destroy all creatures. They can't be regenerated.", colors: ['W'], color_identity: ['W'] }),
  card({ name: 'Counterspell', mana_cost: '{U}{U}', cmc: 2, type_line: 'Instant', oracle_text: 'Counter target spell.', colors: ['U'], color_identity: ['U'] }),
  card({ name: 'Rhystic Study', mana_cost: '{2}{U}', cmc: 3, type_line: 'Enchantment', oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.', colors: ['U'], color_identity: ['U'], game_changer: true }),
  card({ name: 'Arcane Signet', mana_cost: '{2}', cmc: 2, type_line: 'Artifact', oracle_text: "{T}: Add one mana of any color in your commander's color identity." }),
  card({ name: 'Eternal Witness', mana_cost: '{1}{G}{G}', cmc: 3, type_line: 'Creature — Human Shaman', oracle_text: 'When Eternal Witness enters, return target card from your graveyard to your hand.', colors: ['G'], color_identity: ['G'], power: '2', toughness: '1' }),
  card({ name: 'Command Tower', type_line: 'Land', oracle_text: "{T}: Add one mana of any color in your commander's color identity.", produced_mana: ['W', 'U', 'B', 'R', 'G'] }),
  card({ name: 'Evolving Wilds', type_line: 'Land', oracle_text: '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.' }),
];
CARDS.push(...EXTRA);
