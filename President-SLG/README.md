# President-SLG

Jeu de cartes multijoueur local (Node.js + Socket.io). La page d'accueil permet
de créer ou rejoindre un **salon** : chaque groupe joue une partie totalement
indépendante, avec son propre thème, ses propres règles et ses propres
joueurs. Une page « maître » configure et pilote la partie de son salon,
chaque joueur ouvre sa propre page sur son écran/téléphone.

## Installation

```bash
npm install
node server.js
```

Puis ouvrez `http://localhost:4000` — c'est la page d'accueil, depuis laquelle
on crée ou rejoint un salon (sur le même réseau local, remplacez `localhost`
par l'adresse IP de la machine qui héberge le serveur si les autres appareils
en ont besoin).

## Salons

- **Créer un salon** : un code est généré automatiquement (ou choisissez le
  vôtre, 3 à 10 lettres/chiffres, pratique pour retrouver le même salon d'une
  fois sur l'autre). Vous devenez le maître du jeu à l'adresse `/CODE`.
- **Rejoindre un salon** : entrez le code donné par le maître. Si la partie
  est déjà configurée, touchez votre nom dans la liste pour aller sur votre
  page (`/CODE/joueurN`) ; sinon la page attend et se met à jour
  automatiquement.
- Sur la page maître, le code du salon est affiché en grand avec un **QR
  code** à scanner (il pointe vers la page pour rejoindre ce salon) et un
  bouton pour copier le lien.
- Chaque salon a sa propre partie, ses propres joueurs mémorisés et ses
  propres images importées (mode B) : deux groupes peuvent jouer en même
  temps sans interférence. Un salon sans aucune page ouverte depuis 6h est
  automatiquement supprimé (ses images importées aussi, pour libérer l'espace
  disque).

## Mise en place d'une partie (page maître d'un salon)

1. Choisissez le mode : **A – Cartes standardes** (52 cartes classiques, 4 à 6
   joueurs) ou **B – Carte au choix** (vos photos, 2 à 6 joueurs).
2. Renseignez le nombre de joueurs (2 à 6) et leurs noms — ils sont mémorisés
   d'une partie à l'autre, pour ce salon.
3. Décrivez un thème libre (affiché en haut des pages, ex. « Équipage de
   pirate »).
4. Réglez le nombre de tours (3 à 20), le nombre de points pour gagner
   (50 à 100, par palier de 10) et le nombre de cartes distribuées par joueur
   ("Toutes" pour répartir équitablement tout le paquet/toutes les images, ou
   un nombre fixe entre 6 et 20 — le serveur refuse le lancement si ce nombre
   dépasse ce qui est réellement distribuable compte tenu du nombre de joueurs
   et, en mode B, du nombre d'images importées).
5. Cochez la case "IA" à côté d'un joueur pour que le serveur joue
   automatiquement à sa place (carte la plus faible jouable, passe si
   impossible, relance ou continue selon la situation).
6. En mode B, importez une archive `.zip` contenant au minimum 42 images.
   Chaque fichier doit être nommé `Nom (niveau).extension`, le niveau étant
   écrit sur **deux chiffres, de 01 (le plus faible) à 20 (le plus fort)** —
   le zéro devant est obligatoire pour les niveaux 01 à 09, par exemple
   `Capitaine (08).jpg`. Le niveau n'est **jamais montré aux joueurs**, seul
   le maître le voit une fois la carte posée sur la table.
7. Cliquez sur « Lancer la partie », puis partagez le code/QR du salon ou les
   liens joueurs affichés sur la page maître.

## Adversaires IA

Sur la page de configuration, une case « IA » apparaît à côté de chaque nom de
joueur : cochez-la pour que le serveur joue automatiquement à la place de ce
joueur. Une fois la partie lancée, un panneau « Adversaires IA » sur la page
maître permet de cocher ou décocher n'importe quel joueur à tout moment, y
compris en pleine partie — utile pour reprendre la main sur un joueur, ou au
contraire laisser l'IA terminer à la place de quelqu'un qui doit s'absenter.
Sur sa propre page, un joueur actuellement piloté par l'IA voit un bandeau
« 🤖 Ce joueur est actuellement contrôlé par l'IA » et ses cartes sont
désactivées.

## Déroulé d'un tour

- Le maître clique sur « Lancer le tour » : les cartes/images sont redistribuées
  équitablement et au hasard, un premier joueur est tiré au sort.
- Chacun son tour, un joueur doit poser une carte strictement plus forte que
  la dernière posée, ou passer.
- Quand tous les autres joueurs ont passé (ou terminé leur main), le joueur
  qui a posé la carte la plus forte peut soit poser une carte encore plus
  forte, soit cliquer sur « Fin du tour » pour vider la table et relancer un
  nouvel échange (il garde la main).
- Le tour se termine quand tous les joueurs ont posé toutes leurs cartes.
  Points attribués selon l'ordre d'arrivée : 10 / 7 / 5 / 3 / 1 / 1.
- La partie s'arrête dès que le nombre de tours prévu est atteint, ou qu'un
  joueur atteint le nombre de points fixé.

## Notes d'implémentation à affiner ensemble

Le mode A ("Cartes standardes") utilise désormais les valeurs 2 à 14 (As),
avec un vrai visuel de carte (une image par carte, style français classique)
plutôt qu'un simple texte — voir la section "Origine des visuels" ci-dessous.
La couleur (Pique/Coeur/Trèfle/Carreau) n'a aucune incidence sur le jeu, seule
la valeur compte. Le nombre de cartes distribuées par joueur est verrouillé
sur "Toutes" en mode A (52 cartes réparties équitablement) : ce réglage n'est
personnalisable qu'en mode B.

Le mode B utilise des niveaux de 01 à 20 (deux chiffres, zéro devant
obligatoire pour 01 à 09) dans le nom des fichiers image.

## Origine des visuels de cartes (mode A)

Les 52 cartes affichées en mode A (`public/assets/cards/*.svg`) proviennent du
projet libre [SVG-cards](https://github.com/htdebeer/SVG-cards) (licence
LGPL-2.1, voir `public/assets/cards/LICENSE.txt` et `ATTRIBUTION.md`). Chaque
fichier a été extrait individuellement du fichier source `svg-cards.svg`,
sans autre retouche graphique. Si vous préférez un autre style de cartes,
remplacez simplement les fichiers de ce dossier en conservant les mêmes noms
(`club_2.svg`, `heart_king.svg`, `diamond_1.svg` pour l'As, etc.).

## Structure du projet

```
server.js            serveur Express + Socket.io, registre des salons, routes API
gameEngine.js         logique de jeu (distribution, tours, scores, IA)
public/
  accueil.html/js     page d'accueil : créer ou rejoindre un salon
  master.html/js       page maître d'un salon (configuration + pilotage)
  joueur.html/js        page d'un joueur d'un salon
  styles.css           styles partagés (dégradé, cartes, panneaux)
  assets/cards/        visuels des 52 cartes standard (mode A)
data/rooms/<CODE>.json  noms des joueurs mémorisés, par salon
uploads/<CODE>/          images extraites des archives zip envoyées, par salon (mode B)
```
