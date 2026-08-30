# Enigma-Lien — serveur solo & tournois

Petit serveur Node.js qui héberge le jeu d'énigmes "Enigma-Lien" (réarranger
6 personnages pour satisfaire 5 liens) en solo ou en tournoi multijoueur
(jusqu'à 10 joueurs), avec un système de thèmes éditable (Pokémon fourni,
Dragon Ball en exemple, et d'autres thèmes possibles).

## 1. Installation et lancement

Prérequis : [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
cd enigma-lien-server
npm install
npm start
```

**Sous Windows**, tu peux à la place double-cliquer sur `Lancer_Enigmalien.bat` :
il installe les dépendances au premier lancement si besoin, démarre le
serveur et ouvre automatiquement le menu principal dans ton navigateur.
Laisse sa fenêtre ouverte pendant la partie ; la fermer arrête le serveur.

Le serveur écoute par défaut sur le port **9500**. Pour changer de port :
`PORT=8080 npm start` (si tu changes le port, adapte aussi le `9500` dans
`Lancer_Enigmalien.bat`).

Au démarrage, le terminal affiche les adresses utiles :

- **Menu principal** : http://localhost:9500/
- **Écran maître** (pour piloter un tournoi) : http://localhost:9500/maitre.html
- **Pages joueurs** : http://localhost:9500/joueur1.html … /joueur10.html

## 2. Jouer en solo

Va sur http://localhost:9500/solo.html, entre ton nom, choisis un thème et
le nombre de vies/essais par énigme, puis lance une énigme. À la fin de
chaque partie (victoire ou défaite), le résultat est enregistré
automatiquement. Le classement cumulé (parties, victoires, défaites, ratio,
meilleure série) est visible sur http://localhost:9500/classement.html.

Ces statistiques sont stockées dans `data/players.json` (agrégées par
joueur) et `data/solo_history.json` (historique détaillé de chaque partie).

## 3. Jouer en tournoi (multijoueur, jusqu'à 10 joueurs)

1. Sur la machine qui héberge la partie, ouvre **l'écran maître** :
   http://localhost:9500/maitre.html — c'est l'écran à projeter/partager,
   qui sert à configurer et piloter le tournoi.
2. Chaque joueur ouvre, **depuis son propre appareil** (téléphone,
   ordinateur…) connecté au **même réseau local**, l'URL de son
   emplacement : `http://<adresse-IP-du-serveur>:9500/joueur1.html`,
   `joueur2.html`, etc. (jusqu'à `joueur10.html`). Il choisit un pseudo et
   rejoint. Sur la machine qui héberge le serveur, retrouve ton adresse IP
   locale avec `ipconfig` (Windows) ou `ifconfig` / `ip a` (Mac/Linux) —
   généralement une adresse du type `192.168.x.x`.
   - Si les autres appareils n'arrivent pas à se connecter, vérifie le
     pare-feu de la machine hôte (autoriser Node.js / le port 9500 sur le
     réseau local).
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
peut se reconnecter (même URL) pour les manches suivantes.

L'historique des tournois terminés est enregistré dans
`data/tournaments_history.json`.

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

Un thème d'exemple est déjà fourni : `data/dragonball/dragonballex.json`
(une vingtaine de personnages/formes) avec les critères ARC (=),
PUISSANCE (numérique), FORME (numérique) et COULEUR (=).

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
  server.js                    Serveur Express + Socket.IO (API solo + tournois)
  Lancer_Enigmalien.bat         Lanceur Windows (installe si besoin, démarre, ouvre le navigateur)
  lib/
    puzzleEngine.js            Génération/validation des énigmes (générique, indépendant du thème)
    tournament.js               Machine à états d'un tournoi (Sprinteur / Survie)
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
    index.html                   Menu principal
    solo.html                    Mode solo
    maitre.html                  Écran maître (config + pilotage de tournoi)
    joueur.html                  Page joueur (routée sur /joueur1.html … /joueur10.html)
    classement.html               Classement solo
    css/style.css                  Style partagé (thème visuel d'origine conservé)
    js/common.js                   Rendu du plateau/liens partagé entre solo et joueur
    images/pokemon/, images/dragonball/   Dossiers d'images (voir §5)
  scripts/
    extract_from_original.js     Script ayant servi à générer pokedex.json/bat.json depuis le fichier d'origine
    test_tournament_logic.js     Vérifications automatiques de la logique de tournoi (Sprint/Survie)
    test_full.js                  Vérification bout-en-bout (solo + tournois via API/Socket.IO)
```

Pour relancer les vérifications automatiques après une modification :

```bash
node scripts/test_tournament_logic.js
node scripts/test_full.js
```

## 8. Limites connues / pistes d'amélioration

- Le serveur héberge **un seul tournoi à la fois** (pas de salons multiples
  en parallèle) — adapté à un usage "entre amis, chez soi".
- Pensé pour un réseau local (`http://<IP locale>:9500`). Pour un accès
  depuis Internet, il faudrait toi-même mettre en place un hébergement /
  redirection de port (non couvert ici).
- Le thème Dragon Ball n'est qu'un exemple illustratif (une vingtaine
  d'entrées, valeurs de "puissance" non canoniques) — à toi de l'enrichir
  via `data/dragonball/dragonballex.json`.
