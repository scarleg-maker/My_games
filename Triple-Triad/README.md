# Triple Triad (style FF8) — Node.js

Jeu de Triple Triad avec :
- Un onglet **"Comment jouer ?"** dans l'interface, résumant le déroulement d'une partie, les règles,
  les conditions de victoire et les cartes légendaires — accessible sans connexion.
- **Mode Solo** contre l'IA (6 paliers d'adversaires), avec sauvegarde `.txt` par joueur (collection de cartes, stats).
- **Mode Duel (PvP)** en ligne entre deux joueurs via Socket.io (salons avec code à 5 caractères).
- Règles configurables avant chaque duel : **Identique (Same)**, **Plus**, **Mort subite**, et règle de mise
  (**One / Direct / Diff / All / None**).

## Installation

```bash
npm install
npm start
```

Le serveur écoute sur `http://localhost:5550`. Un autre joueur sur le même réseau peut se connecter via
`http://<votre-ip-locale>:5550`. Pour jouer entre deux joueurs sur Internet, il faut héberger le serveur
quelque part (VPS, service cloud, etc.) et ouvrir/rediriger le port 5550.

## Mode Solo

1. Onglet "Mode Solo" → entrez votre nom.
2. Si c'est votre première partie, une sauvegarde est créée automatiquement dans `saves/<votre_nom>.txt`
   avec un deck de départ défini dans `data/starterDeck_ffviii.json` (5 cartes).
3. Choisissez un palier (1 = facile → 6 = légende), un adversaire, les règles, la règle de mise, puis vos 5 cartes.
4. À la fin du duel, si vous gagnez, les cartes remportées (selon la règle de mise) sont ajoutées à votre
   fichier `.txt`. Si vous perdez, l'IA peut vous prendre des cartes de la même façon.

Le fichier de sauvegarde est un simple `.txt` contenant du JSON lisible :

```json
{
  "name": "Squall",
  "collection": ["geezard", "funguar", "..."],
  "stats": { "wins": 3, "losses": 1, "draws": 0 },
  "lastDeck": ["geezard", "funguar", "bite_bug", "red_bat", "blobra"]
}
```

Vous pouvez l'éditer à la main si besoin (ajouter/retirer des `cardId`).

## Mode Duel (PvP)

1. Onglet "Mode Duel (PvP)" → entrez votre nom, choisissez règles + règle de mise + vos 5 cartes.
2. Joueur 1 clique "Créer un salon" → obtient un code à partager.
3. Joueur 2 entre ce code et clique "Rejoindre".
4. La partie démarre automatiquement dès que les deux joueurs sont connectés.

*(Le PvP n'affecte pas les sauvegardes `.txt` — il sert uniquement à s'affronter. Si vous voulez que les
victoires en PvP alimentent aussi la collection du gagnant, voir la section "Aller plus loin" ci-dessous.)*

## Régler le nombre et les cartes de départ (première partie)

Fichier : **`data/starterDeck_ffviii.json`**. C'est un simple tableau de `cardId` (identifiants de `cards_ffviii.json`) :

```json
["geezard", "funguar", "bite_bug", "red_bat", "blobra"]
```

Ce tableau ne s'applique qu'aux nouveaux joueurs (pas de fichier `saves/<nom>.txt` existant). Vous pouvez
mettre **autant de cartes que vous voulez** dedans (5, 10, 20...) — c'est la collection de départ complète.
Chaque duel demandera toujours de choisir exactement 5 cartes parmi cette collection (règle fixe du Triple
Triad), mais rien n'empêche d'en posséder plus dès le début.

## Mettre une image sur les cartes et changer leur nom

1. Placez vos images dans **`public/images/cards/`** (formats jpg/png/webp, peu importe la taille — elles
   sont recadrées automatiquement en carré).
2. Dans **`data/cards_ffviii.json`**, ajoutez un champ `"image"` à la carte concernée, avec le chemin relatif à
   `public/` :

```json
{ "id": "geezard", "name": "Geezard", "level": 1, "top": 1, "right": 4, "bottom": 4, "left": 2,
  "image": "images/cards/geezard.jpg" }
```

3. Pour changer le nom affiché, modifiez simplement le champ `"name"`.

Le champ `"image"` est **optionnel** : une carte sans ce champ (ou avec une image introuvable) s'affiche
avec son style texte d'origine (chiffres au centre), sans rien casser. Si une image est renseignée, les
chiffres superposés au centre sont automatiquement masqués (on suppose que les valeurs sont déjà visibles
sur votre image, comme sur un vrai scan de carte) ; en cas d'échec de chargement de l'image, ils
réapparaissent automatiquement.

## Encyclopédie des cartes

Depuis le menu principal, "Encyclopédie" demande d'**importer un fichier de sauvegarde `.txt`** (pas de
saisie de nom) : sélectionnez le fichier correspondant à votre joueur, il est chargé et vous accédez
directement à votre collection, page par niveau. Comme pour l'import en mode Solo, ce fichier écrase la
sauvegarde correspondante côté serveur (donc utilisez toujours votre fichier le plus à jour).

## Cartes en plusieurs exemplaires

Le sélecteur de deck (mode Solo) regroupe automatiquement les cartes identiques sous une seule tuile avec
un badge `xN` indiquant le nombre d'exemplaires possédés. Cliquez sur la tuile pour en ajouter une copie à
votre deck (jusqu'à `N` exemplaires ou 5 cartes au total) ; un badge jaune indique combien sont
actuellement sélectionnées.

**Pour donner plusieurs exemplaires d'une carte dans le deck de départ**, répétez simplement le même
`id` plusieurs fois dans `data/starterDeck_ffviii.json` :

```json
["geezard", "geezard", "funguar", "bite_bug", "red_bat"]
```
→ le joueur commencera avec 2 Geezard.

## Choisir la carte gagnée en fin de partie

Avec la règle de mise **One** ou **Diff**, si vous gagnez le duel, une fenêtre de sélection s'affiche pour
choisir vous-même quelle(s) carte(s) prendre parmi celles de l'adversaire (1 pour One, la différence de
score pour Diff — jusqu'à 5). Avec **Direct** et **All**, le résultat est automatique (les règles ne
laissent pas de choix). Si vous perdez, c'est l'IA qui choisit automatiquement.

## Exporter / importer une sauvegarde existante

**Exporter** : une fois connecté, le bouton **"⬇️ Télécharger ma sauvegarde"** (visible en permanence en
haut de l'écran, à côté de "Déconnecter") récupère la version la plus à jour de la sauvegarde depuis le
serveur et déclenche le téléchargement d'un fichier `<nom>_<set>.txt` (ex: `squall_ffviii.txt`) au format
JSON lisible, dans le dossier de téléchargements habituel du navigateur.

**Importer** : sur l'écran de connexion, un champ "Ou importez un fichier de sauvegarde existant" permet
de sélectionner un fichier `.txt` précédemment exporté — utile pour transférer sa progression d'un
appareil à un autre. Le contenu est envoyé au serveur qui recrée/écrase la sauvegarde correspondante (sous
l'univers actuellement sélectionné, quel que soit le champ `"set"` inscrit dans le fichier).

**Pourquoi c'est utile en hébergement cloud** (ex: Render) : sur un service dont le système de fichiers
est éphémère (voir plus bas), la sauvegarde côté serveur peut être perdue à chaque redémarrage. En
téléchargeant régulièrement sa sauvegarde sur son propre appareil, la progression réelle du joueur ne
dépend plus du disque du serveur — un simple réimport suffit à la restaurer après coup. Testé de bout en
bout (simulation complète du flux connexion → jeu → téléchargement) : le fichier obtenu contient bien la
version la plus fraîche des points et de la collection au moment du clic.

## Rejouer / changer d'adversaire

En fin de partie (mode Solo), deux boutons apparaissent :
- **Rejouer** : revient à l'écran de configuration avec le même palier, le même adversaire, les mêmes
  règles et la même règle de mise déjà présélectionnés — mais il faut **resélectionner vos 5 cartes**
  (vous pouvez reprendre exactement les mêmes si vous le souhaitez, mais le choix n'est jamais
  automatique, pour refléter les cartes gagnées/perdues entre-temps).
- **Autre adversaire** : revient à l'écran de configuration pour choisir un autre adversaire (la
  sauvegarde est rechargée entre-temps pour refléter les cartes gagnées/perdues).

## Remise à zéro / abandon de la sauvegarde

Si la collection d'un joueur tombe à 4 cartes ou moins, un encart s'affiche sur l'écran de configuration
du mode Solo avec deux options :
- **Remise à zéro** : recharge le deck de départ (`data/starterDeck_ffviii.json`) dans la collection, sans
  perdre les statistiques (victoires/défaites).
- **Abandonner** : supprime définitivement le fichier `saves/<nom>.txt` après confirmation.

## Ordre d'affichage des cartes

Le sélecteur de deck (Solo et PvP) et l'encyclopédie affichent toujours les cartes triées par niveau, puis
par ordre d'apparition dans `data/cards_ffviii.json` (leur "numéro"). Pour réordonner vos cartes, changez
simplement leur position dans ce fichier.

## Règle Élémental

### Indiquer l'élément d'une carte

Ajoutez un champ `"element"` dans `data/cards_ffviii.json`, avec l'un des 8 noms définis dans
`data/elements.json` (voir ci-dessous) — respectez l'orthographe exacte (accents compris) :

```json
{ "id": "gallus", "name": "Gallus", "level": 1, "top": 2, "right": 1, "bottom": 2, "left": 6,
  "image": "images/cards/1-11 Gallus.jpg", "element": "Foudre" }
```

Une carte sans `"element"` (ou sans le champ du tout) est considérée comme neutre : elle ne bénéficie
jamais du bonus, mais subit quand même le malus si elle atterrit sur une case élémentale.

### Les 8 éléments et leurs icônes

La liste officielle des éléments (basée sur FF8) est définie dans **`data/elements.json`** :

```json
{ "name": "Foudre", "icon": "⚡", "image": null }
```

- `name` : à utiliser tel quel dans le champ `"element"` des cartes.
- `icon` : emoji utilisé par défaut si aucune image n'est fournie.
- `image` : chemin optionnel vers votre propre icône (relatif à `public/`), par exemple
  `"images/elements/foudre.png"`. Placez vos fichiers dans **`public/images/elements/`**. Si `image` est
  renseigné, il remplace l'emoji partout dans l'interface (plateau + badge sur les cartes) ; sinon
  l'emoji est utilisé.

Vous pouvez renommer, remplacer ou étendre ces 8 éléments en éditant ce fichier — le nombre de cases
élémentales générées aléatoirement à chaque duel (3 à 5) ne dépend pas du nombre d'éléments définis.

### Où les icônes s'affichent

Une fois la règle "Élémental" cochée et une image/emoji configuré, chaque case élémentale **vide** affiche
une grande icône centrée. Dès qu'une carte est posée dessus, l'icône disparaît au profit de l'indicateur
+1/-1 décrit ci-dessus (l'icône n'est donc plus dupliquée sur la carte elle-même — si votre image de carte
affiche déjà son élément, comme sur un vrai scan, ça reste cohérent visuellement).

Quand la case "Élémental" est cochée avant un duel, **3 cases maximum** du plateau (entre 1 et 3, tirées
aléatoirement) reçoivent un élément. Sur une case vide, l'icône s'affiche en grand, centrée. Une fois
qu'une carte y est posée, l'icône laisse place à un indicateur **+1** (vert) ou **-1** (rouge) affiché au
centre de la carte, pour indiquer si le bonus ou le malus a été appliqué :
- **+1 sur ses 4 valeurs** si l'élément de la carte correspond à celui de la case,
- **-1 sur ses 4 valeurs** sinon (élément différent, ou carte sans élément).

Ces ajustements sont définitifs une fois la carte posée (comme dans le jeu original) et s'appliquent avant
tout calcul de capture, Identique, Plus ou Mur en As. Les cartes sans `"element"` renseigné ne bénéficient
jamais du bonus, mais subissent quand même le malus si elles atterrissent sur une case élémentale.

*Limite connue : l'IA ne tient pas encore compte du bonus/malus élémental dans ses calculs de meilleur
coup (elle raisonne sur les valeurs de base) — cela reste une piste d'amélioration facile à ajouter dans
`server/ai.js` si besoin.*

## Règle "Mur en As"

Coché avant un duel, les bords du plateau agissent comme des cartes virtuelles de valeur **10 (As)** pour
les calculs des règles **Identique** et **Plus** (mais ne peuvent jamais être "capturés", évidemment).
Cela permet de déclencher des combos Identique/Plus en jouant sur les bords ou les coins, comme dans la
variante officielle "Same Wall" de Final Fantasy VIII.

## Règle "Combo"

Auparavant, une capture Identique ou Plus se propageait **toujours** automatiquement aux cartes adjacentes
(réaction en chaîne). C'est désormais une règle séparée, à cocher explicitement (bouton "Combo", à droite
de "Plus"). Sans elle, seules les cartes directement impliquées dans le déclenchement d'Identique/Plus
sont capturées, sans propagation. Testé unitairement : les deux comportements (avec/sans Combo) donnent
des résultats de capture différents et corrects selon le cas.

## Règle "Aléatoire"

Bouton à droite d'"Open". Quand elle est active, **les 5 cartes du joueur sont tirées au hasard dans sa
collection réelle** (le deck sélectionné dans l'écran de configuration est alors ignoré, aucune
validation stricte n'est requise). S'applique en Solo, en PvP (pour les deux joueurs), et en Tournoi (une
nouvelle main est retirée à chaque manche). Testé : avec cette règle active, un deck volontairement
invalide envoyé au serveur est bien ignoré, et la main réellement distribuée provient de la collection du
joueur.

## Délai de lisibilité avant le coup de l'IA

Après un coup du joueur, l'IA attend désormais **2,5 secondes de plus** que la durée de l'animation
déclenchée (flip simple, ou badge "Plus"/"Égal" + flip), pour laisser le temps de bien voir ce qu'il
s'est passé avant l'enchaînement. Calculé dynamiquement dans `computeAiDelay()` côté serveur : 2,5s si
aucune capture, +1s si capture basique simple, +2s si Identique/Plus se déclenche. Testé et mesuré en
conditions réelles (délai observé : 2505ms sans capture, conforme).

## Règle de mise "Différence" — vérifiée

La règle **Diff** calcule bien l'écart de score entre les deux joueurs en fin de partie (nombre de cases
contrôlées par le gagnant moins celles du perdant), et ce nombre correspond exactement au nombre de cartes
à gagner ou à perdre — plafonné à 5 (un deck ne contient que 5 cartes). Testé et confirmé :
- 9-0 (écart 9) → 5 cartes (plafond)
- 6-3 (écart 3) → 3 cartes
- 5-4 (écart 1) → 1 carte

## Couleur du nom lors du choix d'une carte gagnée

Sur l'écran "Choisissez votre butin" (règles de mise **One**/**Diff**), le nom de chaque carte proposée
est coloré selon votre historique :
- **Vert** : vous ne l'avez jamais possédée (toute nouvelle découverte pour votre encyclopédie).
- **Jaune** : vous ne la possédez plus actuellement, mais vous l'aviez déjà eue par le passé.
- Couleur normale : vous la possédez déjà dans votre collection actuelle.

Cet historique ("cartes déjà découvertes") est stocké dans le champ `discovered` de la sauvegarde et
persiste même après une Remise à zéro.

## Logo et fonds d'écran

- **Logo** : `public/images/logo.png` remplace le titre texte "Triple Triad" en haut de chaque page.
- **Fond principal** : `public/images/background-main.jpg` s'affiche en fond sur tous les écrans, sauf
  pendant une partie.
- **Fond du plateau** : dès que la vue de jeu s'affiche, le fond bascule automatiquement sur un dégradé
  radial `#C4944A` (centre) → `#341814` (bords), défini dans `public/style.css` (règle `body.in-game`).
  Pour changer ces couleurs, modifiez les valeurs dans cette règle.

## Règle "Open"

Bouton séparé au-dessus des autres règles (Solo et PvP). Quand elle est **désactivée** (par défaut), les
cartes encore en main de l'adversaire affichent un dos de carte (`public/images/card-back.jpg`) tant
qu'elles n'ont pas été posées sur le plateau. Une fois une carte posée, elle est toujours révélée
(quelle que soit la règle Open). En fin de partie, la dernière carte éventuellement restée en main (le
second joueur ne joue que 4 cartes sur 5, puisque le plateau ne compte que 9 cases) est également
révélée automatiquement.

Pour changer l'image du dos de carte, remplacez simplement `public/images/card-back.jpg`.

## Résumé des règles affiché en jeu

Au-dessus du plateau, une ligne récapitule les règles actives (Identique, Plus, Élémental, Mur en As,
Mort subite, Open) ainsi que la règle de mise choisie (One, Direct, Diff, All, None).

## Infobulles d'aide sur les règles

Survolez n'importe quel bouton de règle (Solo ou PvP) pour voir une explication succincte apparaître
(infobulle native du navigateur). Pour modifier ces textes, éditez l'attribut `title="..."` des boutons
correspondants dans `public/index.html`.

## L'élémental n'affecte plus Identique et Plus

Le bonus/malus élémental (+1/-1) ne s'applique désormais qu'à la **capture directe** (comparaison simple
carte contre carte). Les règles **Identique** et **Plus** utilisent toujours les valeurs d'origine de
chaque carte, non modifiées par l'élément de la case. Concrètement : si une carte gagne +1 grâce à un
élément correspondant, ce +1 peut lui permettre de capturer une carte adverse en comparaison directe,
mais il ne changera jamais si un "Identique" ou un "Plus" se déclenche ou non.

## Rendre le cadre noir des images de cartes transparent

Un script est fourni pour retirer automatiquement le fond/cadre noir de vos images de cartes et les
convertir en PNG transparent : **`tools/make_cards_transparent.py`**.

Prérequis (sur votre machine) : `pip install Pillow` (et `numpy`, optionnel mais recommandé pour la
rapidité).

```bash
python3 tools/make_cards_transparent.py public/images/cards public/images/cards_transparent
```

Le script part des 4 bords de l'image et "inonde" (flood fill) les pixels sombres connectés à ces bords
en les rendant transparents — les zones noires internes à l'illustration (ombres, etc.) ne sont pas
touchées puisqu'elles ne sont pas reliées au bord. Testé avec succès sur une carte réelle du projet.

Une fois les PNG générés dans le dossier de sortie, mettez à jour les champs `"image"` correspondants
dans `data/cards_ffviii.json` (extension `.png` au lieu de `.jpg`), ou remplacez directement vos fichiers.

## Créateur de cartes (outil visuel)

Pour composer facilement vos propres cartes (nouveaux sets FF7/FF9/FF10/Dark Souls...) à partir d'une
illustration trouvée + vos 3 gabarits de cadre par niveau, un outil web autonome est fourni :
**`tools/card-creator/index.html`**.

Ouvrez-le simplement dans votre navigateur (double-clic, aucun serveur ni connexion internet requis) :
il permet d'importer un cadre, une illustration, de les positionner/redimensionner avec des curseurs, d'y
ajouter le nom, les 4 valeurs et un élément optionnel, puis d'exporter le résultat en PNG prêt à l'emploi.
Voir `tools/card-creator/README.md` pour le détail de l'utilisation. Testé : chargement de la page,
cohérence de tous les contrôles et de la syntaxe JavaScript vérifiés.

## Session persistante (Solo / PvP / Encyclopédie)

Une fois connecté (nom ou import de fichier), une barre "Connecté : *nom*" apparaît en haut de chaque
page, avec un bouton **Déconnecter**. Tant que vous ne vous déconnectez pas, vous naviguez librement
entre Solo, Duel PvP et Encyclopédie sans jamais avoir à retaper votre nom.

Le mode PvP puise désormais ses 5 cartes dans votre collection réelle (comme le mode Solo, avec les
boutons +/-), et non plus dans l'ensemble des 77 cartes du jeu.

## Cartes légendaires

Mécanisme prêt à l'emploi : ajoutez `"legendary": true` à une carte dans `data/cards_ffviii.json`, et
placez-la dans le deck de base d'**un seul** adversaire dans `data/opponents_ffviii.json` (son détenteur
d'origine).

Comportement (testé et validé) :
- Une fois obtenue par un joueur, cette carte n'est **plus jamais reproposée** par aucun adversaire IA à
  ce joueur (comparaison avec l'historique `discovered` de sa sauvegarde), même après une Remise à zéro.
- Si un joueur la perd contre un adversaire IA (règle de mise Direct/All/Diff/One), elle **migre**
  temporairement vers cet adversaire — stocké dans `data/legendary-registry.json` (généré et mis à jour
  automatiquement par le serveur, partagé entre tous les joueurs).
- Dans l'Encyclopédie, une carte légendaire non possédée affiche "Détenue par : *nom de l'adversaire*"
  suivi de son **palier** (ex: "Palier 3 - Confirmé"), sous le `???`, basé sur son détenteur actuel.
- Si cet adversaire fait partie des adversaires de votre **tournoi en cours** (manches normales ou manche
  décisive), un indice bonus "⚔️ Aussi présent dans votre tournoi en cours" s'affiche — purement
  informatif : le tournoi ne fait gagner aucune carte tant que les récompenses finales ne sont pas
  définies (voir section Tournoi), cet indice sert juste à repérer où l'adversaire recherché apparaît.
- Un adversaire qui vient de perdre une carte légendaire (migrée ailleurs) ne la propose plus.

## Couleur du joueur derrière les zones transparentes des cartes

Une fois le cadre noir rendu transparent (voir script ci-dessus), la couleur qui apparaît derrière la
carte sur le plateau devient automatiquement celle du propriétaire (bleu pour vous/J1, rouge pour
l'adversaire/J2) au lieu d'un fond neutre. Codé dans `public/style.css`, règles `.owner-A .card-tile:has(.card-art)`
et `.owner-B .card-tile:has(.card-art)`.

**Concernant le fond bleu intérieur de vos cartes** : oui, le même principe s'applique automatiquement si
vous rendez aussi cette zone transparente — la couleur du joueur apparaîtra alors sur toute la carte, pas
seulement sur le cadre extérieur. Le script `tools/make_cards_transparent.py` a été mis à jour pour
accepter n'importe quelle couleur cible (pas seulement le noir) via `--color R,G,B --tolerance N`, ce qui
vous permet de cibler spécifiquement ce bleu de fond. Testé avec succès sur une image de démonstration.

## Effet de flip lors d'une capture

Quand une carte change de propriétaire (capture), elle effectue une rotation 3D d'1 seconde
(`@keyframes cardFlip` dans `public/style.css`).

## Badge "Plus" / "Égal" avant le flip

Quand un coup déclenche la règle Identique ou Plus, un badge doré ("Égal" ou "Plus") s'affiche 1 seconde
sur la carte qui vient d'être posée, **avant** que les cartes capturées ne basculent avec l'effet de flip.
Le serveur transmet désormais l'information de la règle déclenchée et des cases capturées à chaque coup
(`lastMove` dans les événements `solo:state`/`pvp:state`), testé en conditions réelles.

## Cartes gagnées / perdues affichées visuellement

En fin de partie, les cartes réellement gagnées ou perdues s'affichent sous forme de vraies tuiles
(image + valeurs) en bas du plateau, dans deux colonnes séparées, plutôt qu'une simple liste de noms en
texte.

## Cartes légendaires en PvP : que se passe-t-il ?

**Rien** — actuellement, le mode PvP n'est pas relié aux sauvegardes des joueurs (comme documenté plus
haut : "le PvP n'affecte pas les sauvegardes"). Une carte légendaire "échangée" au cours d'un duel PvP
via une règle de mise reste donc purement visuelle le temps du match : elle ne quitte jamais la
collection réelle du joueur qui la possède, et le registre `legendary-registry.json` n'est pas touché.

Si vous souhaitez que les duels PvP affectent réellement les collections (y compris la migration d'une
carte légendaire vers la sauvegarde de l'autre joueur), c'est une extension possible mais plus complexe
que le système actuel (qui ne gère la migration qu'entre un joueur et des adversaires IA) — dites-le moi
quand vous voudrez l'implémenter.

## Commerce (Boutique)

Chaque joueur commence avec **1000 points**. Actuellement, seules les victoires en mode Solo contre l'IA
rapportent des points, selon la formule `palier de l'adversaire × 50` (palier 1 = 50 pts, ... palier 6 =
300 pts) — ajustable dans `server/index.js`, fonction `finalizeSoloResult` (variable `pointsAwarded`).

**Exception** : si la règle de mise **"Aucune" (None)** est active, une victoire ne rapporte **aucun
point**, quel que soit le palier de l'adversaire affronté (puisqu'aucune récompense du tout n'est prévue
avec cette règle). Testé et vérifié : victoire avec "Aucune" → 0 point ; victoire avec toute autre règle
de mise → points normalement attribués.
*Le mode Tournoi n'existe pas encore dans le projet ; quand il sera développé, il faudra y ajouter sa
propre logique d'attribution de points.*

### Acheter une carte aléatoire

4 paliers, définis dans `server/shop.js` :

| Palier | Coût | Niveaux |
|---|---|---|
| 1 | 200 pts | 1 à 2 |
| 2 | 500 pts | 3 à 5 |
| 3 | 1000 pts | 6 à 7 |
| 4 | 5000 pts | 8 à 10 |

La carte est tirée **aléatoirement pondérée par rareté** (voir section dédiée ci-dessous) parmi toutes
celles du jeu dans la plage de niveaux (jamais une carte légendaire, qui ne s'obtient qu'en duel).
**Note** : le jeu actuel ne contient des cartes que jusqu'au niveau 7 — le palier "8 à 10" affichera donc
une erreur explicite tant qu'aucune carte de ces niveaux n'existe dans `data/cards_ffviii.json` (comportement
volontaire, testé).

Après confirmation de l'achat : un fondu au noir s'affiche, puis après 2 secondes le dos de la carte
(`public/images/card-back.jpg`) apparaît, reste visible 2 secondes, puis effectue un flip d'1 seconde
pour révéler la carte achetée, avec son niveau et son nom affichés en grand en dessous. Cliquer n'importe
où sur l'écran la fait disparaître.

## Échange entre joueurs (onglet "Échange" du Commerce)

Deux vrais joueurs, chacun connecté dans un onglet/navigateur séparé avec sa propre sauvegarde (même
univers obligatoirement), peuvent s'échanger une carte et/ou des points en direct.

### Déroulement

1. Un joueur clique "Créer un salon d'échange" → obtient un code à 5 caractères à partager.
2. L'autre joueur entre ce code et clique "Rejoindre".
3. Chaque joueur compose son offre : au maximum **une carte** de sa collection (clic pour
   sélectionner/désélectionner) et/ou un **montant de points**. Les deux offres s'affichent en temps réel
   des deux côtés de l'écran.
4. Chaque joueur clique "Valider mon offre" quand il est satisfait. Dès que les **deux** joueurs ont
   validé, l'échange s'exécute automatiquement.
5. **Toute modification d'une offre après validation annule les deux validations** (protection contre le
   changement de dernière minute) — testé et vérifié.
6. Au moment de l'échange, les deux offres glissent l'une vers l'autre (transform CSS, 3 secondes) pour
   simuler visuellement l'échange, puis les sauvegardes des deux joueurs sont mises à jour.

### Sécurité

Les offres sont **revalidées côté serveur juste avant l'exécution** (carte toujours possédée, points
toujours suffisants) — si l'un des deux joueurs a dépensé sa carte ou ses points ailleurs entretemps
(boutique, duel...) pendant que l'échange était en attente, celui-ci est automatiquement annulé sans
aucun effet, avec un message clair. Testé avec un cas d'offre de points insuffisants : l'échange est
bien rejeté, aucune modification n'est appliquée aux deux sauvegardes.

Un échange complet a été testé de bout en bout avec deux clients Socket.io simultanés : carte + points
correctement transférés dans les deux sens, soldes de points exacts après transaction.

## Rareté des cartes (boutique)

Chaque carte peut recevoir un champ optionnel `"rarity"` dans `data/cards_ffviii.json`, un nombre de **1 à 5** :
- `1` = très rare (peu de chances d'être tirée en boutique)
- `5` = très commune (beaucoup de chances d'être tirée)
- Une carte sans ce champ compte comme `3` (valeur neutre, comportement équitable par défaut)

```json
{ "id": "gallus", ..., "rarity": 1 }
{ "id": "bogomile", ..., "rarity": 5 }
```

Avec cet exemple, `bogomile` a **5 fois plus de chances** d'être tirée que `gallus` lors d'un achat dans
la même plage de niveaux. Le tirage est un tirage pondéré classique (poids proportionnel à `rarity`),
implémenté dans `server/shop.js` (`weightedRandomPick`) — testé et validé statistiquement (ratio observé
de 5.04 pour un ratio théorique de 5.00 sur 60 000 tirages).

**Pour aller au-delà de 5** : aucune limite n'est codée en dur, le poids est utilisé tel quel. Vous
pouvez donc mettre `"rarity": 10` ou `"rarity": 50` sans toucher au code — cette carte sera juste
proportionnellement plus (ou moins, si vous utilisez des petites valeurs comme `0.5`) probable que les
autres. Seul l'écart *relatif* entre les valeurs compte, pas leur échelle absolue.

La rareté n'affecte que la boutique — les decks des adversaires IA restent fixes (définis à la main dans
`data/opponents_ffviii.json`), donc la notion de rareté ne s'y applique pas.

### Vendre une carte

Prix par niveau (`server/shop.js`, `SELL_PRICE_BY_LEVEL`) :

| Niveau | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8-10 |
|---|---|---|---|---|---|---|---|---|
| Prix | 50 | 75 | 100 | 125 | 150 | 175 | 200 | invendable |

Vendre une carte ne modifie jamais son historique de découverte (`discovered`) : elle reste marquée comme
déjà obtenue, uniquement retirée de la collection actuelle.

## Univers / Sets de cartes

Le jeu peut héberger plusieurs univers de cartes indépendants (ex: Final Fantasy VIII, Final Fantasy IX,
un set "Multivers" mélangeant plusieurs univers...). Au tout premier écran du site, le joueur choisit son
univers avant même de se connecter — ce choix est mémorisé dans son navigateur (mais reste modifiable via
le bouton "Changer d'univers" en haut de page, qui déconnecte la session en cours puisqu'une collection
n'a de sens que dans un seul univers à la fois).

### Comment ça marche

- **`data/sets.json`** liste les univers sélectionnables :
  ```json
  [{ "id": "ffviii", "label": "Final Fantasy VIII", "includes": ["ffviii"] }]
  ```
  `includes` est un tableau de tags : un set peut regrouper plusieurs tags (ex: un set "Multivers"
  pourrait avoir `"includes": ["ffviii", "ff9"]` pour piocher dans les deux univers sans dupliquer aucune
  carte).
- Chaque carte dans `data/cards_ffviii.json` porte un champ `"set"` (ex: `"set": "ffviii"`) qui la rattache à un
  univers.
- Chaque adversaire dans `data/opponents_ffviii.json` porte lui aussi un champ `"set"`.
- **`data/starterDeck_ffviii.json`** est désormais une map par set : `{ "ffviii": ["bogomile", ...] }`.

### Fichiers de données séparés par set (recommandé)

Depuis peu, le serveur **fusionne automatiquement** plusieurs fichiers au démarrage, au lieu d'exiger un
seul `cards.json`/`opponents.json`/`starterDeck.json` géant. Vous pouvez créer un fichier séparé par
univers, sans jamais avoir à toucher ou fusionner manuellement les fichiers des autres sets :

- `data/cards.json`, `data/cards_ffix.json`, `data/cards_ffx.json`, `data/cards_darksouls.json`, ... →
  tous les tableaux sont concaténés. Chaque `"id"` de carte doit rester unique dans l'ensemble de ces
  fichiers — une erreur claire s'affiche au démarrage si un doublon est détecté, en indiquant les deux
  fichiers en cause.
- `data/opponents.json`, `data/opponents_ffix.json`, ... → les paliers portant le **même numéro `tier`**
  dans des fichiers différents sont automatiquement regroupés (leurs adversaires s'additionnent), donc un
  nouveau set peut enrichir un palier existant sans éditer le fichier d'un autre set.
- `data/starterDeck.json`, `data/starterDeck_ffix.json`, ... → les objets sont fusionnés clé par clé (une
  clé = un id de set). Erreur claire si la même clé de set apparaît deux fois.

Convention de nommage : `<prefix>.json` ou `<prefix>_<n'importe_quoi>.json` (le suffixe après `_` est
libre, choisissez un nom lisible comme `cards_ffix.json`). Testé et vérifié : fusion de deux fichiers
`cards`, regroupement de deux fichiers `opponents` sur un même palier, fusion de deux fichiers
`starterDeck`, et détection d'un `id` en doublon avec message d'erreur précis (fichiers concernés inclus).

**Piège à éviter** (vécu en pratique) : si vous renommez/remplacez un fichier `data/cards*.json` pendant
que le serveur Node tourne déjà, il continuera de servir les **anciennes données en mémoire** tant qu'il
n'est pas redémarré (`Ctrl+C` puis `npm start`) — `require()` met le fichier en cache au démarrage et ne
le relit jamais tout seul.

### Ajouter un nouvel univers (ex: Final Fantasy IX)

1. Créez `data/cards_ffix.json` avec vos nouvelles cartes, chacune taguée `"set": "ffix"`.
2. Créez `data/opponents_ffix.json` avec vos adversaires, tagués `"set": "ffix"` (peuvent réutiliser les
   mêmes numéros de palier 1 à 6 qu'un autre set, ou en définir d'autres).
3. Créez `data/starterDeck_ffix.json` : `{ "ffix": ["carte1", "carte2", ...] }`.
4. Ajoutez le set dans `data/sets.json` :
   ```json
   { "id": "ffix", "label": "Final Fantasy IX", "includes": ["ffix"] }
   ```
5. (Optionnel) Ajoutez un set "Multivers" combinant plusieurs univers :
   ```json
   { "id": "multivers", "label": "Multivers (FF8 + FF9)", "includes": ["ffviii", "ffix"] }
   ```

Aucun fichier existant d'un autre set n'a besoin d'être ouvert ni modifié. Redémarrez le serveur après
avoir ajouté vos fichiers. Les sauvegardes (`saves/<set>/<nom>.txt`), la boutique, les cartes légendaires
et l'encyclopédie s'adaptent automatiquement à chaque univers.

### Sauvegardes par univers

Un même pseudo peut avoir une progression **totalement indépendante** dans chaque univers : les fichiers
sont rangés dans `saves/<set>/<nom>.txt` (ex: `saves/ffviii/squall.txt`). Les registres de cartes légendaires
suivent le même principe (`data/legendary-registry-<set>.json`, généré automatiquement).

## Mode Tournoi

Accessible via le bouton "Tournoi" du menu principal. Trois niveaux au choix, chacun piochant ses
adversaires dans une plage de paliers IA différente (défini dans `TOURNAMENT_TIERS`,
`server/tournament.js`) :

| Niveau | Coût | Adversaires (paliers) |
|---|---|---|
| Facile | 0 pts | 1 à 3 |
| Medium | 200 pts | 2 à 5 |
| Expert | 500 pts | 4 à 6 |

Un **4e niveau caché** (`"???"`, 1000 pts, palier 6 uniquement) existe déjà dans le code mais n'apparaît
dans aucune liste tant que sa condition de déblocage n'est pas définie — voir la fonction
`isTierUnlocked()` dans `server/tournament.js`, actuellement figée à `return false`. Le jour où vous
définirez la condition (ex: avoir été Champion en Expert), il suffit de modifier cette fonction ; testé
et vérifié que le palier caché est bien invisible et inaccessible (même en appelant l'API directement)
tant qu'il n'est pas débloqué.

Chaque niveau a un `rewardScale` (1/2/4/8) prévu pour calibrer des récompenses de plus en plus
généreuses une fois celles-ci définies (voir plus bas).

### Déroulement

- 5 adversaires de plus en plus forts sont tirés au hasard une seule fois au démarrage (un par palier,
  du palier 1 au palier 5 si le set en compte au moins 5 — sinon le dernier palier disponible est répété
  pour compléter les 5 manches).
- Le deck de 5 cartes et les règles de jeu sont choisis une fois à l'entrée et réutilisés pour toutes les
  manches (le deck n'est jamais entamé : chaque manche démarre avec vos 5 cartes complètes).
- **Aucune carte n'est jamais gagnée ni perdue pendant le tournoi** — seul le classement final compte.
  Vérifié : la collection reste identique du début à la fin d'un tournoi complet.

### Classement

- Victoire aux 5 manches → **Champion** (1ère place)
- Victoires aux 4 premières manches puis défaite en 5e → **2e place**
- Défaite en 4e manche → une **manche décisive** se déclenche automatiquement contre un adversaire
  différent du même palier :
  - Victoire de la décisive → **3e place**
  - Défaite de la décisive → Éliminé
- Défaite avant la 4e manche (aux manches 1, 2 ou 3) → Éliminé directement, pas de manche décisive.

Toutes ces branches ont été testées individuellement (voir le développement de cette fonctionnalité).

### Sauvegarde interne / reprise

La progression est stockée dans le champ `tournament` de la sauvegarde du joueur, écrite sur disque après
chaque manche. Vous pouvez donc quitter à tout moment (ex: entre la 2e et la 3e manche) sans perdre votre
avancée — le tournoi reprend exactement où vous l'aviez laissé en revenant sur "Tournoi". Un bouton
"Abandonner le tournoi" permet de tout arrêter volontairement (sans remboursement des points d'entrée déjà
payés).

### Récompenses finales — à définir

Les récompenses n'ont pas encore été définies. La fonction `grantTournamentReward(placement, ...)` dans
`server/tournament.js` est un point d'ancrage prêt à l'emploi, et reçoit déjà le `tierKey` du tournoi
joué pour moduler les récompenses selon le niveau (via `rewardScale` : 1 pour Facile, 2 pour Medium, 4
pour Expert) :

```js
function grantTournamentReward(placement, { name, setId, tierKey }, saveManager) {
  const scale = getTierDef(tierKey).rewardScale;
  if (placement === 'champion') saveManager.addPoints(name, setId, 1000 * scale);
  if (placement === 'second') saveManager.addPoints(name, setId, 500 * scale);
  if (placement === 'third') saveManager.addPoints(name, setId, 250 * scale);
}
```

Elle est déjà appelée automatiquement à la fin de chaque tournoi terminé — il ne reste qu'à remplir son
contenu quand vous aurez choisi vos récompenses.

## Musiques et bruitages

Déposez vos 3 fichiers dans **`public/audio/`**, avec ces noms exacts :

| Fichier | Rôle |
|---|---|
| `Menu_TT.mp3` | Musique de fond sur le menu principal et tous les écrans hors-duel (en boucle) |
| `Duel_TT.mp3` | Musique de fond pendant un affrontement — Solo, PvP ou Tournoi (en boucle) |
| `Bouton_TT.mp3` | Bruit joué à chaque clic sur un bouton |

Aucune autre configuration n'est nécessaire : le jeu détecte automatiquement l'écran affiché et bascule
entre "Menu" et "Duel" au bon moment (basé sur la vue active), et joue le bruit de bouton sur tout clic.

**Fonctionnement technique** :
- La musique change automatiquement à chaque navigation (`showView()`), sans redémarrer si vous restez
  dans la même catégorie d'écran (ex: naviguer entre Encyclopédie et Commerce ne relance pas la musique
  du menu).
- Un bouton 🔊/🔇 fixe en haut à droite de l'écran permet de couper/réactiver la musique — préférence
  mémorisée dans le navigateur (`localStorage`), conservée d'une session à l'autre.
- Les navigateurs bloquent la lecture automatique du son tant qu'aucune interaction n'a eu lieu : la
  musique démarre donc au premier clic sur la page (comportement standard, imposé par tous les
  navigateurs modernes, pas un bug).
- Si un fichier `.mp3` est absent, le jeu continue de fonctionner normalement sans bruit ni musique
  (l'erreur de lecture est silencieusement ignorée) — testé et vérifié.

## Ajouter / modifier des cartes

Toutes les cartes sont définies dans **`data/cards_ffviii.json`**. Chaque carte est un objet :

```json
{ "id": "malboro", "name": "Malboro", "level": 6, "top": 4, "right": 7, "bottom": 7, "left": 3 }
```

- `id` : identifiant unique (sans espace, utilisé partout dans le code et les sauvegardes).
- `name` : nom affiché.
- `level` : 1 à 10 (indicatif, sert à équilibrer les paliers d'adversaires).
- `top/right/bottom/left` : valeurs de 1 à 10 (10 = "A" dans le jeu original si vous voulez aller plus loin).

**Pour ajouter une carte** : ajoutez simplement un nouvel objet dans `data/cards_ffviii.json`, puis redémarrez le
serveur. Elle apparaîtra automatiquement dans :
- le sélecteur de deck du mode PvP (toutes les cartes de `cards_ffviii.json` y sont proposées),
- les decks d'adversaires du mode solo, si vous l'ajoutez aussi dans `data/opponents_ffviii.json`,
- et pourra être ajoutée à un deck de départ via `data/starterDeck_ffviii.json`.

**Pour ajouter/éditer un adversaire solo** : modifiez `data/opponents_ffviii.json`. Chaque adversaire a un `name`,
une `ai` (`"random"`, `"greedy"` ou `"smart"`) et un `deck` de 5 `id` de cartes existant dans `cards_ffviii.json`.

```json
{ "name": "Nouveau Boss", "ai": "smart", "deck": ["ultima_weapon", "omega", "trauma", "krysta2", "propagator"] }
```

Vous pouvez aussi créer un 7e palier en dupliquant un bloc `{ "tier": 7, "label": "...", "opponents": [...] }`
dans le tableau — le code s'adapte automatiquement au nombre de paliers présents.

### Adversaire imposant ses propres règles

Un adversaire peut forcer ses propres règles de jeu et sa propre condition de victoire pour le duel,
en ignorant totalement ce que le joueur aurait choisi dans l'écran de configuration. Ajoutez
`"imposedRules"` et/ou `"imposedTradeRule"` à son entrée dans `data/opponents_ffviii.json` :

```json
{
  "name": "Gardien Rigide",
  "ai": "smart",
  "deck": ["ultima_weapon", "omega", "trauma", "krysta2", "propagator"],
  "imposedRules": { "same": true, "plus": true, "combo": true },
  "imposedTradeRule": "all"
}
```

- `imposedRules` : objet listant les règles forcées (`same`, `plus`, `combo`, `elemental`, `wallAce`,
  `open`, `random`, `suddenDeath`) — celles non mentionnées sont désactivées, quel que soit le choix du
  joueur. Omettez ce champ pour laisser le joueur choisir librement.
- `imposedTradeRule` : une des valeurs `"one"`, `"direct"`, `"diff"`, `"all"`, `"none"`. Omettez pour
  laisser le choix du joueur.

Quand un tel adversaire est sélectionné, l'écran de configuration Solo affiche automatiquement un
avertissement et verrouille les contrôles de règles avec les valeurs imposées (purement visuel — le
serveur applique de toute façon ces règles indépendamment de ce que le client enverrait, **testé et
vérifié même en simulant une tentative de contournement direct de l'API** : les règles/mise du joueur
sont bien ignorées face à un tel adversaire, et bien respectées face à un adversaire normal).

*Limite actuelle : ce mécanisme ne s'applique qu'au mode Solo. En mode Tournoi, les règles sont fixées une
fois pour les 5 manches à l'entrée du tournoi et ne sont pas affectées par les règles imposées d'un
adversaire rencontré en cours de route.*

**Pour changer le deck de départ** : éditez `data/starterDeck_ffviii.json` (liste de 5 `id`). Cela ne s'applique
qu'aux joueurs qui n'ont pas encore de fichier de sauvegarde.

## Règles implémentées

- **Capture basique** : une carte posée capture les cartes adverses adjacentes dont le côté touché a une
  valeur strictement inférieure.
- **Identique (Same)** : si au moins 2 côtés touchés (dont au moins un adverse) ont une valeur égale à la
  carte posée, les cartes adverses concernées sont capturées.
- **Plus** : si au moins 2 sommes (côté posé + côté voisin touché) sont égales entre elles sur des voisins
  différents, les cartes adverses concernées sont capturées.
- **Combo** : toute capture déclenchée par Identique ou Plus se propage en chaîne (capture basique) aux
  voisins des cartes qui viennent de changer de camp — comportement automatique, comme dans FF8.
- **Mort subite** : case à cocher exposée dans l'UI ; la logique de replay en cas d'égalité peut être
  branchée dans `server/index.js` (`finishIfBoardFull`) si vous voulez l'activer pleinement.
- **Règle de mise** : `server/tradeRules.js`
  - `none` : aucune carte échangée.
  - `one` : le gagnant reçoit 1 carte aléatoire du perdant.
  - `direct` : le gagnant garde les cartes du perdant qu'il a réellement capturées sur le plateau.
  - `diff` : nombre de cartes échangées = différence de score (1 à 5).
  - `all` : le gagnant reçoit les 5 cartes du perdant.

## Changer l'image de fond du plateau

Fichier : **`public/images/board.jpg`** — remplacez-le simplement par une autre image (idéalement carrée).

Le plateau de jeu (les 9 cases) est positionné par-dessus cette image via des pourcentages calés sur les
cadres rouges de l'illustration fournie (`#board` dans `public/style.css`). Si vous changez d'image avec
une disposition différente, ajustez ces valeurs dans `style.css` :

```css
#board {
  top: 8.8%;
  left: 9.0%;
  right: 9.5%;
  bottom: 8.9%;
  gap: 2.7%;
}
```

## Aller plus loin (non inclus pour rester simple)

- Règles **Ouvert / Aléatoire / Élémental / Mur** (non implémentées, mais peuvent s'ajouter dans
  `server/engine.js` en suivant le même schéma que `same`/`plus`).
- Faire persister les résultats du mode PvP dans les sauvegardes `.txt` des deux joueurs (il suffit
  d'appeler `saveManager.addCardsToSave` / `removeCardsFromSave` dans le handler `pvp:place` /
  `isBoardFull` de `server/index.js`, comme c'est déjà fait pour le solo).

## Structure du projet

```
triple-triad/
  data/
    cards_ffviii.json         <- cartes FF8 (une par set : cards_<nom>.json), tagué "set", fusion auto
    opponents_ffviii.json     <- adversaires FF8 par palier (opponents_<nom>.json), tagué "set"
    starterDeck_ffviii.json   <- deck de départ FF8 (starterDeck_<nom>.json, map { "ffviii": [...] })
    elements.json             <- les 8 éléments (nom + icône par défaut + image perso), partagé
    sets.json                 <- univers sélectionnables (voir section "Univers / Sets")
    legendary-registry-<set>.json <- généré automatiquement, un par set
  server/
    engine.js                 <- règles du jeu (capture, Same, Plus, Combo)
    ai.js                     <- IA du mode solo/tournoi
    tradeRules.js              <- règles de mise
    cardLoader.js               <- construction des mains de jeu
    sets.js                    <- résolution des cartes/adversaires/deck de départ par set
    saveManager.js              <- lecture/écriture des sauvegardes .txt (par set)
    legendaryRegistry.js         <- registre des cartes légendaires (par set)
    shop.js                      <- boutique (achat pondéré par rareté, vente)
    tournament.js                 <- logique du mode Tournoi (adversaires, classement)
    index.js                       <- serveur Express + Socket.io (API + temps réel)
  public/
    index.html, style.css, client.js  <- interface web
    images/board.jpg                  <- illustration de fond du plateau
    images/cards/                     <- vos images de cartes (voir section dédiée)
    images/elements/                  <- vos icônes d'éléments personnalisées (optionnel)
    images/card-back.jpg              <- dos de carte (règle Open désactivée)
  tools/
    make_cards_transparent.py         <- script de détourage des images de cartes
  saves/
    <set>/<nom>.txt           <- sauvegardes générées automatiquement, une par joueur et par univers
```
