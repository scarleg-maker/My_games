# Duo-Master

Jeu de quiz à deux tirages. Le serveur tire au sort deux valeurs (par exemple deux types Pokémon),
les joueurs cherchent une réponse qui correspond, l'arbitre désigne le vainqueur du point.
Premier à atteindre le nombre de points choisi (3 à 20) : partie gagnée.

Aucune dépendance : Node.js 16 ou plus suffit.

## Lancer

```bash
node server.js        # ou : npm start
```

Ouvrir ensuite http://localhost:13000 (port modifiable : `PORT=8080 node server.js`).

| Page | Rôle |
| --- | --- |
| `/` ou `/arbitre` | Arbitre : lance le tirage, voit les réponses, attribue / retire les points, règle la partie. Suffit pour jouer sur **un seul écran**. |
| `/joueur1` … `/joueur6` | Page d'un joueur : points en haut, tirage en direct (défilement de 2 s), scores des autres. |
| `/ecran` | Écran commun (TV, vidéoprojecteur) : tirage en grand + tous les scores. |

Au démarrage, le terminal affiche aussi les adresses réseau (`http://192.168.x.x:13000/joueur1`)
à ouvrir depuis les téléphones connectés au même Wi-Fi.

## Déroulé d'une partie

1. **Réglages de la partie** (page arbitre) : thème, points pour gagner (3–20), nombre de joueurs (2–6), noms.
   Les noms, le thème, l'objectif et les scores sont conservés dans `data/state.json` (même après un redémarrage).
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

## Structure

```
server.js            serveur HTTP + temps réel (Server-Sent Events) + API
public/              pages et scripts du navigateur
themes/              thèmes (JSON) — à éditer / compléter
tools/               générateur du thème Pokémon (facultatif)
data/state.json      noms, scores, réglages (créé automatiquement)
```
