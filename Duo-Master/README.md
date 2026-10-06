# Duo-Master

Jeu de quiz à deux tirages. Le serveur tire au sort deux valeurs (par exemple deux types Pokémon),
les joueurs cherchent une réponse qui correspond, l'arbitre désigne le vainqueur du point.
Premier à atteindre le nombre de points choisi (3 à 20) : partie gagnée.

Aucune dépendance : Node.js 16 ou plus suffit. Plusieurs parties peuvent tourner **en même temps**, dans des
**salons** séparés (un code court par partie) : les scores, le thème et le tirage d'un salon n'ont aucun effet sur
les autres, même s'ils sont joués au même moment sur le même serveur.

## Lancer

```bash
node server.js        # ou : npm start
```

Ouvrir ensuite http://localhost:13000 (port modifiable : `PORT=8080 node server.js`).

| Page | Rôle |
| --- | --- |
| `/` | Accueil : créer un salon (nouvelle partie) ou en rejoindre un (code donné par l'arbitre). |
| `/CODE` | Arbitre du salon CODE : lance le tirage, voit les réponses, attribue / retire les points, règle la partie. Suffit pour jouer sur **un seul écran**. |
| `/CODE/joueur1` … `/CODE/joueur6` | Page d'un joueur de ce salon : points en haut, tirage en direct (défilement de 2 s), scores des autres. |
| `/CODE/ecran` | Écran commun de ce salon (TV, vidéoprojecteur) : tirage en grand + tous les scores. |
| `/CODE/rejoindre` | Page d'accueil avec le code déjà rempli — c'est l'adresse du QR code affiché sur la page arbitre. |

**Créer une partie** : sur `/`, bouton *Créer un salon* (code à 4 lettres/chiffres tiré au sort), ou *Choisir mon
propre code* pour un code mémorisable (« FAMILLE »…). La page arbitre affiche alors le code en grand, un QR code et
un lien à copier : les joueurs le scannent avec leur téléphone, ou tapent le code sur `/`, puis touchent leur nom
pour rejoindre leur propre page. Le QR code nécessite un accès Internet au moment du scan (bibliothèque chargée
depuis un CDN) ; sans connexion, le lien texte et le code restent utilisables normalement.

Au démarrage, le terminal affiche aussi l'adresse réseau (`http://192.168.x.x:13000/`) à ouvrir depuis les
téléphones connectés au même Wi-Fi. Un salon sans aucune page ouverte depuis 6h est libéré de la mémoire du
serveur ; ses réglages et scores restent sur le disque (`data/rooms.json`) et le salon reprend exactement où il
en était dès que quelqu'un rouvre son code.

## Déroulé d'une partie

1. **Réglages de la partie** (page arbitre) : thème, points pour gagner (3–20), nombre de joueurs (2–6), noms.
   Les noms, le thème, l'objectif et les scores sont conservés dans `data/rooms.json` (même après un redémarrage).
2. **▶ Lancer la partie** : tant que l'arbitre n'a pas appuyé sur ce bouton, la partie est en attente (les joueurs voient
   « en attente du lancement ») et les réglages restent ouverts. « Nouvelle partie » ramène à cet état.
3. **Lancer le tirage** : les cartes défilent 2 secondes chez tout le monde, puis les valeurs apparaissent.
4. L'arbitre voit les **réponses possibles** (bouton *Masquer* pour un écran partagé), puis appuie sur **🏆 Point**
   à côté du gagnant. Erreur ? **−1** retire un point (**+1** l'ajoute). Personne ne trouve : **Autre tirage**.
5. Quand un joueur atteint l'objectif, la victoire s'affiche partout. **Nouvelle partie** remet les scores à zéro.

## Ajouter ou modifier un thème

Chaque thème est un fichier JSON dans `themes/`. Il est relu automatiquement : pas besoin de redémarrer
(le nouveau thème apparaît dans la liste des réglages). Les fichiers dont le nom commence par `_` sont ignorés ;
`themes/_modele.json` sert de point de départ.

```jsonc
{
  "name": "Dragon Ball",
  "emoji": "🐉",
  "description": "Texte d'explication affiché dans les réglages.",
  "answerMode": "slots",     // "set" ou "slots" (voir plus bas)
  "skipEmpty": true,         // true = ne tire jamais une combinaison sans réponse (défaut)

  "lists": {                 // les listes de valeurs à tirer
    "arcs":  [ { "name": "Saiyans", "color": "#E4572E" }, "Boo" ],   // texte simple ou objet
    "races": [ { "name": "Saiyan", "color": "#C0392B", "emoji": "💪" } ]
  },

  "slots": [                 // un élément par carte tirée (2, 3… autant que voulu)
    { "id": "arc",  "label": "Arc",  "list": "arcs" },
    { "id": "race", "label": "Race", "list": "races" }
  ],

  "answers": [ ... ]         // facultatif : réponses affichées à l'arbitre
}
```

Deux cartes peuvent utiliser la **même liste** (Pokémon : deux fois `types`, donc Feu-Feu est possible).

### `answerMode: "set"` — réponses définies par un ensemble de valeurs (Pokémon)

Une réponse correspond si **l'ensemble** des valeurs tirées est exactement son ensemble de `tags`, dans n'importe quel ordre.

```json
{ "name": "Dracaufeu", "tags": ["Feu", "Vol"], "info": "#6" }
```

Feu-Feu → les Pokémon de type Feu pur ; l'arbitre a en plus une liste repliable « acceptables aussi » avec
les doubles types contenant Feu.

### `answerMode: "slots"` — une condition par carte (Dragon Ball)

Chaque réponse indique, pour chaque `id` de carte, la ou les valeurs acceptées (texte ou liste).
Une carte non renseignée n'impose aucune condition.

```json
{ "name": "Son Gohan", "arc": ["Saiyans", "Boo"], "race": ["Saiyan", "Terrien"] }
```

Les comparaisons ignorent majuscules et accents. Sans `answers`, le thème fonctionne quand même
(l'arbitre juge seul).

## Données des thèmes fournis

- `themes/pokemon.json` : 1134 entrées, noms français, types actuels (18 types, Fée incluse) : les 1025 Pokémon
  + les formes alternatives dont les types diffèrent (Méga-évolutions, formes d'Alola / Galar / Hisui / Paldea,
  Motisma…). Données issues de PokéAPI. Pour régénérer le fichier (Node 18+, accès Internet) :
  `node tools/generate-pokemon.js`. Attention : cela écrase vos modifications manuelles.
- `themes/dragonball.json` : tirage d'un **arc** et d'une **race**, une centaine de personnages de départ.
  Les associations sont à compléter / corriger à votre goût (une ligne = un personnage).

## Mode de jeu : Rapidité ou Réponse

En haut de la page arbitre, un sélecteur permet de choisir le mode, à tout moment :

- **⚡ Rapidité** (comportement historique) : l'arbitre écoute les joueurs à l'oral et désigne
  lui-même qui a gagné le point. Un seul point par tour.
- **✍️ Réponse** : chaque joueur écrit sa réponse sur sa page, avec 10 secondes pour la taper.
  Elle est comparée automatiquement à la liste de réponses du thème (accents, majuscules et
  ponctuation ignorés). Plusieurs joueurs peuvent marquer sur le même tour. L'arbitre voit en
  direct ce que chacun a tapé et peut attribuer le point à la main si la réponse était juste
  mais mal orthographiée (ou si le thème n'a pas de liste de réponses).
  En cas d'égalité au sommet une fois l'objectif atteint (ex. 10 à 10), la partie continue :
  il faut finir seul en tête pour gagner, comme demandé (« la 11ᵉ réponse la plus rapide »).

## Structure

```
server.js            serveur HTTP + temps réel (Server-Sent Events) + API
public/              pages et scripts du navigateur
themes/              thèmes (JSON) — à éditer / compléter
tools/               générateur du thème Pokémon (facultatif)
data/state.json      noms, scores, réglages (créé automatiquement)
```
