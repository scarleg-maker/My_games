# Space-Battle-SLG

Bataille navale spatiale pour 2 joueurs — Node.js, aucune dépendance.

    node server.js        # puis http://localhost:19500

- `/` accueil : créer un salon (maître) ou rejoindre avec un code
- `/maitre` crée directement un nouveau salon et ouvre sa page maître
- `/CODE` page maître · `/CODE/joueur1` · `/CODE/joueur2`
- Chaque salon = une partie indépendante
- Téléphones : même Wi-Fi, scanner les QR codes de la page maître

## Adversaire IA (ai.js)
Sur la page maître, chaque siège peut être « Humain » ou « IA » (Débutant / Avancé / Expert). On peut même opposer deux IA.
- **Débutant** : tire presque au hasard (une fois sur trois il vise à côté d'un touché) — ≈ 95 tirs pour tout couler.
- **Avancé** : chasse en damier, puis poursuit et prolonge les alignements après un touché — ≈ 51 tirs.
- **Expert** : carte de probabilité sur toutes les positions encore possibles des vaisseaux restants, flotte jamais collée — ≈ 44 tirs.
L'IA ne voit que les informations publiques (tirs faits, vaisseaux coulés), accepte toujours la revanche, et fonctionne dans les 3 modes (salve comprise).
