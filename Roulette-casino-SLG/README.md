# 🎰 Roulette-casino-SLG — Roulette multi-joueurs

Simulation de roulette de casino : un ecran "Maitre du jeu" et un ecran par
joueur (sur des appareils/onglets separes). Chaque groupe joue dans son propre
**salon** : autant de parties separees que l'on veut, en meme temps, sur le
meme serveur (voir "Salons" ci-dessous).

## Installation

Il faut [Node.js](https://nodejs.org/) installe (version 18 ou plus).

```bash
cd Roulette-casino-SLG
npm install
npm start
```

Le serveur demarre sur **http://localhost:7777** (page d'accueil : creer ou
rejoindre un salon).

### Sous Windows

Un raccourci `Lancer_Roulette.bat` est fourni : double-cliquez dessus pour
installer les dependances (au premier lancement), demarrer le serveur et
ouvrir automatiquement la page d'accueil dans le navigateur. Gardez la
fenetre noire ouverte pendant la partie ; fermez-la pour arreter le serveur.

## Utilisation

1. Sur l'ordinateur du maitre du jeu, ouvrez **http://localhost:7777/** et
   cliquez sur **Creer un salon** : vous arrivez sur la table du maitre
   (`/K7QF`, le code change a chaque salon). En haut de la page, un encart
   donne le code du salon, le lien d'invitation et un **QR code** ; l'adresse
   reseau du serveur (ex: `192.168.1.20`) est detectee automatiquement.
2. Indiquez le nombre de joueurs, leur nom et leur mise de depart (vous pouvez
   recuperer le solde sauvegarde d'une partie precedente via "Charger solde"),
   puis cliquez sur **Demarrer la partie**. Des liens apparaissent, un par
   joueur (`/K7QF/joueur1`, `/K7QF/joueur2`...).
3. Les joueurs rejoignent le salon de l'une de ces facons : scanner le **QR
   code**, ouvrir le lien d'invitation `/K7QF/rejoindre`, ou taper le code sur
   la page d'accueil. Ils touchent ensuite leur siege (leur nom) pour ouvrir
   leur ecran. Le maitre peut aussi leur envoyer directement le lien de leur
   ecran.
4. (Reseau local) tous les appareils doivent etre sur le meme Wi-Fi.
5. Chaque joueur choisit un jeton (1, 2, 5, 10, 25 ou 50 €) puis clique sur la
   table pour miser : numero plein, cheval (y compris 0-1, 0-2, 0-3), trio
   (0-1-2 ou 0-2-3), transversale simple/double, carre, tiers, colonne,
   rouge/noir, pair/impair, manque/passe. Toutes ces mises peuvent se cumuler
   librement (sauf les paires opposees Rouge/Noir, Pair/Impair et
   Manque/Passe, qui s'excluent mutuellement). Le jeton pose affiche la somme
   misee a cet endroit ; chaque numero couvert affiche en plus, en bas de
   case, le gain total potentiel cumule si ce numero sort (toutes mises
   confondues). Pour retirer une mise precise, cliquez sur la gomme (elle se
   selectionne comme un jeton) puis sur la case a annuler. La corbeille 🗑️ a
   cote de la gomme retire toutes les mises d'un coup. Le bouton
   "🔁 Mise similaire" repose exactement les memes mises que celles du tour
   precedent (pratique pour rejouer une strategie sans tout re-cliquer). Le
   panneau "📊 Statistiques" affiche, sur les 200 derniers tirages : un
   **cadran radial** ou chaque numero a une barre qui depasse plus ou moins
   loin selon son nombre de sorties, coloree par quart (bleu = numeros les
   moins sortis, vert, orange, puis rouge = numeros les plus sortis) ; les 5
   chiffres les plus et les moins sortis avec leur nombre exact de sorties ;
   ainsi que la repartition en pourcentage rouge/noir, pair/impair et tiers.
   Ces memes statistiques sont egalement affichees en permanence sur la
   table du maitre du jeu.
6. Quand le maitre du jeu clique sur **Lancer le tirage**, la roue tourne 3
   secondes puis le numero gagnant s'affiche en grand au premier plan sur
   l'ecran de chaque joueur pendant 3 secondes, avec le gain juste en dessous
   si le joueur a gagne quelque chose sur ce tour.

## Salons

Chaque salon est identifie par un **code court** (ex. `K7QF`) et contient une
partie complete et **independante** : ses joueurs, ses tirages, ses
statistiques, son mode automatique et ses sauvegardes. Plusieurs salons
peuvent tourner en meme temps sans se gener.

| Adresse | Page |
|---|---|
| `/` | Accueil : creer un salon, rejoindre avec un code, salons recents |
| `/K7QF` | Table du maitre du salon |
| `/K7QF/rejoindre` | Invitation (lien / QR code) : code pre-rempli, choix du siege |
| `/K7QF/joueur2` | Ecran du joueur 2 |

- **Code choisi** : sur l'accueil, "Choisir mon propre code" (3 a 10 lettres
  ou chiffres, ex. `FAMILLE`) pour retrouver le meme salon d'une fois sur
  l'autre. Un code deja utilise par un salon en cours est refuse.
- **Sauvegardes par salon** : les soldes, historiques et parties sauvegardes
  sont rangees dans `data/salons/<CODE>/`. Un autre salon ne les voit pas, et
  en recreant un salon avec le meme code on les retrouve.
- **Menage automatique** : un salon sans aucune page ouverte depuis 6 heures
  est supprime de la memoire (ses sauvegardes sur disque restent). Si plus
  personne n'est connecte quand un tirage automatique devait avoir lieu, le
  mode automatique est mis en pause.
- **Salons recents** : l'accueil garde la liste des salons ouverts sur
  l'appareil (maitre ou joueur), un clic pour y retourner.
- **Anciennes sauvegardes** : si vous venez d'une version sans salons, vos
  anciens fichiers (`data/joueurs.txt`, `data/parties/`) sont deplaces au
  demarrage dans le salon `PRINCIPAL` : creez un salon avec ce code pour les
  retrouver.
- Les anciennes adresses `/maitre.html` et `/joueurN.html` redirigent vers
  l'accueil.
- **Acces** : le code du salon donne acces a sa page maitre (`/CODE`). Ne le
  communiquez qu'aux participants ; les joueurs n'ont besoin que du lien
  `/CODE/rejoindre` ou de leur ecran `/CODE/joueurN`.

### Hebergement (Render...)

Lancement : `npm start` (ou `node server.js`) ; le port est lu dans la
variable `PORT`. Les parties vivent **en memoire** : si le service se met en
veille (plan gratuit) ou redemarre, les parties en cours disparaissent. La
page du maitre propose alors **"Recreer le salon avec le meme code"**, et les
ecrans des joueurs se reconnectent tout seuls. Les sauvegardes sur disque ne
survivent que si le disque est persistant : sur Render, ajoutez un disque
persistant et definissez la variable `DATA_DIR` (ex. `/var/data`) ; sans
disque, les sauvegardes sont perdues a chaque redeploiement.

## Mode automatique

Sur la table du maitre, activez la case **"Mode automatique"** et choisissez
un intervalle (10, 20 ou 30 secondes) : un tirage se declenche alors tout
seul a intervalle regulier, sans avoir a cliquer sur "Lancer le tirage". Un
minuteur affiche le decompte avant le prochain tirage automatique, aussi
bien sur la table du maitre que sur chaque ecran joueur. Le maitre peut a
tout moment declencher un tirage manuel en pleine attente automatique — le
minuteur redemarre alors simplement a zero pour le prochain tirage.

## Sauvegarde des soldes et de l'historique (par joueur)

(Toutes les sauvegardes decrites ci-dessous sont propres au salon courant.)

A tout moment (et automatiquement propose quand le solde atteint 0€), un
joueur peut cliquer sur **Sauvegarder & quitter**. Son nom, son solde et ses
**25 dernieres parties jouees** (numero sorti, mise, gain, perte nette) sont
enregistres dans `data/salons/<CODE>/joueurs.txt`. Le maitre du jeu peut ensuite recharger
ce solde et cet historique pour une prochaine partie en tapant le meme nom et
en cliquant sur "Charger solde" — l'historique continue alors de s'accumuler
(toujours plafonne aux 25 parties les plus recentes).

## Sauvegarder et reprendre une partie entiere (tous les joueurs + tirages)

Contrairement a la sauvegarde individuelle ci-dessus, cette fonction
sauvegarde **la partie complete en une fois** : le solde et l'historique de
chaque joueur a la table, ainsi que la sequence exacte des numeros deja
sortis (utilisee pour les statistiques chauds/froids et les pourcentages
rouge/noir, pair/impair, tiers).

- **Pour sauvegarder** : sur la table du maitre, une fois la partie en cours,
  donnez un nom (optionnel) a la sauvegarde puis cliquez sur
  **"💾 Sauvegarder la partie"**. Un fichier est cree dans
  `data/salons/<CODE>/parties/`.
- **Pour reprendre** : au demarrage de l'application (ou en revenant a
  l'ecran d'accueil), un encart **"Reprendre une partie sauvegardee"**
  liste toutes les sauvegardes disponibles avec leur date, le nombre de
  joueurs et de tirages memorises. Cliquez sur **"Charger"** pour reprendre
  exactement ou vous en etiez — soldes et statistiques inclus — sans avoir a
  ressaisir les joueurs un par un.
- **Pour supprimer** : dans ce meme encart, cliquez sur **"Supprimer"** a
  cote de la sauvegarde a effacer definitivement. Une confirmation est
  demandee avant suppression.

## Supprimer une sauvegarde

Deux facons de supprimer des sauvegardes :

**Depuis l'application** (recommande) :
- Les *parties completes* sauvegardees se suppriment via le bouton
  **"Supprimer"** de l'encart "Reprendre une partie sauvegardee" (voir
  ci-dessus).
- Les *soldes individuels* sauvegardes (via "Sauvegarder & quitter" cote
  joueur) apparaissent dans un encart **"Soldes joueurs sauvegardes"** sur
  l'ecran d'accueil du maitre, avec un bouton **"Supprimer"** pour chacun.

**Manuellement, en editant les fichiers** (si besoin, ou hors ligne) :
- Les parties completes sont dans `data/salons/<CODE>/parties/` — supprimez
  le(s) fichier(s) `.json` voulu(s).
- Les soldes individuels sont dans `data/salons/<CODE>/joueurs.txt` — ouvrez
  ce fichier texte et supprimez la ou les lignes du joueur concerne.

Sous Termux :
```bash
cd ~/Roulette-casino-SLG/data/salons/K7QF
rm parties/partie-XXXXXXXXXX.json   # une sauvegarde de partie precise
nano joueurs.txt                     # puis supprimez la ligne voulue
```

## Ajouter un joueur en cours de partie

A tout moment pendant une partie — y compris juste apres avoir recharge une
partie sauvegardee — le maitre du jeu peut ajouter un nouveau joueur sans
tout redemarrer. Dans la carte "Joueurs a la table", indiquez son nom et sa
mise de depart (ou recuperez son solde sauvegarde via "Charger solde")
puis cliquez sur **"+ Ajouter un joueur"**. Un nouveau lien d'ecran joueur
apparait automatiquement, et le nouveau joueur profite immediatement des
memes statistiques (numeros deja tires, chauds/froids, pourcentages) que
le reste de la table, puisque ces statistiques sont communes a toute la
partie et non propres a chaque joueur.

## Recharger un joueur a sec

Si un joueur n'a plus d'argent en cours de partie, le maitre du jeu peut a
tout moment lui redonner une somme depuis le tableau "Joueurs a la table" :
indiquez un montant dans le champ a cote de son nom puis cliquez sur
**"+ Ajouter"**. Le solde du joueur est mis a jour instantanement sur son
ecran.

## Regles de mise (roulette europeenne, 0 a 36)

| Mise                            | Gain (mise rendue incluse) |
|----------------------------------|----------------------------|
| Numero plein                    | x36                        |
| Cheval (2 numeros adjacents, y compris 0-1, 0-2, 0-3) | x18   |
| Trio (0-1-2 ou 0-2-3)           | x12                        |
| Transversale simple (3 numeros) | x12                        |
| Carre (4 numeros adjacents)     | x9                         |
| Transversale double (6 numeros) | x6                         |
| Colonne / Tiers (12 numeros)    | x3                         |
| Rouge / Noir, Pair / Impair, Manque / Passe | x2             |
