# MTG Deck Lab

Application de bureau (Windows et Linux) pour préparer des decks Magic: The Gathering, au format Commander en priorité :
importer une liste, la voir en piles de cartes, cartographier les interactions entre les cartes et analyser le deck.

## Installation

### Windows
- **Installateur (recommandé)** : lance `MTG-Deck-Lab-Setup-1.1.0.exe`. Il installe l'application pour ton compte,
  crée les raccourcis, et c'est cette version qui peut se mettre à jour toute seule.
- **Version portable** : décompresse `MTG-Deck-Lab-1.1.0-windows-portable.zip` et lance `MTG Deck Lab.exe`.

L'application n'est pas signée numériquement (un certificat de signature est payant) : au premier lancement,
Windows SmartScreen peut afficher « Windows a protégé votre ordinateur ». Clique sur **Informations complémentaires**,
puis **Exécuter quand même**.

### Linux
- **AppImage (recommandé, se met à jour seule)** :
  ```bash
  chmod +x MTG-Deck-Lab-1.1.0-x86_64.AppImage
  ./MTG-Deck-Lab-1.1.0-x86_64.AppImage
  ```
- **Archive** : `tar -xzf MTG-Deck-Lab-1.1.0-linux-x64.tar.gz`, puis dans le dossier :
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
9. **Ma collection** (accueil ou menu « … ») : importe ta collection (liste ou CSV ; la colonne `Scryfall ID` d'un export
   ManaBox est reconnue). Les cartes absentes sont signalées sur le board et listées dans « Cartes manquantes ».

Raccourcis : `1` à `4` changent de vue, `Ctrl+K` ajouter une carte, `Ctrl+I` importer, `Ctrl+F` ou `/` filtrer,
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

Elles passent par les « Releases » d'un dépôt GitHub. Mise en place (une seule fois) :
1. Crée un dépôt GitHub (public, pour que l'application puisse lire les versions sans identifiant).
2. Renseigne `owner` et `repo` dans `release.config.json`.
3. Crée un jeton GitHub (« fine-grained », droit *Contents: Read and write* sur ce dépôt).
4. Publie : `GH_TOKEN=ton_jeton npm run release` (sous Windows PowerShell : `$env:GH_TOKEN="ton_jeton"; npm run release`).
   Sous Windows, seuls les fichiers Windows sont construits ; sous Linux, les fichiers Linux et Windows (wine requis).
5. Pour chaque nouvelle version : augmente `version` dans `package.json`, puis relance l'étape 4. La release est publiée
   directement (avec le fichier `latest.yml` que lit l'application).

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

## Développement

```bash
npm install
node tools/vendor.mjs     # copie Cytoscape et les polices dans src/renderer
npm start                 # lance l'application
npm test                  # tests unitaires
npm run test:e2e          # scénario complet de l'interface (Linux : xvfb-run -a npm run test:e2e)
npm run build             # livrables dans dist/ (sous Linux, l'installateur Windows nécessite wine)
```

## Upload le .exe bien lourd
Utiliser [git lfs](https://github.com/git-lfs/git-lfs?utm_source=gitlfs_site&utm_medium=installation_link&utm_campaign=gitlfs#installing)
```bash
git lfs track "*.exe"
```

Si jamais ça plante toujours, lancer

```bash
git lfs migrate import --include="*.exe"
```