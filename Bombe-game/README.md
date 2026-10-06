# 💣 Jeu de la Bombe — multi-salons

## Lancement

Double-cliquer sur `Lancer_BombeGame.bat` (Windows), ou :

```bash
npm install
npm start
```

Le serveur démarre sur **http://localhost:8000** (changer de port : variable d'environnement `PORT`).

## Les salons

Chaque salon est une **partie indépendante** (joueurs, images, plateau, réglages) : plusieurs groupes peuvent jouer en même temps sur le même serveur.

| Adresse                 | Rôle                                                        |
|-------------------------|-------------------------------------------------------------|
| `/`                     | Accueil : créer un salon, rejoindre avec un code            |
| `/CODE`                 | Page de l'arbitre du salon                                  |
| `/CODE/rejoindre`       | Choix du siège (cible du QR code)                           |
| `/CODE/joueur1` … `8`   | Page d'un joueur                                            |

1. **Créer un salon** depuis l'accueil (code aléatoire de 4 caractères, ou code personnalisé de 3 à 10 lettres/chiffres).
2. Sur la page de l'arbitre, un **QR code**, le code et un lien sont affichés. Les joueurs scannent le QR code (même Wi-Fi), ou tapent le code sur l'accueil, puis touchent leur siège.
3. L'arbitre règle la partie (joueurs, archive ZIP d'images, nombre d'images, cartes, bombes, règles Intouchable / Multi-boom) et la lance.

Chaque salon mémorise ses propres **noms de joueurs, réglages et images** (fichier `data/salons.json`, dossier `images_pool/<CODE>/`) : en réutilisant le même code, on retrouve tout. Les 100 salons les plus récents sont conservés ; un salon sans aucun écran ouvert depuis 6 h est libéré de la mémoire (sa partie en cours est perdue, ses réglages et images restent).

## Règles

- Chacun pose ses bombes en secret (l'arbitre voit tout, en couleur), puis on tire à tour de rôle.
- Image piégée : elle est perdue, ainsi que la dernière image sûre du joueur.
- **Multi-boom** : une image à N bombes (N ≥ 2) fait perdre N images ; à 0 image restante, le joueur est éliminé.
- **Intouchable** : le premier à compléter son équipe gagne toute la partie.
- Fin de manche : l'arbitre élimine les équipes de son choix et relance une manche avec les mêmes images, jusqu'au vainqueur.

## Notes techniques

- Temps réel via Socket.IO ; le QR code est généré par le serveur (fonctionne sans Internet).
- Un joueur ne peut agir que pour son propre siège ; les actions d'arbitrage sont réservées à la page arbitre.
