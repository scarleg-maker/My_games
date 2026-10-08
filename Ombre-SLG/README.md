# Ombre-SLG — jeu de devinette de silhouettes

## Installation

1. Installe [Node.js](https://nodejs.org/) si ce n'est pas déjà fait.
2. Ouvre un terminal dans ce dossier.
3. Installe les dépendances :
   ```
   npm install
   ```

## Lancer le jeu

**Option simple :** double-clique sur `Lancer_Ombre-SLG.bat`.
Il démarre le serveur et ouvre automatiquement `http://localhost:3300` dans ton navigateur après 2 secondes. La fenêtre de terminal reste ouverte : c'est normal, elle affiche les logs du serveur (ferme-la pour arrêter la partie).

**Option manuelle :**
```
npm start
```
puis ouvre `http://localhost:3300` toi-même.

## Ajouter tes images

Il n'y a plus de dossier `images/` à préparer à l'avance : sur la page maître, clique sur **Archive ZIP d'images** et choisis directement un fichier `.zip` contenant tes silhouettes (dossiers ou sous-dossiers à l'intérieur du zip, peu importe). Le zip est envoyé au serveur au moment de la création de la partie, lu **en mémoire uniquement** (jamais écrit sur le disque), et n'est plus nécessaire une fois la partie créée.

Le nom affiché aux joueurs pour chaque image est **le nom du fichier sans son extension**. Utilise idéalement les PNG en silhouette noire sur fond transparent générés avec les scripts précédents (`silhouette_batch.py`). Formats acceptés à l'intérieur du zip : `.png .jpg .jpeg .webp .bmp .gif`.

## Les salons (plusieurs parties en même temps)

Le serveur peut héberger **plusieurs parties indépendantes en parallèle** : chacune se joue dans son propre « salon », identifié par un code (ex. `K7QF`). Deux groupes peuvent jouer en même temps sur le même serveur sans interférer l'un avec l'autre.

1. Ouvre `http://localhost:3300` (la page d'accueil).
2. **Créer une partie** : clique sur **Créer un salon** (code généré automatiquement) ou saisis ton propre code (ex. `FAMILLE`) via « Choisir mon propre code ». Tu es redirigé vers `http://localhost:3300/<CODE>`, la page maître de ce salon.
3. **Rejoindre une partie** : sur la page d'accueil, les joueurs entrent le code donné par le maître et cliquent sur **Rejoindre**.
4. Sur la page maître, l'écran « Salon d'attente » affiche un **QR code** et un lien direct (`http://localhost:3300/<CODE>/joueur`) à partager — pratique pour que les joueurs scannent plutôt que de taper le code.
5. La page d'accueil retient aussi les derniers salons visités sur cet appareil (« Salons récents »), pour y revenir facilement.

Un salon sans personne connectée depuis 6 heures est automatiquement supprimé du serveur.

## Utilisation (dans un salon)

1. Sur la page maître du salon : choisis le nombre de joueurs, leurs noms, le zip d'images, le nombre d'essais/erreurs, le temps par manche, le mode de jeu, puis crée la partie.
2. Chaque joueur rejoint via le code ou le QR code (voir ci-dessus), puis clique sur son nom.
3. Une fois tous les joueurs connectés, clique sur **Démarrer la partie** puis **Manche suivante** pour lancer chaque manche.
4. Le bouton **Valider quand même** permet de compter comme juste une réponse mal orthographiée.

## Rappel des règles

- **Survie** : tous les joueurs voient la même image. Chaque bonne réponse rapporte 1 point. Le nombre d'essais réglé à la création est un **budget total d'erreurs pour toute la partie** (pas remis à zéro à chaque manche) : dès qu'un joueur épuise ce budget, **ou si le minuteur arrive à 0 avant qu'il ait trouvé**, il est **éliminé directement et définitivement** (les points déjà marqués restent acquis et servent au classement final). La partie se termine quand il ne reste plus qu'un survivant, ou quand toutes les images de l'archive ont été utilisées.
- **Élimination** : chaque joueur reçoit une image différente à chaque manche (le pool est repioché au hasard, une même image peut retomber sur un autre joueur plus tard). Le nombre d'essais est remis à zéro à chaque manche. À la fin de la manche, tout joueur n'ayant pas trouvé perd une vie. À 0 vie, il est éliminé définitivement. Le dernier survivant gagne.

## Réseau local (jouer sur plusieurs appareils)

Pour que les autres joueurs accèdent au jeu depuis leur téléphone/PC, remplace `localhost` par l'adresse IP locale de la machine qui héberge le serveur (affichée aussi dans le terminal au démarrage, ex : `http://192.168.1.42:3300`), et assure-toi que le pare-feu Windows autorise les connexions entrantes sur le port 3300. Le QR code généré sur la page maître pointe automatiquement vers la bonne adresse.
