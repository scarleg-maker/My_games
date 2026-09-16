# Tic-Tac-Dice 🎲

Jeu de plateau multijoueur (2 à 10 joueurs) où les dés déterminent la position du pion à jouer.

## Installation

```bash
npm install
npm start
```

Le serveur démarre sur **http://localhost:16000**

- **Page maître (configuration)** : http://localhost:16000/
- **Page joueur (plateau de jeu)** : http://localhost:16000/joueur1
- **Écran unique (pass & play)** : http://localhost:16000/ecran-unique

Ouvrez `/joueur1` sur autant d'écrans que vous voulez (tablette, PC, téléphones...) :
tous les écrans affichent le même plateau, synchronisé en temps réel via WebSocket.
Le serveur n'autorise à lancer les dés et poser un pion que la page dont c'est le tour
(sauf `/ecran-unique`, voir ci-dessous).

### Jouer sur un seul écran

Ouvrez `/ecran-unique` : c'est un plateau partagé classique en mode "pass & play" —
n'importe qui présent sur cet écran peut lancer les dés et jouer à tour de rôle pour
chaque joueur, sans restriction d'identité. Pratique pour jouer autour d'une même
tablette ou d'un même PC.

## Comment jouer

1. Sur la **page maître**, choisissez le nombre de joueurs (2 à 10), leur nom et une
   couleur de pion parmi 10 couleurs classiques (chaque couleur ne peut être prise
   qu'une fois), la taille du plateau (6x6, 7x7, 8x8, 9x9) et la condition de victoire
   (3 ou 4 pions alignés). La combinaison **plateau 6x6 + 4 alignés** est interdite.
   À partir du joueur 2, une case **🤖 IA** permet de faire jouer ce joueur par
   l'ordinateur (intelligence modérée : elle vise les alignements, capture et
   endommage les pions adverses menaçants) — pratique pour jouer seul. Le joueur 1
   reste toujours humain.
2. Cliquez sur **Démarrer la partie**. Si une partie est déjà en cours, le bouton est
   bloqué avec un avertissement ; il faut cliquer sur **Forcer une nouvelle partie**
   pour l'écraser volontairement. Le plateau vide apparaît sur tous les écrans
   `/joueur1`, numéroté de 1 à N horizontalement et verticalement. Le premier joueur
   est tiré au sort.
3. Le joueur dont c'est le tour clique sur **Lancer les dés** (dés à 6, 7, 8 ou 9 faces
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
6. **En cours de partie**, la page maître affiche un panneau permettant de faire
   basculer n'importe quel joueur (sauf le joueur 1) entre humain et IA, avec
   confirmation avant chaque changement — utile si un joueur doit quitter la partie
   ou, à l'inverse, souhaite reprendre la main sur un joueur IA.
7. À la fin, **Relancer la partie** (même configuration) ou **Éditer la partie**
   (retour à la page maître, configuration pré-remplie pour modifier joueurs,
   noms, couleurs ou taille du plateau).

## Architecture

- `server.js` : serveur Express + Socket.IO, logique de jeu et état partagé.
- `public/maitre.html` / `maitre.js` : écran de configuration.
- `public/joueur.html` / `joueur.js` : écran de jeu (plateau, dés, interactions).
- `public/style.css` : dégradé vert → violet et styles partagés.
