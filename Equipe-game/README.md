# Composez votre équipe — jeu de tirage d'images

Jeu en réseau local : une page « maître du jeu » pilote la partie, chaque joueur a sa propre page sur son téléphone/ordinateur.

## Installation

Il faut [Node.js](https://nodejs.org/) installé (version 18 ou plus récente conseillée).

Dans le dossier du projet, ouvrez un terminal et lancez :

```
npm install
npm start
```

Le serveur démarre sur **http://localhost:3500**.

- Le maître du jeu ouvre **http://localhost:3500/** sur son ordinateur/tablette.
- Chaque joueur ouvre **http://localhost:3500/joueur1**, **/joueur2**, **/joueur3**, etc. (dans l'ordre où les noms sont saisis) depuis son propre appareil connecté au même réseau Wi-Fi. Remplacez `localhost` par l'adresse IP locale de l'ordinateur qui héberge le serveur (ex. `http://192.168.1.20:3500/joueur1`) pour que les autres appareils du réseau puissent y accéder.

## Utilisation

1. Sur la page maître : choisissez un mode (A, B, C ou D), indiquez le nombre de joueurs et leurs noms (ils sont mémorisés d'une partie à l'autre), le thème de la partie, le nombre de tirages par joueur (3 à 10 — pour le mode D, il s'agit du **nombre d'images maximum par équipe**), le nombre de tours à jouer et le nombre de dons possible (champs supplémentaires visibles uniquement en mode D — voir ci-dessous), puis chargez une archive **.zip** contenant les photos (jpg, png, gif, webp, bmp).
2. Cliquez sur **Lancer la partie**. Les liens des pages joueurs s'affichent.
3. Suivez le déroulé du mode choisi (voir ci-dessous) depuis la page maître ; les pages joueurs se synchronisent automatiquement en temps réel.
4. Une fois tous les tirages effectués, la phase d'élimination permet d'observer les équipes de chacun et d'éliminer les joueurs (avec confirmation) jusqu'à ce qu'il n'en reste plus qu'un : le vainqueur, dont l'équipe s'affiche au premier plan.
5. Le bouton **Réinitialiser** (page maître) permet de revenir à l'écran de configuration en conservant les noms des joueurs déjà saisis.

### Mode A — Équipe au hasard
Chaque joueur tire, l'un après l'autre, son nombre de tirages consécutifs : une image aléatoire est piochée dans le lot (avec un défilement rapide de 3 secondes façon machine à sous), s'affiche en grand puis rejoint sa colonne. Chaque image tirée est retirée du lot commun.

### Mode B — Équipe de choix
Chaque joueur, à son tour, se voit proposer 5 images (après le même défilement rapide) et choisit celle qu'il veut ajouter à son équipe (avec confirmation). Les images non choisies retournent dans le lot commun.

### Mode C — Duel d'équipe
Tous les joueurs tirent en même temps : un clic sur « Tirage » fait apparaître une image dans chaque colonne simultanément, à répéter jusqu'au nombre de tirages voulu.

### Mode D — Défi
Chaque joueur joue simultanément mais sur son propre écran (page joueur). Le nombre de **tours** (manches) se règle indépendamment du nombre de tirages : celui-ci devient dans ce mode le **nombre maximum d'images par équipe**. À chaque manche, une image est tirée pour chaque joueur (défilement rapide sur son écran). Le joueur décide alors de la **garder** ou de la **donner** à un autre joueur de son choix — le **nombre de dons possible par joueur** sur toute la partie se règle au démarrage (1 à 5, par défaut 2). L'image n'apparaît dans la colonne (visible sur la page maître et toutes les pages joueurs) qu'une fois que **tous les joueurs ont validé** leur décision pour la manche. Si un joueur reçoit trop de dons et dépasse le nombre d'images maximum par équipe, il doit choisir sur son propre écran les images à supprimer avant de pouvoir passer à la manche suivante.

## Structure du projet

```
equipe-game/
  server.js           serveur Node.js (Express + Socket.io)
  package.json
  data/
    players.json      liste des noms de joueurs (persistée)
    uploads/current/   photos extraites de la dernière archive zip chargée
  public/
    master.html/.js/.css   page maître du jeu
    joueur.html/.js         pages joueurs (/joueur1, /joueur2, ...)
    common.css              fond dégradé + styles communs
```

## Notes

- Une seule partie est active à la fois sur le serveur (adapté à un usage en soirée/événement sur un même réseau local).
- Les photos de l'archive zip précédente sont remplacées à chaque nouveau chargement.
- Le nom affiché sous chaque miniature est le nom du fichier image sans son extension.
- **Redimensionnement et cadrage automatiques des photos** : à chaque chargement d'archive zip, chaque image est automatiquement mise à un format constant 3:4 (500×667px, orientation EXIF corrigée) côté serveur avant d'être servie aux joueurs — l'espace vide éventuel (pour les images qui n'ont pas ce ratio d'origine) est comblé par un fond neutre, ce qui garantit que toutes les images apparaissent à la même taille visuelle, quel que soit leur format d'origine (portrait, carré, paysage...). Les images **avec transparence** (PNG avec canal alpha) sont ré-encodées en PNG (complétées par du transparent) pour la conserver ; les autres sont ré-encodées en JPEG qualité 85 (complétées par un gris neutre) pour rester légères. Cela allège fortement le poids des fichiers et fluidifie le défilement rapide des tirages — inutile de redimensionner ou recadrer vos photos à la main avant de les zipper.
