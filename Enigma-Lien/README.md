# Enigma-Lien — serveur solo & tournois

Petit serveur Node.js qui héberge le jeu d'énigmes "Enigma-Lien" (réarranger
6 personnages pour satisfaire 5 liens) en solo ou en tournoi multijoueur
en **salons** (jusqu'à 10 joueurs par salon, plusieurs salons en parallèle,
QR code pour inviter les joueurs), avec un système de thèmes éditable (Pokémon fourni,
Dragon Ball en exemple, et d'autres thèmes possibles).

Sur le plateau, seuls **l'image et le nom** de chaque personnage sont
visibles — aucune information de type ou de critère n'est affichée sur les
cartes, quel que soit le thème ; c'est justement ce qu'il faut deviner grâce
aux liens affichés sous le plateau. Pour réordonner les cartes, deux
méthodes équivalentes et cumulables : les boutons ◀ ▶ (échange avec la carte
voisine), ou le **glisser-déposer** — glisse une carte sur une autre pour
échanger directement leurs deux positions (ex : déposer la carte en
position 4 sur celle en position 2 les échange, les 4 autres cartes ne
bougent pas). Fonctionne à la souris comme au doigt (écran tactile).

## 1. Installation et lancement

Prérequis : [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
cd enigma-lien-server
npm install
npm start
```

**Sous Windows**, tu peux à la place double-cliquer sur `Lancer_Enigmalien.bat` :
il installe les dépendances au premier lancement si besoin (seulement `express` et `socket.io` ; le générateur de QR code est embarqué dans `lib/vendor/`, rien d'autre à télécharger), démarre le
serveur et ouvre automatiquement le menu principal dans ton navigateur.
Il relance `npm install` à chaque démarrage (rapide quand tout est à jour), ce qui installe automatiquement les modules ajoutés par une mise à jour du jeu. Laisse sa fenêtre ouverte pendant la partie ; la fermer arrête le serveur.

Le serveur écoute par défaut sur le port **8500**. Pour changer de port :
`PORT=8080 npm start` (si tu changes le port, adapte aussi le `8500` dans
`Lancer_Enigmalien.bat`).

Au démarrage, le terminal affiche les adresses utiles :

- **Menu principal** (créer / rejoindre un salon, solo, classement) : http://localhost:8500/
- **Depuis le réseau local** : l'adresse `http://192.168.x.x:8500/` de ta machine
  (c'est elle qui est encodée dans le QR code des salons — voir §3).

Pour héberger le jeu sur Internet (Render), voir §9.

## 2. Jouer en solo

Va sur http://localhost:8500/solo.html, entre ton nom, choisis un thème et
le nombre de vies/essais par énigme, puis lance une énigme. À la fin de
chaque partie (victoire ou défaite), le résultat est enregistré
automatiquement. Le classement cumulé (parties, victoires, défaites, ratio,
meilleure série) est visible sur http://localhost:8500/classement.html.

Ces statistiques sont stockées dans `data/players.json` (agrégées par
joueur) et `data/solo_history.json` (historique détaillé de chaque partie).

## 3. Jouer en tournoi : les salons

Chaque groupe de joueurs joue dans son propre **salon**, identifié par un
**code court** (ex. `K7QF`). Autant de salons que nécessaire peuvent tourner
en même temps sur le même serveur, sans se gêner : chacun a son thème, son
type de tournoi, ses joueurs (10 places) et ses scores.

1. Sur le **menu principal**, le maître du jeu clique sur **Créer un salon**
   (ou choisit son propre code, ex. `FAMILLE`, via « Choisir mon propre
   code »). Il arrive sur l'**écran maître** du salon : `/K7QF`.
2. Les joueurs rejoignent le salon, au choix :
   - en **scannant le QR code** affiché sur l'écran maître ;
   - en ouvrant le lien `/K7QF/rejoindre` (bouton *Copier le lien*) ;
   - en tapant le code sur le menu principal (*Rejoindre un salon*).

   Un clic sur **Rejoindre ce salon** attribue automatiquement la première
   place libre (deux joueurs qui scannent en même temps reçoivent des places
   différentes) et ouvre sa page `/K7QF/joueurN`. Il choisit un pseudo et
   attend. Un joueur déjà inscrit retrouve sa place dans la liste « Tu étais
   déjà inscrit ? » (ou en rouvrant son lien `/K7QF/joueurN`).
3. Sur l'écran maître, choisis le **thème**, le **type de tournoi**, et les
   paramètres, puis clique sur *Enregistrer la configuration*.
   - **🏃 Sprinteur** : le premier joueur à résoudre correctement **x**
     énigmes remporte le tournoi. Chaque manche est partagée par tous les
     joueurs connectés : premier arrivé, premier servi ; la manche suivante
     démarre automatiquement quelques secondes après.
   - **💀 Survie** : à chaque manche, tous les joueurs actifs affrontent la
     même énigme avec **y** vies. Qui échoue est éliminé. Le tournoi
     continue, sans limite de manches, jusqu'à ce qu'il ne reste qu'un
     joueur en vie (ou une égalité si plusieurs sont éliminés à la même
     manche) — c'est lui/eux le/les vainqueur(s).
4. Une fois les joueurs inscrits visibles dans le tableau, clique sur
   **▶️ Démarrer le tournoi**. Tu peux à tout moment cliquer sur
   **⏹️ Terminer le tournoi** pour l'arrêter manuellement (le classement
   au moment de l'arrêt détermine le(s) vainqueur(s)).
5. À la fin, **↺ Nouveau tournoi** relance une configuration avec les mêmes
   joueurs inscrits (sans qu'ils aient à rouvrir leur page).

Un joueur qui rejoint après le début d'un tournoi devient spectateur
jusqu'au tournoi suivant. Une déconnexion en cours de manche fait sortir
proprement le joueur de la manche (pour ne pas bloquer les autres) ; il
peut se reconnecter (même lien) pour les manches suivantes. Recharger la
page ne le déconnecte pas.

**Le QR code et le réseau local.** Le QR code contient l'adresse que les
téléphones doivent utiliser : sur Render, l'adresse publique du service ; en
local, l'adresse IP de ta machine sur le réseau (pas `localhost`, qui n'est
pas joignable depuis un téléphone). Les appareils doivent être sur le même
réseau Wi-Fi. Si l'un n'arrive pas à se connecter, vérifie le pare-feu de la
machine hôte (autoriser Node.js / le port 8500). Le QR code est généré par le
serveur lui-même : il fonctionne aussi sans accès à Internet.

**Durée de vie des salons.** Les salons vivent en mémoire. Un salon sans
aucune page ouverte pendant 6 heures est supprimé (200 salons maximum en
même temps). Si le serveur redémarre (ou se met en veille sur un hébergeur
gratuit), les salons en cours disparaissent : l'écran maître propose alors
**Recréer le salon avec le même code**, et les pages des joueurs se
reconnectent toutes seules. Le menu principal garde la liste des salons
récents ouverts sur l'appareil.

L'historique des tournois terminés (avec le code du salon) est enregistré
dans `data/tournaments_history.json` ; les statistiques du mode solo restent
globales au serveur.

Les anciennes adresses fixes (`/maitre.html`, `/joueur1.html`…) redirigent
vers le menu principal.

## 4. Éditer les personnages — fichiers "Pokedex"

Les données de chaque thème sont de simples fichiers JSON, éditables à la
main dans n'importe quel éditeur de texte.

### `data/pokemon/pokedex.json`

Un objet par Pokémon :

```json
{
  "name": "Bulbizarre",
  "types": ["Plante", "Poison"],
  "gen": 1,
  "stage": 1,
  "color": "Vert",
  "image": "Bulbizarre.png"
}
```

- `types` : tableau d'1 ou 2 types (sert au critère TYPE et au critère BAT).
- `gen` : numéro de génération (1 à 9) — critère GÉN (`<`, `=`, `>`).
- `stage` : stade d'évolution (1 = pas encore évolué, 2, 3...) — critère
  STADE (`<`, `=`, `>`).
- `color` : couleur dominante — critère COULEUR (`=`).
- `image` : nom du fichier image attendu dans `public/images/pokemon/`
  (voir §5). Optionnel : sans image, un médaillon avec les initiales du nom
  s'affiche automatiquement.

Le fichier fourni contient 478 Pokémon (conversion fidèle du générateur
d'origine, générations 1 à 9). Tu peux ajouter, modifier ou supprimer des
entrées librement ; redémarre juste le serveur pour prendre en compte les
changements de `themes.json`, mais **les fichiers de données Pokedex/Bat
sont relus à chaque nouvelle énigme, pas besoin de redémarrer**.

### `data/pokemon/bat.json` — critère "Bataille"

Table séparée : pour chaque type, la liste des types qu'il **bat** (x2
dégâts). Exemple :

```json
{
  "Feu": ["Plante", "Glace", "Insecte", "Acier"],
  "Eau": ["Feu", "Sol", "Roche"]
}
```

Le lien BAT (`>`) entre deux personnages A et B est vrai si au moins un
type de A bat au moins un type de B.

## 5. Ajouter les images

Dépose les images dans `public/images/<dossier-du-thème>/` (ex :
`public/images/pokemon/`), avec un nom de fichier **identique** au champ
`image` de l'entrée correspondante (ex : `Bulbizarre.png`). Formats
courants acceptés (png, jpg, jpeg, webp, gif) — adapte juste l'extension
dans le JSON si besoin.

Aucune image n'est obligatoire : les personnages sans image affichent un
médaillon coloré avec leurs initiales. Les images sont simplement
redimensionnées en miniature à l'affichage (CSS), sans traitement côté
serveur.

## 6. Ajouter un nouveau thème (ex : Dragon Ball / "DragonBallEx")

Un thème d'exemple est fourni et déjà enrichi : `data/dragonball/dragonballex.json`
(96 personnages/formes) avec les critères ARC (numérique), PUISSANCE
(numérique), FORME (numérique), RACE (=) et AGE (numérique).

Légende des codes utilisés dans `dragonballex.json` :

- `arc` : 1ère apparition du personnage — 0 = Passé, 1 = Arc Enfant,
  2 = Piccolo Daimao + Tournois, 3 = Arc Saiyan, 4 = Arc Namek,
  5 = Arc Cyborg + Cell, 6 = Arc Boo, 7 = Arcs GT.
- `power` : puissance du personnage, de 1 à 10.
- `form` : niveau de transformation du personnage, de 1 à 4.
- `race` : race du personnage (texte libre, comparé par égalité).
- `age` : 1 = enfant, 2 = ado, 3 = adulte, 4 = ancien/indéterminé.

Cette légende est recopiée en premier dans `dragonballex.json` lui-même,
sous forme de vrais commentaires, pour l'avoir sous les yeux en ajoutant
des personnages :

```json
[
// arc   : 1ere apparition du personnage, 0: Passé, 1: Arc Enfant, ...
// power : Puissance du personnage de 1 à 10
// form  : Niveau de transformation du personnage de 1 à 4
// race  : Race du personnage
// age   : 1: enfant, 2: ado, 3: adulte, 4: ancien/indetermine
{ "name": "Goku (Enfant)", "image": "Goku.png", "age": 1, "arc": 2, "form": 1, "power": 1, "race": "Saiyan" },
...
```

Le JSON standard n'admet pas les commentaires, mais tous les fichiers de
`data/` (y compris `themes.json`) sont lus par un petit analyseur tolérant
(`lib/jsonc.js`) qui accepte :

- les commentaires `// comme ceci` jusqu'à la fin de la ligne ;
- les commentaires `/* comme ceci, sur plusieurs lignes */` ;
- une virgule en trop juste avant une accolade ou un crochet fermant
  (`{ ... },  }` ou `{ ... },  ]`).

Tout le reste doit rester du JSON strict (guillemets doubles autour des
clés et des textes, virgule entre chaque élément). Ces trois tolérances
suffisent à couvrir les deux erreurs qui avaient cassé le choix de thème
(une virgule manquante dans `themes.json`, une virgule en trop dans
`dragonballex.json`) — mais une erreur plus grave (accolade non fermée,
guillemet oublié...) reste possible. Après toute modification manuelle,
tu peux vérifier qu'un fichier reste valide avec :

```
node -e "console.log(require('./lib/jsonc').parseLenientJSON(require('fs').readFileSync('data/dragonball/dragonballex.json','utf8')).length)"
```

Si la commande affiche un nombre (le nombre de personnages) sans erreur,
le fichier est valide. Rappel : une erreur dans `data/themes.json` ou dans
le fichier de données d'UN thème empêche ce thème-là de se charger ;
mais une erreur dans `data/themes.json` lui-même empêche TOUS les thèmes
de se charger, puisque c'est la liste qui les référence tous.

Pour créer ton propre thème :

1. Crée `data/<mon-theme>/<mon-fichier>.json` : un tableau d'objets, chacun
   avec les champs que tu veux utiliser dans tes critères (par exemple
   `name`, `arc`, `power`, `form`, `color`, `image`).
2. (Optionnel) Crée `data/<mon-theme>/bat.json` si tu veux un critère de
   type "bataille" (table `valeur -> [valeurs qu'elle bat]`).
3. Crée le dossier `public/images/<mon-theme>/` pour les images.
4. Ajoute une entrée dans `data/themes.json` :

```json
{
  "id": "montheme",
  "name": "Mon thème",
  "icon": "🎲",
  "dataFile": "montheme/monfichier.json",
  "battleFile": "montheme/bat.json",
  "imageFolder": "montheme",
  "charCount": 6,
  "criteria": [
    { "id": "ID_UNIQUE", "label": "LIBELLÉ", "icon": "🔣", "kind": "...", "field": "..." }
  ]
}
```

Chaque critère a un `kind` :

- `numeric` : compare deux nombres (`<`, `=`, `>`) — ex. génération,
  puissance, stade.
- `equality` : égalité stricte d'un champ texte (`=`) — ex. couleur, arc.
- `shared-array` : vrai si les deux personnages partagent au moins une
  valeur dans un champ tableau (`=`) — ex. types.
- `battle` : vrai si une valeur du champ de A "bat" une valeur du champ de
  B selon `battleFile` (`>`) — ex. types + table d'efficacité.

Un thème a besoin d'assez d'entrées et de diversité pour que le moteur
trouve facilement des énigmes valides à 6 personnages (5 liens en chaîne) —
une vingtaine d'entrées variées est un minimum raisonnable ; plus il y en a,
plus les énigmes seront variées. Aucun redémarrage nécessaire : les
fichiers de `data/` sont relus à chaque nouvelle énigme générée (seul
`data/themes.json` — la liste des thèmes elle-même — nécessite un
redémarrage si tu en ajoutes un nouveau).

## 7. Structure du projet

```
enigma-lien-server/
  server.js                    Serveur Express + Socket.IO (API solo, salons, tournois, QR code)
  render.yaml                  Déploiement Render (voir §9)
  Lancer_Enigmalien.bat         Lanceur Windows (installe si besoin, démarre, ouvre le navigateur)
  lib/
    puzzleEngine.js            Génération/validation des énigmes (générique, indépendant du thème)
    tournament.js               Machine à états d'un tournoi (Sprinteur / Survie)
    rooms.js                    Registre des salons (codes, places, purge des salons inactifs)
    jsonc.js                    Lecteur JSON tolérant (commentaires // et virgules en trop)
    vendor/qrcode-generator.js  Générateur de QR code embarqué (MIT, voir LICENSE-qrcode-generator.txt)
    themeStore.js               Chargement des thèmes et de leurs données
    playerStats.js               Statistiques solo (classement, historique)
  data/
    themes.json                  Liste des thèmes disponibles
    players.json                  Statistiques solo agrégées par joueur
    solo_history.json             Historique détaillé des parties solo
    tournaments_history.json      Historique des tournois terminés
    pokemon/
      pokedex.json                 478 Pokémon (généré depuis le fichier d'origine)
      bat.json                     Table d'efficacité des types
    dragonball/
      dragonballex.json            Exemple de thème "Dragon Ball" (à enrichir)
      bat.json                     Réservé pour un futur critère "bataille" (vide)
  public/                       Pages et assets servis par le serveur
    index.html                   Menu principal (créer / rejoindre un salon) — aussi servi sur /CODE/rejoindre
    solo.html                    Mode solo
    salon-maitre.html            Écran maître d'un salon (QR code, config, pilotage) — servi sur /CODE
    salon-joueur.html            Page joueur d'un salon — servie sur /CODE/joueur1 … /CODE/joueur10
    classement.html               Classement solo
    css/style.css                  Style partagé (thème visuel d'origine conservé)
    js/common.js                   Rendu du plateau/liens partagé entre solo et joueur
    images/pokemon/, images/dragonball/   Dossiers d'images (voir §5)
  scripts/
    extract_from_original.js     Script ayant servi à générer pokedex.json/bat.json depuis le fichier d'origine
    test_tournament_logic.js     Vérifications automatiques de la logique de tournoi (Sprint/Survie)
    test_rooms_logic.js          Vérifications du registre de salons (codes, places, purge)
    test_full.js                  Vérification bout-en-bout (solo + tournois + salons simultanés, via API/Socket.IO)
```

Pour relancer les vérifications automatiques après une modification :

```bash
npm test
```

(équivalent à lancer `node scripts/test_tournament_logic.js`,
`node scripts/test_rooms_logic.js` puis `node scripts/test_full.js` ; ce
dernier prend environ une minute.)

## 8. Limites connues / pistes d'amélioration

- Les salons sont en mémoire : ils disparaissent au redémarrage du serveur
  (voir « Durée de vie des salons » au §3).
- Le thème Dragon Ball est un exemple illustratif (valeurs de "puissance"
  non canoniques) — à toi de l'enrichir via `data/dragonball/dragonballex.json`.
- Pas d'authentification : toute personne connaissant le code d'un salon peut
  le rejoindre, et l'écran maître d'un salon est accessible à qui connaît son
  adresse `/CODE`. Choisis un code peu devinable pour un salon public.

## 9. Héberger le jeu sur Render

Le serveur lit le port dans la variable `PORT` fournie par Render et
utilise l'adresse publique du service (`RENDER_EXTERNAL_URL`) pour le QR code.

1. Mets le dossier du projet dans un dépôt Git (GitHub / GitLab). Le fichier
   `.gitignore` exclut déjà `node_modules`.
2. Sur https://render.com : **New + → Blueprint**, choisis le dépôt — le
   fichier `render.yaml` crée le service web. (Ou **New + → Web Service**
   à la main : *Runtime* Node, *Build Command* `npm install`, *Start Command*
   `npm start`, *Health Check Path* `/healthz`.)
3. Une fois déployé, ouvre l'adresse `https://<ton-service>.onrender.com/`,
   crée un salon et fais scanner le QR code.

À savoir sur l'offre gratuite de Render :

- le service **se met en veille** après ~15 minutes sans requête et met une
  trentaine de secondes à se réveiller ; les salons en mémoire sont alors
  perdus (voir « Durée de vie des salons », §3) — réveille le service avant
  la partie en ouvrant l'adresse quelques instants avant ;
- le **disque est éphémère** : `data/players.json`, `solo_history.json` et
  `tournaments_history.json` (classement solo, historiques) sont remis à zéro
  à chaque redéploiement/redémarrage. Pour les conserver il faut un disque
  persistant (offre payante) monté sur `data/` ;
- pour une autre adresse publique (domaine perso, autre hébergeur), définis
  la variable d'environnement `PUBLIC_URL` (ex. `https://jeu.exemple.fr`).
