# MTG Deck Lab

Application de bureau (Windows et Linux) pour préparer des decks Magic: The Gathering, au format Commander en priorité :
importer une liste, la voir en piles de cartes, cartographier les interactions entre les cartes, analyser le deck et
suivre l'inventaire des cartes que tu possèdes.

[![Tests](https://github.com/NilsIgris/magic-visualiser/actions/workflows/ci.yml/badge.svg)](https://github.com/NilsIgris/magic-visualiser/actions/workflows/ci.yml)

## Installation

Télécharge la dernière version sur la page
[Releases](https://github.com/NilsIgris/magic-visualiser/releases/latest) du dépôt.

### Windows
- **Installateur (recommandé)** : lance `MTG-Deck-Lab-Setup-1.2.0.exe`. Il installe l'application pour ton compte,
  crée les raccourcis, et c'est cette version qui peut se mettre à jour toute seule.
- **Version portable** : décompresse `MTG-Deck-Lab-1.2.0-windows-portable.zip` et lance `MTG Deck Lab.exe`.

L'application n'est pas signée numériquement (un certificat de signature est payant) : au premier lancement,
Windows SmartScreen peut afficher « Windows a protégé votre ordinateur ». Clique sur **Informations complémentaires**,
puis **Exécuter quand même**.

### Linux
- **AppImage (recommandé, se met à jour seule)** :
  ```bash
  chmod +x MTG-Deck-Lab-1.2.0-x86_64.AppImage
  ./MTG-Deck-Lab-1.2.0-x86_64.AppImage
  ```
- **Archive** : `tar -xzf MTG-Deck-Lab-1.2.0-linux-x64.tar.gz`, puis dans le dossier :
  `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox`, puis `./mtg-deck-lab`.

Sur les distributions qui restreignent les espaces de noms utilisateur (Ubuntu 24.04 et suivantes), Electron peut refuser
de démarrer avec une erreur de « sandbox ». Pour l'archive, la commande `chown/chmod` ci-dessus règle le problème. Pour
l'AppImage, lance-la avec `--no-sandbox` (cela désactive une protection de Chromium) ou autorise-la par un profil AppArmor.

## Utilisation

1. **Nouveau deck**, puis **Importer des cartes** (ou Ctrl+V sur le board, ou glisser un fichier `.txt` / `.csv`).
   Formats : liste simple (`1 Sol Ring`, `4x Lightning Bolt`), export Arena / MTGO / Moxfield (sections `Commander`, `Deck`,
   `Sideboard`, édition `(C21) 263`), CSV avec en-têtes (`Quantity`, `Name`, `Set code`, `Collector number`, `Board`,
   `Scryfall ID`…). Noms en anglais **ou en français**.
2. **Ajouter une carte** sans repasser par l'import : champ en haut du board (Ctrl+K), avec autocomplétion.
3. **Board** : piles par type, coût, couleur, **rôle** (rampe, pioche, interaction…) ou **tes propres piles**.
   Glisser-déposer pour changer de pile ou de zone ; clic droit pour le menu de la carte. Badge **GC** = Game Changer.
4. **Panneau d'une carte** : texte Oracle et VF, **choix de l'impression** (édition, illustration, VF/VO), rôle dans le deck
   (corrigeable à la main), interactions, note.
5. **Interactions** : suggestions calculées à partir du texte Oracle. Chaque suggestion a une **pertinence**
   (barres vertes, orange ou grises). Les liens répétitifs (ex. « 21 cartes qui arrivent en jeu → Cathars' Crusade ») sont
   **regroupés** en une seule ligne, validable d'un coup ; les suggestions faibles isolées sont masquées par défaut.
6. **Graphe** : vue d'ensemble, avec les groupes représentés par un seul nœud. Clic sur une carte = voisines mises en évidence.
7. **Analyse** :
   - **Rôles et repères** : nombre de terrains, rampe, avantage de cartes, interaction ciblée et balais, comparé au modèle de
     construction de l'émission *The Command Zone* (épisode 658 : 38 terrains, 10 rampe, 12 avantage de cartes,
     12 interaction ciblée, 6 balais). Ce sont des repères, pas des règles.
   - **Base de mana** : symboles demandés et sources par couleur, probabilité d'avoir une source aux tours 1 à 4,
     répartition des terrains en main de départ. Calcul exact (loi hypergéométrique).
   - **Probabilité de piocher** une carte, un rôle ou une pile d'ici un tour donné.
   - **Main de départ** simulée, avec pioche et mulligans (règle de Londres, premier mulligan gratuit en multijoueur).
   - **Combos connues et bracket** via [Commander Spellbook](https://commanderspellbook.com) : combos complètes dans le deck,
     combos à une carte près, ajout en liens « Combo », et **bracket minimal** estimé d'après les règles de Wizards of the
     Coast (Game Changers, combos à deux cartes, destruction massive de terrains, tours supplémentaires). La liste des noms
     de cartes n'est envoyée à Commander Spellbook que lorsque tu lances l'analyse.
8. **Versions** (menu « … ») : enregistre l'état du deck, compare deux versions ou deux decks, restaure une version.
   Une version automatique est créée avant chaque remplacement de contenu ou restauration.
9. **Inventaire** (onglet de l'accueil, à côté de « Mes decks ») : importe les cartes que tu possèdes (liste simple, export
   Arena/MTGO, CSV ; la colonne `Scryfall ID` d'un export ManaBox est reconnue), en ajout ou en remplacement.
   - **Mes cartes** : recherche, filtres (couleur, type, rareté, utilisation), tri (nom, couleur, type, coût, rareté,
     quantité, exemplaires disponibles, nombre de decks, ajout récent), vue liste ou images, quantité modifiable.
     Chaque carte indique **dans quels decks elle est utilisée** (clic = ouvrir le deck sur la carte) et s'il en manque
     pour monter tous ces decks. Bouton **Deck** : ajouter la carte à un deck, avec un avertissement si elle sort de
     l'identité couleur ou si ses exemplaires sont déjà pris ailleurs.
   - **À acquérir** : la liste des cartes à acheter pour monter tous tes decks en même temps, ou un seul deck ; copiable.
   - Export CSV de l'inventaire.
10. **Collection** (onglet d'un deck, touche `5`) : la situation de chaque carte du deck par rapport à ton inventaire.
    - **Rangée dans un autre deck** : tu la possèdes, mais tes exemplaires sont dans un deck **monté** ; il faut l'y reprendre.
    - **Partagée** : tu en as assez pour ce deck, mais si tu la gardes ici, tel autre deck (non monté) en manquera.
    - **Manquante** : tu n'en as pas assez, même en défaisant tes autres decks (liste d'achat copiable).
    - **Possédée et libre** : rien à faire.
    - **Suggestions** : cartes de ton inventaire absentes du deck, dans son identité couleur, classées par nombre
      d'interactions avec le deck (même moteur que l'onglet Interactions).

    Un deck **monté** (interrupteur dans l'onglet Collection, ou menu de la tuile) est un deck dont les cartes sont
    physiquement rangées dedans : ses exemplaires lui sont réservés en priorité. Seules les zones Commandant et Deck
    comptent ; la réserve et « Peut-être » ne réservent rien. Les terrains de base sont considérés comme possédés sans
    limite (case à cocher dans l'inventaire). Les exemplaires sont comptés **par carte**, toutes impressions confondues.

Raccourcis : `1` à `5` changent de vue, `Ctrl+K` ajouter une carte, `Ctrl+I` importer, `Ctrl+F` ou `/` filtrer,
`Ctrl+Z` / `Ctrl+Y` annuler / rétablir, `Ctrl+L` lier la carte sélectionnée, `Suppr` retirer la carte sélectionnée,
`Échap` désélectionner.

## Ce que fait (et ne fait pas) l'analyse automatique

Les suggestions viennent de règles appliquées au texte Oracle anglais : arrivées en jeu (jetons, réanimation, terrains),
morts et sacrifices, attaques, sorts lancés, gain de vie, perte de vie adverse, pioche, défausse, cimetière, marqueurs +1/+1,
doubleurs, clignotement, commandant, types de créatures, **tuteurs**, **réducteurs de coût**, **protection et équipement du
commandant**, et **anti-synergies** (effets symétriques comme Rest in Peace ou Torpor Orb qui gênent aussi tes cartes).

Principe : **précision avant exhaustivité**. Quand une condition n'est pas comprise avec certitude, aucun lien n'est proposé.
Des interactions réelles peuvent manquer : ajoute-les à la main. Le classement par rôle peut se tromper : corrige-le dans le
panneau de la carte. Les liens validés ou rejetés sont conservés quand tu modifies le deck.

## Mises à jour automatiques

L'application interroge les [Releases](https://github.com/NilsIgris/magic-visualiser/releases) du dépôt
`NilsIgris/magic-visualiser` (réglé dans `release.config.json`). **Le dépôt doit être public** : l'application lit les
versions sans identifiant, et un dépôt privé répond « introuvable ».

Comportement : l'installateur Windows et l'AppImage téléchargent et installent la nouvelle version à la demande
(Réglages → Mises à jour, ou notification au démarrage). Les versions portables signalent seulement qu'une version existe.
Une version construite sans dépôt configuré n'affiche pas de mise à jour.

## Données

- Decks : un fichier JSON par deck dans le dossier de l'application (Réglages → Dossier des decks), écrit de façon atomique
  avec une copie de secours `.bak` ; versions dans `decks/<id>.versions/` ; collection dans `collection.json`.
- Cartes et images : [Scryfall](https://scryfall.com), gardées en cache local (utilisable hors ligne pour les cartes déjà vues).
- Combos : [Commander Spellbook](https://commanderspellbook.com), seulement à la demande.

Magic: The Gathering, ses noms de cartes et illustrations appartiennent à Wizards of the Coast. Application non officielle,
ni produite ni approuvée par Wizards of the Coast. Données de cartes : Scryfall. Données de combos : Commander Spellbook.

## Licence

Code sous licence MIT (fichier `LICENSE`). Les bibliothèques embarquées gardent leur licence
(`src/renderer/vendor/LICENSES.txt`).
