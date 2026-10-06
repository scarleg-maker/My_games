# 🎓 Baccalauréat — Jeu en réseau local, avec salons

Plusieurs parties peuvent se dérouler **en même temps**, chacune dans son propre **salon** (un code court, par exemple `K7QF`). Chaque salon a sa configuration, ses joueurs, ses scores et son maître du jeu ; ils ne se voient pas entre eux.

## Installation

Installez [Node.js](https://nodejs.org/) (version 18 ou plus récente) si ce n'est pas déjà fait — c'est la seule condition préalable.

### Option A — Windows, en un clic

Double-cliquez sur **`lancer-le-jeu.bat`**. Ce fichier vérifie Node.js, installe les dépendances (au premier lancement), démarre le serveur et ouvre l'accueil dans votre navigateur.
Laissez la fenêtre noire ouverte pendant toute la partie ; fermez-la pour arrêter le serveur.

### Option B — Terminal (Windows / Mac / Linux)

```
npm install
npm start
```
Le serveur démarre sur le port **2000** et affiche aussi l'adresse du réseau local (ex : `http://192.168.1.24:2000/`).

> **Mise à jour depuis une ancienne version :** relancez `npm install` (une nouvelle dépendance, `qrcode`, a été ajoutée). Le `.bat` le fait tout seul.

## Utilisation

### Le maître du jeu
1. Ouvrez `http://localhost:2000/` sur l'ordinateur du maître.
2. Cliquez sur **Créer un salon** (code aléatoire), ou ouvrez *Choisir mon propre code* (3 à 10 lettres/chiffres, ex. `FAMILLE`).
3. Configurez la partie : nombre de joueurs, noms, thèmes, temps de réponse, puis **Créer la partie**.
4. Cliquez sur **Ouvrir la page Maître**. Elle affiche le **code du salon**, un **QR code** et un lien d'invitation à montrer ou envoyer aux joueurs.

### Les joueurs
- Ils **scannent le QR code**, ou ouvrent le lien d'invitation, ou saisissent le **code** sur la page d'accueil (`http://<adresse-du-serveur>:2000/`).
- Ils touchent **leur nom** dans la liste (les noms déjà connectés sont signalés).
- Chaque joueur dispose aussi d'un lien direct : `http://<adresse>:2000/CODE/joueur1`, `.../CODE/joueur2`, etc.
- Les salons récents sont mémorisés sur chaque appareil (accueil), pratique pour revenir après une coupure.

> Le QR code et le lien d'invitation utilisent automatiquement l'**adresse IP du réseau local** quand vous êtes sur `localhost`, pour que les téléphones puissent s'y connecter. Il n'y a pas besoin d'Internet.

### Déroulement d'une manche
- **Tirer une lettre** : animation de 2 s, puis la lettre s'affiche en plein écran 3 s chez tous les joueurs du salon.
- **Lancer la manche** : décompte de 3 s puis minuteur (visible aussi côté maître). Les champs ne sont modifiables que pendant ce temps.
- Fin de manche : à la fin du minuteur, ou dès que **tous** les joueurs ont cliqué sur **J'ai terminé**.
- Correction **thème par thème** : **Correcte** (2 pts), **Incomplète** (1 pt) ou **Invalide** (0 pt), puis **Valider ce thème**. Les réponses identiques sont repérées par un badge orange ; les joueurs voient les couleurs apparaître en direct.
- Ensuite : **Manche supplémentaire** ou **Terminer la partie** (vainqueur affiché chez tous).
- **Tirer une autre lettre** : −3 points à tous les joueurs (les scores ne descendent jamais sous 0).
- Les lettres déjà tirées ne reviennent pas avant que les 26 aient été utilisées.
- Le maître peut **reconfigurer** son salon (bouton en bas de sa page) pour lancer une nouvelle partie avec le même code.

## Notes techniques

- Les salons et parties sont **en mémoire** : redémarrer le serveur les efface. Un salon sans aucun appareil connecté depuis 6 heures est supprimé automatiquement (200 salons maximum).
- Les échanges maître ↔ joueurs se font en temps réel via WebSocket (Socket.io) ; chaque salon est une « room » Socket.io. Les pages se reconnectent seules à leur salon après une coupure Wi-Fi.
- Le port se change avec la variable `PORT` (ex. Windows : `set PORT=2050 && npm start`).
- Les thèmes proposés sont définis dans `server.js` (constante `THEMES_AVAILABLE`) ; chaque salon peut aussi ajouter des thèmes personnalisés à la configuration.
- Adresses : `/` accueil · `/CODE` page maître · `/CODE/config` configuration · `/CODE/rejoindre` choix du joueur · `/CODE/joueurN` page joueur.
