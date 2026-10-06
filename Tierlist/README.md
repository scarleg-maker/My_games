# Créateur de Tier List

## Installation
```
npm install
```

## Lancement
```
npm start
```
Puis ouvre : http://localhost:9500/

## Fonctionnement (salons)
Chaque groupe joue dans son propre **salon**, identifié par un code à 4 caractères (ex. `F7K2`), ce qui permet
de faire tourner plusieurs parties séparées en même temps sur le même serveur.

1. Sur la page d'accueil (`http://localhost:9500/`), clique **"Créer un salon"** : un code est généré et tu es redirigé
   vers la page de configuration de ce salon.
2. Choisis le titre, les lignes (nom + couleur), le nombre max d'éléments par ligne, le contenu (archive ZIP d'images
   ou liste de noms), et le mode (solo ou multijoueur 2-8 joueurs).
3. En multijoueur, active éventuellement "Mort subite" ou "Dernière chance" (incompatibles entre eux), puis partage
   le code du salon, les liens, ou les QR codes à chaque joueur. Chacun peut aussi taper le code sur la page d'accueil
   pour rejoindre.
4. Les joueurs placent leurs images/noms chacun à leur tour (clic, ou glisser-déposer sur ordinateur) puis valident
   leur tour. L'affichage se met à jour en temps réel pour tout le monde.
5. Une fois toutes les cases placées, un récapitulatif final s'affiche avec un bouton "Nouvelle partie" (qui réutilise
   le même code de salon pour la manche suivante).

Le serveur peut gérer plusieurs salons simultanément, chacun totalement indépendant. Un salon sans aucune page ouverte
depuis 6h est automatiquement libéré de la mémoire.

Pensé pour un usage local entre amis sur le même réseau.
