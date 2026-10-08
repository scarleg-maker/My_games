# Memory-SLG — jeu des paires avec salons

Jeu de Memory avec vos propres images, de 1 à 8 joueurs. Chaque **salon** (identifié par un code court, ex. `K7QF`) est une partie complète et indépendante : ses images, ses joueurs, son plateau et son chronomètre. Plusieurs salons peuvent tourner en même temps sans jamais se mélanger.

## Lancer le jeu

Il faut [Node.js](https://nodejs.org) (version 18 ou plus). Aucune installation de paquet n'est nécessaire.

```
node server.js
```

Puis ouvrir **http://localhost:14500** (le terminal affiche aussi l'adresse à utiliser depuis un téléphone ou un autre ordinateur du même réseau).

Sur un hébergeur (Render, etc.), la commande de démarrage est `node server.js` ; le port est lu dans la variable `PORT`.

## Comment jouer

1. **Accueil** : « Créer un salon » (code aléatoire, ou code personnalisé de 3 à 10 caractères) ou « Rejoindre » avec un code.
2. **Page arbitre** (`/CODE`) : charger les images (fichiers, dossier ou archive .zip), choisir 1 joueur ou 2 à 8 joueurs, saisir les noms, puis « Démarrer ».
   - **Un seul écran** : tout le monde joue sur l'écran de l'arbitre, chacun son tour.
   - **Un écran par joueur** : chaque joueur rejoint le salon avec le code ou le QR code et joue depuis son téléphone ou son ordinateur (`/CODE/joueur1`, `/CODE/joueur2`…).
3. **Règles** : on retourne deux cartes. Identiques : elles restent visibles, entourées de la couleur du joueur, qui rejoue. Différentes : elles restent affichées 3 secondes (le chrono est en pause) puis se recachent, et c'est au joueur suivant. La partie se termine quand toutes les paires sont trouvées ; en multijoueur, le vainqueur est celui qui a le plus de paires.
4. Le bouton **Pause** de l'arbitre arrête le chronomètre et masque le plateau.

## Ce qui est conservé

Pour chaque salon, le serveur garde dans le dossier `donnees/` : les images chargées, les noms des joueurs et les réglages. En revenant avec le même code, on retrouve tout (utile avec un code personnalisé comme `FAMILLE`). Le bouton « Supprimer ce salon » efface ces données. Les 100 salons les plus récents sont conservés.

## Contenu du dossier

- `server.js` — serveur (aucune dépendance) : salons, règles du jeu, chronomètre, temps réel.
- `public/` — pages du site : `accueil.html`, `maitre.html` (arbitre), `joueur.html`, `common.js`, `style.css`.
- `donnees/` — créé automatiquement (sauvegarde des salons).
- `hors-ligne/Memory-SLG.html` — l'ancienne version, un seul fichier à ouvrir dans un navigateur, sans salons ni serveur.

Les cartes cachées ne révèlent jamais leur image avant d'être retournées : le serveur n'envoie aux écrans que les cartes visibles.
