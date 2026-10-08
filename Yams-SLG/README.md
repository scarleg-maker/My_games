# Yams-SLG

Chaque salon = une partie séparée (code court, ex. K7QF). Aucune dépendance : Node.js suffit.

    node server.js        →  http://localhost:11200

## Utilisation
- **Accueil (/)** : « Créer un salon » (code aléatoire ou choisi) ou « Rejoindre » avec un code.
- **Arbitre (/CODE)** : choisit le mode (Jeu avec dés / Tableau de scores), la règle Points sup., le nombre de joueurs (1 à 8),
  inscrit les joueurs, lance la partie. QR code + lien d'invitation affichés.
- **Joueurs (/CODE/joueur1 … joueur8)** : chacun s'inscrit sur son téléphone et joue à son tour.
  L'arbitre peut aussi jouer pour tout le monde (un seul écran).
- Palmarès, joueurs habituels et parties en cours sont enregistrés par salon (fichier `sauvegarde.json`).
- Un salon sans aucune page ouverte depuis 6 h est libéré.

## Render
Créer un **Web Service** (et non un Static Site) : Build Command vide ou `npm install`, Start Command `node server.js`.
Le port est fourni par la variable PORT. Sur l'offre gratuite, le disque est éphémère : `sauvegarde.json` peut être perdu au redémarrage.
