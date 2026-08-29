# Sphere Break

Clone jouable du mini-jeu Sphere Break de Final Fantasy X-2, avec grille 4x4,
système de combo, échelle de 15 croupiers, et sauvegarde/import/export des
statistiques.

## Lancer le jeu

Aucune dépendance à installer (le serveur utilise uniquement les modules
natifs de Node).

```bash
node server.js
```

Puis ouvre **http://localhost:10200** (PC comme tablette/Termux).

Pour changer de port ponctuellement :
```bash
PORT=8020 node server.js
```

## Déroulement d'une partie

1. **Choix du croupier** : 15 paliers de difficulté croissante (tours max,
   temps par tour, quota).
   - Croupiers 1 à 11 (facile à 4★) : débloqués via **une seule** des deux
     conditions — victoires minimum **OU** ratio minimum.
   - Croupiers 12 à 15 (les 4 plus forts, 4-5★) : débloqués seulement si
     **les deux** conditions sont vraies en même temps (ex. le dernier palier
     demande 100 victoires **ET** plus de 80% de ratio).
2. **Choix des 4 jetons d'entrée** (orange) : 4 valeurs distinctes de 1 à 9.
   Ils restent disponibles toute la manche, jamais consommés.
3. **La partie** : plateau 4x4 (4 jetons orange au centre, 12 jetons bleus
   autour). Chaque tour, un nombre de Core Sphere (1-9) est tiré. Sélectionne
   au moins un jeton orange et des jetons bleus jusqu'à obtenir une somme
   multiple exact du nombre tiré : le tour se valide **automatiquement**, pas
   besoin de bouton de confirmation.

## Règles de résolution d'un tour

- Les jetons bleus utilisés disparaissent (1s), les jetons bleus restants
  vieillissent de +1 avec un effet de scintillement (0,5s) — s'ils étaient
  déjà à 9, ils sont retirés au lieu de passer à 10.
- Un jeton vidé depuis au moins 2 tours a 55% de chance de réapparaître à
  chaque tour suivant (pas de remplissage automatique garanti).
- **Défaite immédiate** si tous les jetons disponibles sont sélectionnés sans
  que la somme soit un multiple valide.
- Le quota du croupier doit être atteint avant d'épuiser les tours pour
  gagner. Si le temps imparti à un tour s'écoule sans validation, la manche
  est immédiatement perdue (fidèle à la difficulté du jeu original).

## Règles de Combo (cumulables)

Deux règles de Combo indépendantes, activables séparément (au moins une doit
rester active) depuis le menu principal :

- **Combo Multiple** : le combo augmente quand le **multiplicateur obtenu**
  (somme ÷ Core Sphere) est identique au tour validé précédent, quel que soit
  le Core Sphere tiré. Ex. 15÷5=×3 puis 24÷8=×3 → Combo passe à 2.
- **Combo Jetons** : le combo augmente quand le **nombre total de jetons
  validés** (oranges + bleus) est identique au tour précédent. Les jetons
  oranges comptent dans ce total, mais rapportent toujours 0 au quota.

Si les deux règles sont actives en même temps, elles se **cumulent par
multiplication** : `quota gagné = jetons bleus utilisés × Combo Multiple ×
Combo Jetons`. Certains croupiers **imposent** leur propre règle (indiqué sur
leur carte), non modifiable pour cette manche.

## Monnaie : les Gils

- Un joueur commence avec **1000 Gils**, sauvegardés dans `data/stats.json`
  (et dans les fichiers `.txt` importés/exportés).
- Chaque croupier vaincu rapporte des Gils, de plus en plus élevés avec la
  difficulté (de 50 G pour le premier croupier jusqu'à 715 G pour le
  dernier).
- Les Gils servent à financer la **réduction partielle** des statistiques
  (voir ci-dessous) : 200 G par point de victoires/défaites soustrait.

## Sauvegarde des statistiques

- Persistées côté serveur dans `data/stats.json` (nom du joueur, victoires,
  défaites, Gils, meilleur quota atteint, série en cours, historique des 25
  dernières manches).
- **Importer** un fichier `.txt` (bouton "Profil / Sauvegarde") au format :
  ```
  nom=Sofu
  victoires=25
  defaites=10
  gils=1000
  ```
- **Exporter** la sauvegarde actuelle au même format.
- **Réduction partielle** : soustraire un même nombre aux victoires ET aux
  défaites (ex. 25V/10D avec "10" → 15V/0D), au coût de 200 Gils par point.
  Le nombre ne peut jamais dépasser le nombre de défaites actuelles (le
  serveur rejette la demande sinon), ni dépasser les Gils disponibles.
- **Réinitialisation complète** disponible également (avec confirmation).

## Fichiers

- `server.js` — serveur HTTP natif (pas de dépendance), sert les fichiers
  statiques et l'API de stats.
- `public/js/dealers.js` — les 15 croupiers et la logique de déblocage.
- `public/js/solver.js` — recherche exhaustive utilisée uniquement par le
  bouton "Indice" (ne joue jamais à la place du joueur).
- `public/js/game.js` — moteur de jeu (tours, combo, vieillissement,
  réapparition) et contrôleur des écrans (croupier / jetons / partie).
