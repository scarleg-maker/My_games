# Composez votre équipe

Jeu de cartes multijoueur local (Node.js + Socket.io). Une page « maître » configure
et pilote la partie, chaque joueur ouvre sa propre page sur son écran/téléphone.

## Installation

```bash
npm install
node server.js
```

Puis ouvrez `http://localhost:4000` sur l'ordinateur du maître du jeu.
Les joueurs ouvrent `http://<IP-du-maître>:4000/joueur1`, `/joueur2`, etc.
(sur le même réseau local — remplacez `localhost` par l'adresse IP de la machine
qui héberge le serveur si les joueurs utilisent d'autres appareils).

## Mise en place d'une partie

1. Choisissez le mode : **A – Cartes standardes** (52 cartes classiques, 4 à 6
   joueurs) ou **B – Carte au choix** (vos photos, 2 à 6 joueurs).
2. Renseignez le nombre de joueurs (2 à 6) et leurs noms — ils sont mémorisés
   d'une partie à l'autre.
3. Décrivez un thème libre (affiché en haut des pages, ex. « Équipage de
   pirate »).
4. Réglez le nombre de tours (3 à 20), le nombre de points pour gagner
   (50 à 100, par palier de 10) et le nombre de cartes distribuées par joueur
   ("Toutes" pour répartir équitablement tout le paquet/toutes les images, ou
   un nombre fixe entre 6 et 20 — le serveur refuse le lancement si ce nombre
   dépasse ce qui est réellement distribuable compte tenu du nombre de joueurs
   et, en mode B, du nombre d'images importées).
5. En mode B, importez une archive `.zip` contenant au minimum 42 images.
   Chaque fichier doit être nommé `Nom (niveau).extension`, le niveau étant
   écrit sur **deux chiffres, de 01 (le plus faible) à 20 (le plus fort)** —
   le zéro devant est obligatoire pour les niveaux 01 à 09, par exemple
   `Capitaine (08).jpg`. Le niveau n'est **jamais montré aux joueurs**, seul
   le maître le voit une fois la carte posée sur la table.
6. Cliquez sur « Lancer la partie », puis partagez les liens joueurs affichés
   sur la page maître.

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
server.js          serveur Express + Socket.io, routes API
gameEngine.js       logique de jeu (distribution, tours, scores)
public/             pages HTML/CSS/JS (maître et joueur)
data/players.json   noms des joueurs mémorisés
uploads/            images extraites des archives zip envoyées (mode B)
```
