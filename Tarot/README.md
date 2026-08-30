# Le Grand Chelem — Tarot français en ligne (3 à 5 joueurs)

Application Node.js (Express + Socket.io) pour jouer au Tarot français en temps réel, à 3, 4 ou 5 joueurs, sur navigateur (ordinateur ou mobile).

## Installation et lancement

```bash
npm install
npm start
```

Puis ouvrez `http://localhost:3000` dans un navigateur. Chaque joueur ouvre l'URL du serveur (donc, pour jouer entre plusieurs appareils sur le même réseau, remplacez `localhost` par l'adresse IP locale de la machine qui héberge, ex. `http://192.168.1.20:3000`).

## Héberger le site pour y jouer à distance

Ce n'est pas un site déjà hébergé en ligne — c'est le code source complet que vous devez déployer vous-même. Options simples et gratuites/peu chères :

- **Render.com** ou **Railway.app** : créez un service "Web Service" Node.js, connectez ce dossier (via un repo Git), commande de build `npm install`, commande de démarrage `npm start`. Le port est lu depuis `process.env.PORT`, déjà géré dans `server.js`.
- **Fly.io** ou une **VPS** (ex. Hetzner, OVH) : `git clone` le projet, `npm install`, puis lancez avec `npm start` (idéalement derrière `pm2` ou un service `systemd`, avec un reverse-proxy Nginx + certificat HTTPS via Let's Encrypt).
- **En LAN uniquement** (ex. entre amis dans la même maison) : lancez simplement `npm start` sur un ordinateur, les autres se connectent à son IP locale.

## Règles implémentées

- 78 cartes (4 couleurs de 1 à Roi + 21 atouts + l'Excuse), distribution automatique selon le nombre de joueurs (18/24/15 cartes en main, chien de 6/6/3 cartes).
- Enchères complètes : Petite, Garde, Garde Sans le chien, Garde Contre le chien, Passe (un tour, dans l'ordre à gauche du donneur).
- Chien : composition de l'écart pour Petite/Garde (bouts et rois protégés autant que possible) ; chien caché ajouté/retiré automatiquement pour Garde Sans/Garde Contre.
- Appel du roi à 5 joueurs (formation d'une équipe attaque/défense) ; si le preneur détient les 4 rois, il joue seul.
- Poignées (simple/double/triple) avec seuils adaptés au nombre de joueurs, chelem annoncé ou non, petit au bout — tout est intégré au calcul du score.
- Règles de jeu des plis : obligation de fournir la couleur demandée, obligation de couper puis de surcouper si possible, gestion complète de l'Excuse (jouable à tout moment, rendue à son camp sauf au dernier pli).
- Calcul de score officiel (seuils 56/51/41/36, multiplicateurs ×1/×2/×4/×6, répartition des gains/pertes entre preneur, partenaire éventuel et défenseurs).

### Simplifications assumées
- Le partenaire appelé à 5 joueurs est révélé à toute la table dès l'appel (et non seulement lorsque le roi est joué), pour simplifier l'interface.
- L'écart du preneur ne peut jamais contenir un bout ; un roi ou un atout n'est autorisé dans l'écart que si le preneur n'a pas assez d'autres cartes.

## Structure du projet

```
server.js        Serveur Express + Socket.io (salons, relais des actions)
lib/deck.js       Création du jeu de 78 cartes, valeurs de points
lib/rules.js      Configuration par nombre de joueurs, coups légaux, résolution des plis
lib/game.js       Machine à états d'une partie (enchères → chien → appel → poignées → jeu → score)
public/           Interface web (HTML/CSS/JS, table animée façon tapis vert)
```

## Joueurs IA

Dans la salle d'attente, cliquez sur un emplacement vide pour y ajouter un joueur IA (robot). Cliquez sur le nom d'une IA déjà ajoutée pour la retirer. Une fois la table complète (humains + IA), n'importe quel joueur peut lancer la distribution.

Les IA :
- enchérissent selon la force estimée de leur main (atouts, bouts, rois, dames) ;
- composent un écart raisonnable au chien (jamais de bout) ;
- appellent un roi cohérent à 5 joueurs ;
- déclarent une poignée si leur main le permet, puis se déclarent prêtes ;
- jouent en respectant toujours les règles (fournir la couleur, couper, sur-couper), en essayant de gagner à moindre coût ou de se défausser intelligemment sinon.

Elles jouent avec un léger délai (~0,6 à 1,3 s) pour rester lisibles à l'écran.

## Niveau des IA

Dans la salle d'attente, un sélecteur **Débutant / Confirmé / Expert** règle le niveau de jeu de toutes les IA de la table (modifiable tant que la partie n'a pas commencé). Différences concrètes :

| | Débutant | Confirmé | Expert |
|---|---|---|---|
| Enchères | Très imprécises (sur- ou sous-évalue largement sa main) | Estimation raisonnable avec un peu d'aléa | Estimation précise, valorise mieux les bouts |
| Écart au chien | Cartes sûres choisies au hasard | Écarte les cartes les moins fortes | Écarte en plus en visant à se "vider" d'une couleur |
| Poignées | Les oublie parfois (~45% du temps) | Toujours déclarées si possible | Toujours déclarées si possible |
| Annonce du chelem | Jamais | Jamais | Si la main est écrasante (quasi tout atout) |
| Jeu des plis | Coup légal choisi au hasard | Essaie de gagner à moindre coût / défausse intelligemment | Idem + entame par sa couleur la plus courte pour se couper plus vite |

Aucune IA ne "triche" en regardant les mains des autres joueurs : la différence de niveau vient uniquement de la qualité des heuristiques et de la précision d'évaluation.
