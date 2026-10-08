# 🎯 Estimation-Game-SLG — Book-maker

Jeu multijoueur en temps réel : un joueur (le "Book-maker") reçoit un pourcentage
tiré au hasard sur un thème donné, écrit un indice, et les autres joueurs doivent
deviner ce pourcentage le plus précisément possible.

**Système de salons** : plusieurs groupes peuvent jouer en même temps sur le même
serveur, chacun dans son propre salon identifié par un code (ex. `R8MC` ou un code
personnalisé comme `FAMILLE`), avec QR code d'invitation.

## Installation

```bash
npm install
```

## Lancement

### Windows — méthode rapide
Double-cliquez sur **`Estimation-Game-SLG.bat`** : il installe les dépendances si besoin,
démarre le serveur et ouvre automatiquement `http://localhost:2500` dans votre navigateur.

### Manuellement (Windows / Mac / Linux)
```bash
npm start
```

Le serveur démarre sur **http://localhost:2500**

## Utilisation

### 1. Page d'accueil (`http://localhost:2500/`)
- **Créer une partie** → un salon est créé avec un code aléatoire (ou un code personnalisé
  au choix, ex. `FAMILLE`), et vous êtes redirigé vers la console maître de ce salon.
- **Rejoindre une partie** → entrez le code donné par le maître du jeu, puis touchez
  votre nom dans la liste des sièges.

### 2. Console maître (`/CODE`)
1. Choisissez le nombre de joueurs (2 à 8), donnez un nom à chacun
   (ces noms sont mémorisés dans le navigateur d'une partie à l'autre),
   indiquez le thème de la partie et le nombre de points pour gagner (10 à 100).
2. Cliquez sur **« Lancer la partie »**.
3. Un **QR code** et un lien `http://.../CODE/rejoindre` apparaissent : les joueurs
   scannent le code (ou tapent le code du salon sur la page d'accueil) puis choisissent
   leur nom dans la liste. Les liens directs par joueur restent aussi disponibles
   (`/CODE/joueur1`, `/CODE/joueur2`, etc.).

### 3. Déroulement d'une manche
1. Un joueur est désigné aléatoirement comme Book-maker (affiché 2 secondes).
   Il voit un pourcentage tiré au hasard sur sa jauge en demi-cercle et écrit un indice.
2. Les autres joueurs lisent l'indice, ajustent leur curseur entre 0 et 100 % sur
   leur propre jauge, puis valident.
3. Les points sont attribués selon la précision :
   - Exact : 5 points
   - ± 2 : 3 points
   - ± 5 : 2 points
   - ± 8 : 1 point
4. Le tableau des résultats de la manche s'affiche pour tous, avec la réponse et les
   zones de points représentées sur la jauge, puis le Book-maker valide pour passer
   au joueur suivant.
5. La partie se termine dès qu'un joueur atteint le nombre de points fixé.
   Le tableau des scores est visible en permanence sur la console maître.

Plusieurs salons peuvent tourner **en parallèle** sans interférer les uns avec les
autres : chaque groupe a son propre code, ses propres joueurs, son propre thème et
son propre tableau de scores.

## Structure du projet

```
Estimation-Game-SLG/
├── server.js              # Serveur Express + Socket.io : salons, routes, logique de jeu
├── package.json
├── Estimation-Game-SLG.bat      # Windows : installe, lance le serveur et ouvre le navigateur
└── public/
    ├── accueil.html / js/accueil.js   # Page d'accueil : créer / rejoindre un salon
    ├── maitre.html   / js/maitre.js   # Console maître d'un salon (QR code, scores)
    ├── joueur.html   / js/joueur.js   # Page joueur (jauge demi-cercle)
    ├── js/gauge.js                    # Dessin de la jauge SVG partagée
    └── css/style.css                  # Style (dégradé vert → cyan)
```

## Notes

- Les parties en cours sont conservées en mémoire sur le serveur ; un salon sans
  personne connecté depuis 6 heures est automatiquement supprimé.
- Pour que les joueurs rejoignent depuis leurs téléphones, tous les appareils
  doivent être sur le **même réseau Wi-Fi** que l'ordinateur qui héberge le serveur.
  Le QR code utilise automatiquement l'adresse IP locale du réseau plutôt que
  `localhost` (injoignable depuis un autre appareil).
