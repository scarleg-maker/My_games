# Mastermind-SLG

## Installation et lancement

```bash
npm install
node server.js
```

Le serveur démarre sur **http://localhost:1700**

## Salons : plusieurs parties séparées

Chaque partie créée vit dans son propre **salon**, identifié par un code
unique à 4 caractères (ex : `H5UB`). Plusieurs parties (solo ou duel)
peuvent ainsi tourner en même temps sur le même serveur sans jamais se
mélanger : les nombres secrets, l'historique et l'avancement d'un salon
sont invisibles des autres salons.

## Utilisation

1. Ouvrez `http://localhost:1700/` : choisissez le nombre de joueurs, le
   nombre de chiffres (3 à 6), le type de chiffres (uniques ou répétés) et
   la difficulté, puis cliquez sur **Lancer la partie**. Un salon est créé
   avec un code à 4 caractères.
2. **Mode solo (1 joueur)** : vous êtes redirigé vers `http://localhost:1700/CODE/solo`.
   Devinez le nombre choisi par l'ordinateur ; chaque chiffre proposé est
   coloré en vert (bon chiffre, bonne place), orange (bon chiffre, mauvaise
   place, mode facile uniquement) ou rouge (absent). L'historique et le
   nombre de coups s'affichent jusqu'à la victoire.
3. **Mode duel (2 joueurs)** : vous arrivez sur la page du salon
   (`http://localhost:1700/CODE`), qui affiche les deux liens à donner aux
   joueurs, chacun avec son propre **QR code** à scanner
   (`.../CODE/joueur1` et `.../CODE/joueur2`). Chaque joueur choisit (ou
   tire au sort) son nombre secret — affiché en haut de sa page pour ne pas
   l'oublier — puis le serveur tire au sort qui commence. Les joueurs
   jouent chacun leur tour, les réponses sont calculées par le serveur et
   synchronisées en temps réel (Socket.io), avec historique pour chacun.
4. **Rejoindre un salon** : sur la page d'accueil, on peut aussi entrer un
   code de salon existant pour le retrouver (utile si le lien a été perdu).

Les salons inactifs depuis plus de 6 heures (aucune page ouverte) sont
automatiquement supprimés de la mémoire du serveur.

## Deux types de jeu

- **Chiffres** : trouver un nombre secret de 3 à 6 chiffres (uniques ou répétés).
- **Mots** : trouver un mot secret de 4 à 7 lettres (A à Z, accents ignorés :
  « Crème » est lu « CREME »). Une lettre peut toujours se répéter. En solo,
  l'ordinateur tire le mot dans son dictionnaire (`mots.js`, extensible) ; en
  duel, chaque joueur choisit son mot (n'importe quelle suite de lettres) ou
  utilise le bouton « Aléatoire ». Les couleurs et les niveaux de difficulté
  sont les mêmes que pour les chiffres.

## Difficulté

- **Facile** : vert / orange / rouge selon la position.
- **Difficile** : vert (chiffre présent) / rouge (chiffre absent), sans indication de position.

## Chiffres

- **Chiffre unique** : chaque chiffre du nombre n'apparaît qu'une fois.
- **Chiffre répété** : un même chiffre peut apparaître plusieurs fois (ex : 11223).

## Lancement rapide sous Windows

Double-cliquez sur `Lancer_Mastermind-slg.bat` : il installe les dépendances au
premier lancement, démarre le serveur et ouvre le navigateur sur
http://localhost:1700. Fermez la fenêtre pour arrêter le serveur.
