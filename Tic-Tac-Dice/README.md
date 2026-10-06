# Tic-Tac-Dice 🎲

Jeu de plateau multijoueur (2 à 10 joueurs, humains et/ou IA) où les dés déterminent
la position du pion à jouer. Plusieurs groupes peuvent jouer **en même temps**, chacun
dans son propre **salon**.

## Installation

```bash
npm install
npm start
```

Le serveur démarre sur **http://localhost:16000**

## Les salons (parties séparées)

- **Accueil** (http://localhost:16000/) : créer un nouveau salon (code généré
  automatiquement, ou choisi à la main) ou rejoindre un salon existant avec son code.
- Chaque salon a son propre code (ex. `K7QF`) et héberge une partie **totalement
  indépendante** : ses propres joueurs, son plateau, ses dés, son IA. Autant de salons
  que nécessaire peuvent tourner simultanément sur le même serveur.
- **Page du salon (maître)** : `http://localhost:16000/{CODE}` — configuration de la
  partie, QR code et lien à partager, liens vers chaque page joueur, panneau de
  contrôle IA en direct.
- **Page joueur** : `http://localhost:16000/{CODE}/joueur1` ... `/joueur10`
- **Écran unique (pass & play)** : `http://localhost:16000/{CODE}/ecran-unique`

Scanner le QR code affiché sur la page du salon (ou partager son lien / son code)
amène directement les autres joueurs sur ce salon, où ils choisissent leur page joueur.

## Comment jouer

1. Depuis l'accueil, **crée un salon** (ou rejoins-en un avec son code). Tu arrives sur
   la page du salon : un code et un QR code y sont affichés en permanence, à partager
   avec les autres joueurs.
2. Choisis le nombre de joueurs (2 à 10), leur nom et une couleur de pion parmi 10
   couleurs classiques (chaque couleur ne peut être prise qu'une fois), la taille du
   plateau (6x6, 7x7, 8x8, 9x9) et la condition de victoire (3 ou 4 pions alignés). La
   combinaison **plateau 6x6 + 4 alignés** est interdite. À partir du joueur 2, une
   case **🤖 IA** permet de faire jouer ce joueur par l'ordinateur (intelligence
   modérée : elle vise les alignements, capture et endommage les pions adverses
   menaçants) — pratique pour jouer seul. Le joueur 1 reste toujours humain.
3. Clique sur **Démarrer la partie**. Si une partie est déjà en cours dans ce salon, le
   bouton est bloqué avec un avertissement ; il faut cliquer sur **Forcer une nouvelle
   partie** pour l'écraser volontairement. Le plateau vide apparaît sur tous les écrans
   joueurs de ce salon, numéroté de 1 à N horizontalement et verticalement. Le premier
   joueur est tiré au sort.
4. Le joueur dont c'est le tour clique sur **Lancer les dés** (dés 3D à 6, 7, 8 ou 9
   faces selon la taille du plateau). Animation de lancer pendant 2 secondes, puis les
   deux valeurs obtenues indiquent les 2 cases candidates : (dé1 horizontal, dé2
   vertical) ou (dé2 horizontal, dé1 vertical).
5. Le joueur clique sur la case de son choix parmi les cases en surbrillance (son
   propre pion déjà posé et sain n'est pas cliquable s'il existe une alternative) :
   - Case vide → son pion y est posé.
   - Case occupée par un pion adverse sain → le pion perd une vie (un trou apparaît
     au centre, toujours visible même sur un pion noir ou blanc).
   - Case occupée par un pion adverse déjà endommagé → le pion est capturé et
     remplacé par la couleur du joueur courant.
   - Case occupée par son propre pion endommagé → il récupère sa vie.
6. La partie se termine dès qu'un joueur aligne 3 ou 4 pions de sa couleur
   horizontalement, verticalement ou en diagonale.
7. **En cours de partie**, la page du salon affiche un panneau permettant de faire
   basculer n'importe quel joueur (sauf le joueur 1) entre humain et IA, avec
   confirmation avant chaque changement — utile si un joueur doit quitter la partie
   ou, à l'inverse, souhaite reprendre la main sur un joueur IA.
8. À la fin, **Relancer la partie** (même configuration) ou **Éditer la partie**
   (retour à la page du salon, configuration pré-remplie pour modifier joueurs, noms,
   couleurs ou taille du plateau).

## Jouer sur un seul écran

Ouvre `/{CODE}/ecran-unique` : c'est un plateau partagé classique en mode "pass & play"
— n'importe qui présent sur cet écran peut lancer les dés et jouer à tour de rôle pour
chaque joueur, sans restriction d'identité. Pratique pour jouer autour d'une même
tablette ou d'un même PC.

## Architecture

- `server.js` : serveur Express + Socket.IO. Chaque salon est une instance de jeu
  indépendante (fermeture JavaScript isolée : son propre plateau, sa propre config, ses
  propres timers IA), identifiée par un code et une "room" Socket.IO du même nom. Les
  salons inactifs depuis plus de 6h sont automatiquement supprimés.
- `public/accueil.html` / `accueil.js` : page d'accueil (créer / rejoindre un salon,
  salons récents mémorisés sur l'appareil).
- `public/maitre.html` / `maitre.js` : page du salon (configuration, QR code, liens
  joueurs, panneau IA).
- `public/joueur.html` / `joueur.js` : écran de jeu (plateau, dés, interactions).
- `public/style.css` : dégradé vert → violet et styles partagés.

Le QR code est généré côté navigateur via la bibliothèque `qrcodejs` (chargée depuis
cdnjs.cloudflare.com), aucune dépendance serveur supplémentaire n'est nécessaire.
