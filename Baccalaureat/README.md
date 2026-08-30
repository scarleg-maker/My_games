# 🎓 Baccalauréat — Jeu en réseau local

## Installation

1. Installez [Node.js](https://nodejs.org/) (version 18 ou plus récente) si ce n'est pas déjà fait — c'est la seule condition préalable.

### Option A — Windows, en un clic

Double-cliquez simplement sur **`lancer-le-jeu.bat`**.
Ce fichier :
- vérifie que Node.js est installé,
- installe les dépendances automatiquement au premier lancement,
- démarre le serveur,
- ouvre la page maître dans votre navigateur,
- affiche l'adresse IP locale à donner aux joueurs (ex : `http://192.168.1.24:2000/player/1`).

Laissez la fenêtre noire ouverte pendant toute la partie ; fermez-la pour arrêter le serveur.

### Option B — Terminal (Windows / Mac / Linux)

Ouvrez un terminal dans ce dossier et lancez :
```
npm install
npm start
```
Le serveur démarre sur le port **2000**. Vous verrez :
```
Baccalauréat lancé : http://localhost:2000
```

## Utilisation

1. Sur l'ordinateur "maître", ouvrez `http://localhost:2000/` dans un navigateur.
2. Configurez la partie : nombre de joueurs, noms, thèmes, temps de réponse. Cliquez sur **Créer la partie**.
3. Une page apparaît avec :
   - un bouton pour **ouvrir la page Maître** (à garder sur votre ordinateur),
   - la liste des liens joueurs, du type `http://<votre-ip>:2000/player/1`, `.../player/2`, etc.
4. Pour que les autres joueurs accèdent à leur page depuis leur téléphone/ordinateur (sur le même réseau Wi-Fi), remplacez `localhost` par l'**adresse IP locale** de l'ordinateur qui héberge le serveur (ex : `192.168.1.24:2000/player/1`). Vous pouvez trouver cette adresse IP via `ipconfig` (Windows) ou `ifconfig` / `ip a` (Mac/Linux).
5. Depuis la page Maître :
   - **Tirer une lettre** : lance le tirage (2 s d'animation), la lettre s'affiche en plein écran sur les pages joueurs pendant 3 s.
   - **Lancer la manche** : décompte de 3 s puis le minuteur démarre sur toutes les pages joueurs. Les cases ne sont modifiables que pendant ce temps.
   - À la fin du temps, la page Maître affiche les réponses **thème par thème** : cliquez sur **Correcte** (2 pts), **Incomplète** (1 pt) ou **Invalide** (0 pt) pour chaque joueur, puis **Valider ce thème** pour passer au suivant.
   - Une fois tous les thèmes corrigés, choisissez **Manche supplémentaire** (nouvelle lettre) ou **Terminer la partie** (affiche le vainqueur sur toutes les pages).

## Nouveautés

- **Bouton "J'ai terminé"** sur les pages joueurs : un joueur qui a fini de répondre peut cliquer dessus pour signaler qu'il est prêt. Quand **tous** les joueurs ont cliqué, la manche se termine immédiatement (plus besoin d'attendre la fin du minuteur).
- **Minuteur fiable** : chaque page calcule désormais son propre décompte à partir du temps restant reçu du serveur, ce qui évite tout décalage lié à l'horloge de l'ordinateur/téléphone du joueur.
- **Alerte à 10 secondes** : le minuteur passe en rouge et un message clignotant "⏰ Il reste 10 secondes !" apparaît.
- **Code couleur des réponses passées** : sur leur tableau, les joueurs voient chaque réponse validée en vert (Correcte), orange (Incomplète) ou rouge (Invalide), avec le libellé du statut.
- **Lettres sans répétition** : la page Maître affiche la liste des lettres déjà tirées, et le tirage aléatoire les exclut automatiquement (une lettre ne peut pas revenir avant que toutes les 26 aient été utilisées).
- **Retirer une lettre** : une fois une lettre tirée (avant de lancer la manche), le Maître peut cliquer sur **"Tirer une autre lettre (-3 pts à tous)"** — une nouvelle lettre est tirée, mais 3 points sont retirés au total de tous les joueurs (une notification apparaît sur tous les écrans).

## Notes techniques

- Le jeu ne gère qu'**une seule partie à la fois** (état en mémoire sur le serveur). Créer une nouvelle partie depuis l'accueil réinitialise tout.
- Les échanges maître ↔ joueurs se font en temps réel via WebSocket (Socket.io) : la synchronisation du minuteur, du tirage de lettre et des scores est gérée par le serveur.
- Les thèmes proposés sont prédéfinis dans `server.js` (constante `THEMES_AVAILABLE`) : vous pouvez librement modifier cette liste.
