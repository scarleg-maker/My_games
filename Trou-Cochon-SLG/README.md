# Trou-cochon-SLG

Jeu de société avec un dé (2 à 6 joueurs), en ligne ou sur un seul écran. Node.js, **aucune dépendance**.

    node server.js          # puis ouvrir http://localhost:19000/maitre

- `/maitre` : crée (ou reprend) ton salon et ouvre la page du maître du jeu → `/CODE/maitre`
- `/CODE/joueur1` … `/CODE/joueur6` : pages des joueurs (QR code / lien `/CODE/rejoindre` donné par le maître)
- `/` : accueil (créer ou rejoindre un salon, salons récents)

## Règles implémentées
- Dé de N faces (N = nombre de cases, 6 à 10). Trous 1 à N-1 sur le plateau ; le trou N (noir, cerclé de blanc, seul en bas) est le « dernier trou ».
- Premier joueur tiré au sort, puis ordre croissant des sièges. 1er tour : un lancer chacun ; ensuite jusqu'à 3 lancers de suite.
- Résultat k < N : trou libre → le joueur y pose un pion ; trou occupé → il récupère le pion qui s'y trouve (même le sien) et son tour s'arrête.
- Résultat N : le pion est définitivement perdu dans le dernier trou (le joueur peut continuer ses lancers).
- Un joueur sans pion en main est classé ; la partie s'arrête quand il n'en reste qu'un (le dernier). Podium des 3 premiers, rejouer possible.
- Mode compétition : le dernier est éliminé à chaque manche, jusqu'à la finale à 2.

Les noms/couleurs et réglages sont conservés par salon dans `sauvegarde.json` (« joueurs habituels »).
`npm test` simule 4 000 parties pour vérifier les règles. Variable `PORT` pour changer le port.

## Joueurs IA
Le maître du jeu peut activer/désactiver une IA sur n'importe quel siège (bouton « 🤖 » à la configuration, ou « 🤖 ON/OFF » dans la liste des joueurs en cours de partie). L'IA lance simplement le dé après une courte pause ; désactivée, le joueur reprend la main immédiatement.
