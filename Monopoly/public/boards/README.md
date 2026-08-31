# Créer votre propre plateau

Ajoutez un fichier `.json` dans ce dossier : il apparaîtra automatiquement dans la liste des plateaux
disponibles sur l'écran de création de partie (redémarrez le serveur après ajout).

## Structure attendue

```json
{
  "name": "Nom affiché dans le menu",
  "groupColors": { "brown": "#8B4513", "...": "#......" },
  "spaces": [ /* exactement 40 cases, id 0 à 39, dans l'ordre du plateau (sens anti-horaire) */ ],
  "chanceCards": [ /* cartes Chance */ ],
  "chestCards": [ /* cartes Caisse de Communauté */ ]
}
```

## Cases (`spaces`)

Chaque case a un `id` (0 à 39) et un `type` :

| type          | Champs requis                                    | Exemple de case                   |
|---------------|---------------------------------------------------|------------------------------------|
| `go`          | —                                                  | Départ (id 0, obligatoire)         |
| `property`    | `group`, `price`, `rent` (6 valeurs), `houseCost`  | Terrain constructible              |
| `railroad`    | `price`                                            | Gare                                |
| `utility`     | `price`                                            | Compagnie                           |
| `tax`         | `amount`                                           | Case impôts                         |
| `chance`      | —                                                   | Pioche une carte Chance            |
| `chest`       | —                                                   | Pioche une carte Caisse Communauté |
| `jail`        | —                                                   | Prison / simple visite (id 10)     |
| `freeparking` | —                                                   | Parc gratuit (id 20)                |
| `gotojail`    | —                                                   | Allez en prison (id 30)             |

`rent` contient 6 valeurs : loyer nu, puis avec 1, 2, 3, 4 maisons, puis hôtel.

## Cartes (`chanceCards` / `chestCards`)

Chaque carte a un `text` et une `action` :

| action           | Champs additionnels     | Effet                                              |
|-------------------|--------------------------|-----------------------------------------------------|
| `goto`            | `value` (id case), `collectGo` (bool, défaut true) | Déplace vers une case précise           |
| `move`            | `value` (relatif, ex -3) | Avance/recule de N cases                            |
| `pay` / `collect` | `value`                  | Paie / reçoit un montant fixe                        |
| `payeach` / `collecteach` | `value`           | Paie/reçoit ce montant de chaque autre joueur         |
| `jail`            | —                        | Envoie en prison                                     |
| `getoutofjail`    | —                        | Donne une carte de sortie de prison                  |
| `repairs`         | `house`, `hotel`         | Paie selon le nombre de maisons/hôtels possédés       |
| `nearestrailroad` | —                        | Avance jusqu'à la gare la plus proche                |
| `nearestutility`  | —                        | Avance jusqu'à la compagnie la plus proche            |

Le nombre de cartes par paquet est libre (16 dans les sets fournis).
