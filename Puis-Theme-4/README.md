# Puis-thème 4

Puissance 4 de 2 à 6 joueurs, avec une page arbitre et une page par joueur.

## Lancer le jeu

Aucune installation de module : il suffit de Node.js (version 16 ou plus).

```
node server.js
```

- Page arbitre : http://localhost:14400/
- Pages joueurs : http://localhost:14400/joueur1 … /joueur6

Les autres appareils du même réseau (téléphones, tablettes) utilisent l'adresse IP affichée dans la console au démarrage, par exemple `http://192.168.1.20:14400/joueur2`.

## Déroulement

1. Sur la page arbitre, choisir le mode, le nombre de joueurs et, en mode Thématique, le fichier de thèmes.
2. Chaque joueur s'inscrit depuis sa page (nom + couleur parmi 10). L'arbitre peut aussi inscrire tout le monde lui-même.
3. L'arbitre lance la partie.

**Joueurs IA** : chaque siège peut passer en « 🤖 IA » (bouton Humain / IA). L'IA calcule plusieurs coups à l'avance : elle gagne quand elle le peut, bloque les alignements adverses, prépare ses menaces et évite d'offrir la victoire. En Renversé, elle décide seule de retourner une colonne (en tenant compte du hasard en mode Aléatoire). En Thématique, elle ne vise que des cases où une réponse existe, donne une bonne réponse environ 8 fois sur 10, et sa réponse est jugée automatiquement. Une partie peut se jouer entièrement entre IA.

**Un seul écran** (Classique et Renversé) : dans la configuration, choisir « Un seul écran ». Tout se joue sur la page principale, à tour de rôle ; les pages /joueurN ne servent plus qu'à suivre le plateau.

**Joueurs et noms** : sur la page arbitre, le nom tapé dans un siège s'enregistre tout seul (une couleur libre est choisie si besoin). « Retirer » libère un siège, « Vider tous les sièges » les libère tous. Au démarrage du serveur, les sièges sont vides ; les joueurs ayant déjà lancé une partie sont proposés en pastilles « Joueurs habituels » (un clic les replace, ✕ ou « Oublier tous les joueurs habituels » pour nettoyer la liste). Sur sa page, un joueur peut aussi « libérer ce siège » s'il y trouve un ancien nom.

Le plateau s'adapte à l'écran (téléphone, tablette, ordinateur, portrait ou paysage) et se recalcule quand on tourne l'appareil.

## Modes

- **Classique** : 2 joueurs, chacun son tour.
- **Renversé** : au début de son tour, le joueur peut retourner une colonne (ses pions s'inversent de haut en bas, animation de 2 s), puis il joue son pion. Si le renversement crée des alignements, le joueur actif gagne s'il en a un ; sinon c'est l'adversaire concerné.
  Option **Aléatoire** : la colonne choisie fait 3 tours rapides sur elle-même (1,6 s) et n'a qu'une chance sur deux de finir renversée.
- **Thématique** : chaque ligne et chaque colonne reçoit un thème tiré au sort. Le joueur choisit une colonne, son pion vise la case la plus basse libre, et il doit donner une réponse correspondant aux deux thèmes (à l'oral ou en la tapant). L'arbitre voit la liste des réponses possibles non encore citées, et valide ou refuse. Refus = le joueur passe son tour.

**En cas de mauvaise réponse** (réglage dans la configuration) :
- *L'adversaire prend la case* (par défaut) : à 2 joueurs, l'adversaire y pose son pion puis joue son tour normalement ; à 3 joueurs ou plus, le joueur passe simplement son tour.
- *Le suivant peut voler la case* : le joueur suivant peut répondre pour la même case. S'il a juste, son pion y est posé. Qu'il réussisse, se trompe ou renonce au vol, il joue ensuite son tour normalement.
- *Passe son tour* : la case reste libre.

**Exclure des réponses** : dans la liste des réponses possibles, le ✕ à côté d'un nom l'exclut pour le reste de la partie (sans poser de pion). « Refuser et exclure » fait de même avec la réponse proposée. Le panneau « Réponses exclues » permet de chercher et d'exclure n'importe quelle réponse de la thématique (ou un nom hors liste) ; un clic sur une réponse exclue la rend de nouveau disponible. Les exclusions sont remises à zéro à chaque nouvelle manche.

## Fichiers de thématique (dossier `thematiques/`)

Tout fichier `.json` déposé dans ce dossier apparaît comme une carte dans la configuration. Les fichiers `pokemon.json`, `dragonball.json` et `onepiece.json` sont lus tels quels, sans conversion :

- `lists` : les listes de thèmes (avec `emoji`, affiché sur le plateau).
- `slots` : les deux listes tirées. La 1re donne les lignes, la 2e les colonnes (ou l'inverse si cela donne une meilleure grille).
- `answerMode: "slots"` : la réponse doit contenir le thème de la ligne dans son 1er champ et celui de la colonne dans le 2e (champ nommé comme l'`id` du slot, comme la liste, ou `tags`).
- `answerMode: "set"` : les thèmes de la réponse doivent être exactement ceux de la case. Une ligne et une colonne peuvent avoir le même thème : Feu × Feu = Pokémon de type Feu pur.
- `info` : affiché en info-bulle sur les réponses dans le panneau d'arbitrage.

Si une liste est plus courte que nécessaire (5 factions pour 6 lignes), un thème est répété. Le tirage cherche la grille où le plus de cases ont au moins une réponse.

**Cases sans réponse possible** : au choix dans la configuration, soit « Pion libre » (case marquée ✦, le pion se pose sans question), soit la réponse reste obligatoire et l'arbitre peut accepter une réponse hors liste.

Des formats plus simples restent acceptés :

```json
{ "titre": "Pays", "lignes": { "Europe": ["France"] }, "colonnes": { "Commence par F": ["France"] } }
{ "titre": "…", "themes": { "Eau": ["Carapuce"], "Combat": ["Tartard"] } }
{ "titre": "…", "reponses": [ ["Tartard", "Eau", "Combat"] ] }
```

La comparaison des réponses ignore les majuscules, les accents et la ponctuation (« TARTARD » = « Tartard »).
