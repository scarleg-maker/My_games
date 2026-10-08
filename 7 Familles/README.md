# 🎴 Jeu des 7 Familles — Multijoueur avec salons (2 à 10 joueurs)

Application Node.js à héberger sur le PC « maître ». Plusieurs parties **séparées** peuvent se jouer en même
temps, chacune dans son propre **salon** (code court + QR code). Les joueurs se connectent depuis leur
téléphone ou leur PC, sur le même réseau Wi-Fi.

## 1. Installation (sur le PC maître)

Prérequis : [Node.js](https://nodejs.org/) 18 ou plus.

```bash
cd sept-familles
npm install      # à refaire après chaque mise à jour (nouvelles dépendances)
npm start
```

Le serveur démarre sur le port **1500** (modifiable : variable d'environnement `PORT`).
Au démarrage, il affiche aussi l'adresse à utiliser depuis le réseau local.

## 2. Les salons

| Adresse | Rôle |
|---|---|
| `http://IP:1500/` | Accueil : créer un salon ou rejoindre avec un code |
| `http://IP:1500/K7QF` | Page de l'**arbitre** du salon K7QF |
| `http://IP:1500/K7QF/rejoindre` | Page « rejoindre » (adresse du **QR code**) : liste des sièges |
| `http://IP:1500/K7QF/joueur1.html` | Page du joueur 1 (`joueur2.html`, … jusqu'à `joueur10.html`) |

Chaque salon a **sa propre partie, ses propres cartes et ses propres joueurs** : rien n'est partagé entre salons.

### Côté arbitre
1. Sur l'accueil, **« Créer un salon »** (code aléatoire) — ou « Choisir mon propre code » (3 à 10 lettres/chiffres,
   ex. `FAMILLE`) pour retrouver le même salon d'une fois sur l'autre.
2. La page arbitre affiche le **code**, un **QR code** et un lien à donner aux joueurs.
   Si le PC a plusieurs adresses réseau (WSL, VPN…), un menu permet de choisir celle du Wi-Fi.
3. Onglet **Cartes** : choisir un jeu dans **« Jeux de cartes disponibles »** (archives du dossier `archives/`,
   un clic sur « Utiliser »), ou envoyer son propre `.zip` de 42 images nommées `Famille NN - Nom.png`
   (ex. `Pirate 01 - Monkey D. Luffy.png`).
4. Onglet **Joueurs** : nombre de joueurs (2 à 10) et leurs noms → « Enregistrer ».
5. Onglet **Partie** : « Lancer la partie ». Le suivi en direct (cartes en main, prêts, joueurs connectés,
   pioche, familles) s'affiche. À la fin, **« Nouvelle partie »** relance dans le même salon, avec les mêmes
   cartes et les mêmes joueurs.

### Côté joueurs
Scanner le QR code (ou taper le code sur l'accueil), puis toucher son siège. Chaque joueur :
1. clique sur **« Recevoir mes cartes »** (6 cartes chacun, le reste forme la pioche) ;
2. vérifie sa main, puis clique sur **« Je suis prêt »** ;
3. quand tous sont prêts, le premier joueur est tiré au sort.

Recharger la page ou perdre le Wi-Fi quelques secondes ne casse rien : la main et le tour sont restaurés.

## 3. Déroulement d'un tour

- Le joueur actif choisit un **adversaire** et annonce **à l'oral** la carte demandée.
- Si l'adversaire l'a, il **clique dessus** : elle passe chez le demandeur, qui garde la main.
- Sinon, le demandeur clique sur **« Pioche »** : une carte au hasard s'affiche. Il indique si c'était la carte
  demandée (il rejoue) ou non (joueur suivant, dans l'ordre croissant).
- **Pioche vide** : le bouton devient **« Passer mon tour »**.
- Avec 6 cartes d'une même famille, un bouton **« Famille »** apparaît : les 6 cartes quittent la main et la
  famille s'affiche dans le panneau des familles complétées. On peut ensuite rejouer.
- La partie se termine quand les 7 familles sont constituées ; le vainqueur est celui qui en a le plus
  (égalité possible, elle est annoncée).

## 4. Le dossier `archives/` (jeux de cartes fournis avec le serveur)

Tout `.zip` déposé dans `archives/` apparaît dans la page arbitre avec son nombre de cartes et ses familles.
Le nom du fichier est le nom affiché (`One Piece.zip` → « One Piece »). Le dossier est relu à chaque ouverture de la
page arbitre : pas besoin de redémarrer le serveur. Un zip inutilisable est listé avec un avertissement.
Un jeu d'exemple (`Exemple - Animaux.zip`) est fourni : vous pouvez le supprimer.

**Sur Render** : les fichiers envoyés depuis le navigateur sont effacés à chaque redémarrage du service, alors que
le contenu du dépôt reste. Il suffit donc de **commiter les `.zip` dans `archives/`** puis de redéployer.
Le fichier `.gitignore` fourni exclut `node_modules/`, `uploads/` et `sauvegarde.json` du dépôt, pas `archives/`.

## 5. À savoir

- **Pare-feu Windows** : à la première exécution, autoriser Node.js sur le réseau privé, sinon les téléphones
  ne pourront pas se connecter.
- Le serveur mémorise, par salon, les **cartes chargées** et les **noms des joueurs** (fichier
  `sauvegarde.json` + dossier `uploads/cards/CODE`) : après un redémarrage, un salon retrouvé avec son code est
  prêt à rejouer sans recharger le zip. Les 40 salons les plus récents sont conservés. La **partie en cours**,
  elle, n'est pas conservée.
- Un salon que plus personne n'a ouvert depuis 6 h est libéré de la mémoire (il se recrée avec ses cartes et
  ses joueurs enregistrés).
- La page arbitre est accessible à quiconque connaît le code du salon : ne donnez aux joueurs que le QR code /
  le lien « rejoindre ».
- Le QR code est généré par le serveur : aucune connexion internet n'est nécessaire.
