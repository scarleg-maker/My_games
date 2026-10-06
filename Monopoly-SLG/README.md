# Monopoly-SLG

Jeu de Monopoly multijoueur en salons (2 à 8 joueurs, humains ou IA) — Node.js, Express, Socket.io.

## Lancer
- **Windows** : double-cliquer sur `Lancer_Monopoly-SLG.bat` (installe les dépendances au premier lancement, démarre le serveur et ouvre le navigateur).
- **Autres** : `npm install` puis `npm start`, puis ouvrir http://localhost:11000

## Jouer
1. Sur l'accueil, **Créer un salon** : un code (et un QR code) est généré. Chaque salon est une partie indépendante.
2. Les joueurs scannent le QR code (ou tapent le code), choisissent leur **siège**, leur **nom**, leur **pion** (chien, bateau, canon, voiture, chapeau, fer à repasser, dé à coudre, brouette) et leur **couleur**.
3. L'hôte choisit le plateau, le nombre de joueurs, les sièges IA, puis démarre la partie.
4. Les pions avancent case par case (2 cases par seconde) sur le plateau, identique et synchronisé chez tous les joueurs.

Pages : `/` accueil · `/CODE` hôte · `/CODE/joueurN` joueur · `/CODE/plateau` spectateur.

## Plateaux
Les plateaux sont des fichiers JSON dans `public/boards/` (voir `public/boards/README.md`).
