# Mastermind

## Installation et lancement

```bash
npm install
node server.js
```

Le serveur démarre sur **http://localhost:1700**

## Utilisation

1. Ouvrez `http://localhost:1700/` (page maître) : choisissez le nombre de joueurs,
   le nombre de chiffres (3 à 6) et la difficulté, puis cliquez sur **Lancer la partie**.
2. **Mode solo (1 joueur)** : vous êtes redirigé vers la page de jeu. Devinez le
   nombre choisi par l'ordinateur ; chaque chiffre proposé est coloré en
   vert (bon chiffre, bonne place), orange (bon chiffre, mauvaise place, mode
   facile uniquement) ou rouge (absent). L'historique et le nombre de coups
   s'affichent jusqu'à la victoire.
3. **Mode duel (2 joueurs)** : la page maître affiche deux liens,
   `http://localhost:1700/joueur1` et `http://localhost:1700/joueur2`, à ouvrir
   dans deux navigateurs/onglets différents. Chaque joueur choisit (ou tire au
   sort) son nombre secret, puis le serveur tire au sort qui commence. Les
   joueurs jouent chacun leur tour, les réponses sont calculées par le serveur
   et synchronisées en temps réel (Socket.io), avec historique pour chacun.

## Difficulté

- **Facile** : vert / orange / rouge selon la position.
- **Difficile** : vert (chiffre présent) / rouge (chiffre absent), sans indication de position.
