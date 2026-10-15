# Space-Battle-SLG

Bataille navale spatiale pour 2 à 6 joueurs — Node.js, aucune dépendance.

    node server.js        # puis http://localhost:19500

- `/` accueil : créer un salon (maître) ou rejoindre avec un code
- `/maitre` crée directement un nouveau salon et ouvre sa page maître
- `/CODE` page maître · `/CODE/joueur1` … `/CODE/joueur6`
- Chaque salon = une partie indépendante
- Téléphones : même Wi-Fi, scanner les QR codes de la page maître

## Types de partie
- **Classique** : 2 joueurs, un duel.
- **Chacun pour soi** (3 à 6) : on choisit sur qui tirer (onglets). Option « tirer sur le joueur suivant » : la cible est imposée (joueur vivant suivant). Le dernier survivant gagne.
- **Équipes** (3 à 6, équipes A, B, C) : chaque joueur choisit son équipe depuis son écran (le maître peut aussi la fixer). Les équipes tirent à tour de rôle, un équipier à la fois ; **un joueur seul dans son équipe (au départ ou en cours de partie) tire donc après chaque tir adverse**. On ne peut pas viser un équipier ; une équipe gagne quand toutes les autres sont détruites.
- **Battle Royale** (3 à 6) : une carte commune dont la taille dépend du nombre de joueurs et de la taille de la flotte (3 joueurs, flotte standard : 15×15 ; 4 : 17×17 ; 5 : 20×20 ; 6 : 21×21). On peut poser ses vaisseaux sur ceux des autres (un tir peut toucher plusieurs propriétaires) ; ses propres cases sont non visables, **sauf en dernier recours** : quand il ne reste plus aucune autre case libre, on peut les viser (cela peut toucher un adversaire superposé, mais aussi son propre vaisseau). Si tous les derniers joueurs sont éliminés par le même tir, c'est une égalité.
Les options de tir (1 tir / consécutifs / salve de 3 à 5) s'appliquent à tous les types. Un joueur dont tous les vaisseaux sont coulés est éliminé et suit la bataille.

## Flotte : nombre de vaisseaux et « Armada perso »
- **Vaisseaux par joueur** : 5 à 8 (réglage du maître). Le maître coche exactement ce nombre de types parmi les 11 (maximum 40 cases au total, pour que tout tienne sans contact).
- **Armada perso** (option) : le maître ne choisit pas la flotte ; chaque joueur choisit lui-même ses types de vaisseaux (même nombre pour tous, mais des types qui peuvent différer), puis les place. Les IA tirent leur flotte au hasard. La composition de chacun est révélée à tous au début de la bataille ; les positions et les touchés partiels restent secrets.
- Les vaisseaux adverses ne sont jamais montrés avant d'être coulés : seul un vaisseau entièrement détruit apparaît (et il n'y a aucune marque de « touché » sur les pastilles de flotte).

## Adversaire IA (ai.js)
Sur la page maître, chaque siège peut être « Humain » ou « IA » (Débutant / Avancé / Expert). On peut même opposer deux IA.
- **Débutant** : tire presque au hasard (une fois sur trois il vise à côté d'un touché) — ≈ 95 tirs pour tout couler.
- **Avancé** : chasse en damier, puis poursuit et prolonge les alignements après un touché — ≈ 51 tirs.
- **Expert** : carte de probabilité sur toutes les positions encore possibles des vaisseaux restants, flotte jamais collée — ≈ 44 tirs.
L'IA ne voit que les informations publiques (tirs faits, vaisseaux coulés), accepte toujours la revanche, et fonctionne dans tous les types de partie (salve comprise). Avec plusieurs adversaires, l'IA choisit sa cible : au hasard (débutant), un adversaire déjà touché (avancé), celui qu'elle a commencé à détruire puis le plus affaibli (expert).
