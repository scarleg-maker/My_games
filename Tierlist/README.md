# Créateur de Tier List

## Installation
```
npm install
```

## Lancement
```
npm start
```
Puis ouvre : http://localhost:9500/setup.html

## Fonctionnement
1. Sur la page de configuration, choisis le titre, les lignes (nom + couleur), le nombre max d'éléments par ligne,
   le contenu (archive ZIP d'images ou liste de noms), et le mode (solo ou multijoueur 2-8 joueurs).
2. En multijoueur, active éventuellement "Mort subite" ou "Dernière chance" (incompatibles entre eux), puis
   partage à chaque joueur son lien personnel (http://localhost:9500/joueur1.html, joueur2.html, ...).
3. Les joueurs placent leurs images/noms chacun à leur tour (clic sur une case puis clic sur une ligne).
   L'affichage se met à jour en temps réel pour tout le monde via Socket.io.
4. Une fois toutes les cases placées, un récapitulatif final s'affiche avec un bouton "Nouvelle partie".

Le serveur ne gère qu'une seule partie active à la fois (pensé pour un usage local entre amis sur le même réseau).
