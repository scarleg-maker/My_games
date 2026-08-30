# 🎴 Jeu des 7 Familles — Multijoueur (2 à 10 joueurs)

Application Node.js à héberger sur le PC "maître". Les joueurs se connectent
depuis leur téléphone/PC via le réseau local (Wi-Fi).

## 1. Installation (sur le PC maître)

Prérequis : [Node.js](https://nodejs.org/) installé (version 18+).

```bash
cd sept-familles
npm install
npm start
```

Le serveur démarre sur le port **1500**.

## 2. Ouvrir la page maître

Sur le PC maître, ouvrez un navigateur à l'adresse :

```
http://localhost:1500
```

### Onglet 1 — Cartes
Chargez un fichier **.zip contenant 42 images**, nommées ainsi :
```
Famille NN - Nom.png
```
Exemples : `Pirate 01 - Monkey D. Luffy.png`, `Marine 03 - Kizaru.png`

Les familles et leurs couleurs sont détectées automatiquement à partir des
noms de fichiers.

### Onglet 2 — Joueurs
Choisissez le nombre de joueurs (2 à 10), saisissez leurs noms, puis
« Enregistrer les joueurs ».

### Onglet 3 — Partie
Cliquez sur **« Lancer la partie »**. Les liens des pages joueurs
s'affichent, au format :
```
http://<IP-du-PC-maître>:1500/joueur1.html
http://<IP-du-PC-maître>:1500/joueur2.html
...
```

Pour trouver l'IP locale du PC maître : `ipconfig` (Windows) ou
`ifconfig`/`ip a` (Mac/Linux). Tous les joueurs doivent être sur le même
réseau Wi-Fi/local.

## 3. Côté joueurs

Chaque joueur ouvre son lien sur son téléphone ou son PC, puis :
1. Clique sur **« Recevoir mes cartes »** (distribution aléatoire).
2. Vérifie sa main, clique sur **« Je suis prêt »**.
3. Une fois tous les joueurs prêts, un joueur de départ est tiré au sort.

## 4. Déroulement d'un tour

- Le joueur actif choisit un **adversaire** sur son écran.
- Il annonce **à l'oral** la carte demandée (ce n'est pas saisi dans l'app).
- Si l'adversaire a la carte : il clique dessus, elle est transférée à
  l'écran du demandeur, qui peut continuer à jouer.
- Si l'adversaire n'a pas la carte : le demandeur clique sur **« Pioche »**,
  une carte aléatoire est tirée. Le joueur indique alors si c'était la bonne
  carte (il rejoue) ou non (tour du joueur suivant, ordre croissant).
- Dès qu'un joueur a 6 cartes d'une même famille, un bouton **« Famille »**
  apparaît : il valide, les cartes sont retirées de sa main et la famille
  s'affiche dans le panneau des familles complétées. Il peut alors rejouer.
- Un joueur sans carte peut piocher à son tour si la pioche n'est pas vide.
- La partie se termine quand les 7 familles sont complétées. Le vainqueur
  est le joueur ayant complété le plus grand nombre de familles.

## Notes techniques
- Le suivi (mains, pioche, familles, tour en cours) est visible en direct
  sur la page maître, onglet « Partie ».
- Chaque carte n'existe qu'en un seul exemplaire pour toute la partie
  (distribuées au départ + celles restantes en pioche).
- Si le port 1500 est déjà utilisé, modifiez la constante `PORT` dans
  `server.js`.
