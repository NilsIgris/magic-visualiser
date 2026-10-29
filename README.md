# MTG Deck Lab

Application de bureau (Windows et Linux) pour préparer des decks Magic: The Gathering, au format Commander en priorité :
importer une liste, la voir en piles de cartes, et cartographier les interactions entre les cartes.

## Installation

### Windows
1. Décompresse `MTG-Deck-Lab-1.0.0-windows-x64.zip` où tu veux (par exemple `Documents\MTG Deck Lab`).
2. Lance `MTG Deck Lab.exe`.

L'application n'est pas signée numériquement : au premier lancement, Windows SmartScreen peut afficher
« Windows a protégé votre ordinateur ». Clique sur **Informations complémentaires**, puis **Exécuter quand même**.

### Linux
```bash
tar -xzf MTG-Deck-Lab-1.0.0-linux-x64.tar.gz
cd "MTG Deck Lab-linux-x64"
sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox   # bac à sable Chromium
./mtg-deck-lab
```
La ligne `chown/chmod` est nécessaire sur les distributions qui restreignent les espaces de noms utilisateur
(Ubuntu 24.04 et suivantes notamment). Sans elle, l'application refuse de démarrer avec une erreur « SUID sandbox ».
Le contournement `./mtg-deck-lab --no-sandbox` fonctionne aussi mais désactive une protection : préfère la première méthode.

## Utilisation

1. **Nouveau deck** : donne-lui un nom.
2. **Importer des cartes** (ou Ctrl+V sur le board, ou glisser un fichier `.txt` / `.csv` sur la fenêtre).
   Formats reconnus :
   - liste simple : `1 Sol Ring`, `4x Lightning Bolt` ; noms en anglais **ou en français** ;
   - export Arena / MTGO / Moxfield : sections `Commander`, `Deck`, `Sideboard`, édition et numéro `(C21) 263` ;
   - CSV avec en-têtes (`Quantity`, `Name`, `Set code`, `Collector number`, `Board`…), séparateur `,` `;` ou tabulation.
   Un bloc final de 1 ou 2 cartes séparé par une ligne vide est pris comme commandant. L'aperçu permet de corriger la zone de chaque ligne avant l'import.
3. **Board** : les cartes sont posées en piles par type, coût, couleur ou par **tes propres piles** (Rampe, Pioche…).
   Glisser-déposer pour changer de pile ou de zone ; clic droit pour le menu de la carte.
4. **Interactions** : l'application propose des liens à partir du texte Oracle (voir plus bas). Valide ou rejette chaque
   suggestion, en masse ou une par une. Tu peux créer tes propres liens (combo, protection, tuteur, anti-synergie…).
5. **Graphe** : vue d'ensemble des interactions. Clic sur une carte = ses voisines sont mises en évidence ;
   « Relier deux cartes » ou Maj+clic pour créer un lien ; les positions que tu donnes aux cartes sont mémorisées.

Raccourcis : `1` `2` `3` changent de vue, `Ctrl+I` importer, `Ctrl+F` ou `/` filtrer, `Ctrl+Z` / `Ctrl+Y` annuler / rétablir,
`Ctrl+L` lier la carte sélectionnée, `Suppr` retirer la carte sélectionnée, `Échap` désélectionner.

## Ce que fait (et ne fait pas) l'analyse automatique

Les suggestions viennent de règles appliquées au texte Oracle anglais de chaque carte. Elles couvrent :
arrivées sur le champ de bataille (y compris jetons créés, réanimation, terrains et rampe pour Landfall), morts et
sacrifices, attaques, sorts lancés (avec leur type), gain de vie, perte de vie adverse, pioche, défausse, cimetière,
marqueurs +1/+1, doubleurs (jetons, marqueurs, déclencheurs d'arrivée), clignotement, commandant, types de créatures (tribal).

Principe : **précision avant exhaustivité**. Quand une condition n'est pas comprise avec certitude (« équipée »,
« ciblée », conditions inhabituelles), aucun lien n'est proposé plutôt qu'un lien faux. Des interactions réelles
peuvent donc manquer : ajoute-les à la main. Inversement, une suggestion peut être techniquement juste mais
sans intérêt stratégique : rejette-la, elle ne reviendra pas.

Les liens que tu as validés ou rejetés sont conservés même si tu modifies le deck. Un lien « plus suggéré »
signale qu'une ancienne suggestion traitée ne correspond plus à l'analyse actuelle.

## Données

- Decks : un fichier JSON par deck dans le dossier de l'application (Réglages → Dossier des decks), écrit de façon
  atomique avec une copie de secours `.bak`. Enregistrement automatique ; Ctrl+S force l'écriture.
- Cartes et images : récupérées sur [Scryfall](https://scryfall.com) puis gardées en cache local (utilisable hors ligne
  pour les cartes déjà vues). Réglages → « Lancer le test » vérifie la connexion et la recherche par nom français.
- Suppression d'un deck : envoyé dans la corbeille du système.

Magic: The Gathering, ses noms de cartes et illustrations appartiennent à Wizards of the Coast. Application non
officielle, ni produite ni approuvée par Wizards of the Coast. Données de cartes : Scryfall.

## Développement

```bash
npm install
node tools/vendor.mjs     # copie Cytoscape et les polices dans src/renderer
npm start                 # lance l'application
npm test                  # tests unitaires (parseur, analyse, exports, résolution Scryfall simulée)
npm run test:e2e          # scénario complet de l'interface (Linux : xvfb-run -a npm run test:e2e)
node tools/package.mjs    # construit les versions Windows et Linux dans dist/
```
