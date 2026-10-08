# Monopoly-SLG

Jeu de Monopoly multijoueur en salons (2 à 8 joueurs, humains ou IA) — Node.js, Express, Socket.io.

## Lancer
- **Windows** : double-cliquer sur `Lancer_Monopoly-SLG.bat` (installe les dépendances au premier lancement, démarre le serveur et ouvre le navigateur).
- **Autres** : `npm install` puis `npm start`, puis ouvrir http://localhost:11000

## Jouer
1. Sur l'accueil, **Créer un salon** : un code (et un QR code) est généré. Chaque salon est une partie indépendante.
2. Les joueurs scannent le QR code (ou tapent le code), choisissent leur **siège**, leur **nom**, leur **pion** (chien, bateau, canon, voiture, chapeau, fer à repasser, dé à coudre, brouette) et leur **couleur**.
3. L'hôte choisit le plateau, le nombre de joueurs, les sièges IA, puis démarre la partie.
4. Les pions avancent case par case (0,25 s par case) sur le plateau, identique et synchronisé chez tous les joueurs.
5. **Échanges** : à tout moment (même hors de son tour), le bouton « 🤝 Proposer un échange » permet d'échanger propriétés, argent et cartes « sortie de prison ». Le destinataire accepte ou refuse ; une IA accepte si elle y gagne au moins 15 %. Les groupes de couleur déjà construits ne sont pas échangeables.

## Règles réglables par l'hôte
- **Argent de départ** (100 à 50 000 M€, 1500 par défaut).
- **Doubler la case Départ** : 400 M€ au lieu de 200 quand un pion s'arrête dessus.
- **Parc gratuit** : cagnotte de toutes les sommes payées à la banque à cause des cartes (Chance et Caisse de Communauté), récupérée par le joueur qui s'arrête sur le Parc.

Pages : `/` accueil · `/CODE` hôte · `/CODE/joueurN` joueur · `/CODE/plateau` spectateur.

## Plateaux
Les plateaux sont des fichiers JSON dans `public/boards/` (voir `public/boards/README.md`).
