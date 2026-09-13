# Tic-Tac-Dice 🎲

Jeu de plateau multijoueur (2 à 6 joueurs) où les dés déterminent la position du pion à jouer.

## Installation

```bash
npm install
npm start
```

Le serveur démarre sur **http://localhost:16000**

- **Page maître (configuration)** : http://localhost:16000/
- **Page joueur (plateau de jeu)** : http://localhost:16000/joueur1

Ouvrez `/joueur1` sur autant d'écrans que vous voulez (tablette, PC, téléphones...) :
tous les écrans affichent le même plateau, synchronisé en temps réel via WebSocket.

## Comment jouer

1. Sur la **page maître**, choisissez le nombre de joueurs (2 à 6), leur nom et une
   couleur de pion parmi 10 couleurs classiques (chaque couleur ne peut être prise
   qu'une fois), la taille du plateau (6x6, 7x7, 8x8) et la condition de victoire
   (3 ou 4 pions alignés). La combinaison **plateau 6x6 + 4 alignés** est interdite.
2. Cliquez sur **Démarrer la partie**. Le plateau vide apparaît sur tous les écrans
   `/joueur1`, numéroté de 1 à N horizontalement et verticalement. Le premier joueur
   est tiré au sort.
3. Le joueur dont c'est le tour clique sur **Lancer les dés** (dés à 6, 7 ou 8 faces
   selon la taille du plateau). Animation de lancer pendant 2 secondes, puis les deux
   valeurs obtenues indiquent les 2 cases candidates : (dé1 horizontal, dé2 vertical)
   ou (dé2 horizontal, dé1 vertical). Les deux cases possibles sont mises en surbrillance.
4. Le joueur clique sur la case de son choix parmi les cases en surbrillance :
   - Case vide → son pion y est posé.
   - Case occupée par un pion adverse sain → le pion perd une vie (un trou apparaît
     au centre).
   - Case occupée par un pion adverse déjà endommagé → le pion est capturé et
     remplacé par la couleur du joueur courant.
   - Case occupée par son propre pion endommagé → il récupère sa vie (le trou disparaît).
   - Case occupée par son propre pion sain → rien ne se passe, tour passé.
5. La partie se termine dès qu'un joueur aligne 3 ou 4 pions de sa couleur
   horizontalement, verticalement ou en diagonale.
6. À la fin, **Relancer la partie** (même configuration) ou **Éditer la partie**
   (retour à la page maître, configuration pré-remplie pour modifier joueurs,
   noms, couleurs ou taille du plateau).

## Architecture

- `server.js` : serveur Express + Socket.IO, logique de jeu et état partagé.
- `public/maitre.html` / `maitre.js` : écran de configuration.
- `public/joueur.html` / `joueur.js` : écran de jeu (plateau, dés, interactions).
- `public/style.css` : dégradé vert → violet et styles partagés.
