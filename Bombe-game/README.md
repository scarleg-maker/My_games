# 💣 Jeu de la Bombe

## Installation

```bash
npm install
npm start
```

Le serveur démarre sur **http://localhost:8000**

## Utilisation

1. Ouvrez `http://localhost:8000` — c'est la **page maître / arbitre**.
2. Choisissez le nombre de joueurs (2 à 8), entrez leurs noms (les noms des
   parties précédentes sont proposés en auto-complétion et pré-remplis).
3. Sélectionnez une archive **.zip** contenant des images (jpg, png, gif,
   webp) et cliquez sur "Charger l'archive".
4. Réglez :
   - Nombre d'images en jeu (25 à 75)
   - Nombre max de cartes par joueur pour gagner (5 à 10)
   - Nombre de bombes par joueur (1 à 5)
5. Cliquez sur **Lancer la partie**.
6. La page maître affiche les liens `/joueur1`, `/joueur2`, ... à distribuer
   à chaque joueur (sur d'autres onglets/appareils du même réseau).
7. **Phase de pose des bombes** : chaque joueur place ses bombes sur le
   plateau (visible uniquement par lui, sauf pour l'arbitre qui voit tout
   en temps réel), puis valide.
8. Une fois tout le monde validé, la **phase de tirage** commence : l'ordre
   est tiré au hasard, chacun pioche une image à son tour. Une image piégée
   fait perdre la carte piochée + la dernière carte "saine" du joueur
   (mécanique en cascade).
9. La manche se termine quand toutes les équipes sont complètes ou que
   toutes les images ont été piochées.
10. L'arbitre élimine les joueurs de son choix puis peut relancer une
    **nouvelle manche** avec les mêmes images (nouvel ordre aléatoire), et
    ainsi de suite jusqu'à ce qu'il ne reste qu'un vainqueur.

## Notes techniques

- Temps réel via Socket.IO.
- Les noms de joueurs sont persistés dans `data/players.json`.
- Les images extraites de l'archive sont stockées dans `images_pool/`
  (écrasées à chaque nouvel upload).
