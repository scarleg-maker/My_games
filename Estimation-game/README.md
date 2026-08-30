# 🎯 Jeu d'estimation — Book-maker

Jeu multijoueur en temps réel : un joueur (le "Book-maker") reçoit un pourcentage
tiré au hasard sur un thème donné, écrit un indice, et les autres joueurs doivent
deviner ce pourcentage le plus précisément possible.

## Installation

```bash
npm install
```

## Lancement

### Windows — méthode rapide
Double-cliquez sur **`lancer-le-jeu.bat`** : il installe les dépendances si besoin,
démarre le serveur et ouvre automatiquement `http://localhost:2500` dans votre navigateur.

### Manuellement (Windows / Mac / Linux)
```bash
npm start
```

Le serveur démarre sur **http://localhost:2500**

## Utilisation

1. Ouvrez `http://localhost:2500/` sur l'ordinateur du maître du jeu.
2. Choisissez le nombre de joueurs (2 à 8), donnez un nom à chacun
   (ces noms sont mémorisés dans le navigateur d'une partie à l'autre),
   indiquez le thème de la partie et le nombre de points pour gagner (10 à 100).
3. Cliquez sur **« Lancer la partie »**.
4. Chaque joueur ouvre son lien personnel affiché sur l'écran du maître,
   par exemple `http://localhost:2500/joueur1`, `http://localhost:2500/joueur2`, etc.
   (sur son téléphone/ordinateur, connecté au même réseau que le serveur).
5. Un joueur est désigné aléatoirement comme Book-maker (affiché 2 secondes).
   Il voit un pourcentage tiré au hasard sur sa jauge en demi-cercle et écrit un indice.
6. Les autres joueurs lisent l'indice, ajustent leur curseur entre 0 et 100 % sur
   leur propre jauge, puis valident.
7. Les points sont attribués selon la précision :
   - Exact : 5 points
   - ± 2 : 3 points
   - ± 5 : 2 points
   - ± 8 : 1 point
8. Le tableau des résultats de la manche s'affiche pour tous, puis le Book-maker
   valide pour passer au joueur suivant.
9. La partie se termine dès qu'un joueur atteint le nombre de points fixé.
   Le tableau des scores est visible en permanence sur la page maître.

## Structure du projet

```
estimation-game/
├── server.js              # Serveur Express + Socket.io, logique de jeu
├── package.json
├── lancer-le-jeu.bat      # Windows : installe, lance le serveur et ouvre le navigateur
└── public/
    ├── master.html / css / js  # Console maître
    ├── player.html              # Page joueur (jauge demi-cercle)
    ├── css/style.css            # Style (dégradé vert → cyan)
    └── js/
        ├── master.js
        ├── player.js
        └── gauge.js             # Dessin de la jauge SVG partagée
```
