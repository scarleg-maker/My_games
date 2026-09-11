# Vote_items

Site de vote multi-appareils : chaque participant note une liste d'items de 0 à 5 (par pas de 0,5). Une page « maître » sert à configurer la session et affiche les résultats (moyennes) en direct.

## Démarrage

Prérequis : [Node.js](https://nodejs.org/) installé sur l'ordinateur qui fera office de serveur.

```bash
cd vote-items
npm install   # uniquement si le dossier node_modules n'est pas déjà présent
node server.js
```

Le serveur démarre sur le port **15000**.

## Utilisation

### 1. Page maître (organisateur)

Ouvrez `http://localhost:15000/` sur l'ordinateur qui héberge le serveur.

- Renseignez la liste des **participants** (un nom par ligne) et la liste des **items à voter** (un par ligne, 30 maximum).
- Cliquez sur **Créer / mettre à jour la session**.
- Un lien de vote est généré pour chaque participant : `/joueur1`, `/joueur2`, `/joueur3`, etc. (dans l'ordre où les noms ont été saisis).
- La page maître affiche en direct la progression de chacun (nombre d'items votés, statut validé ou non) et le tableau des moyennes par item.
- Une fois **tous** les participants validés, un bandeau confirme que les résultats sont définitifs.
- Le tableau des résultats met automatiquement en **surbrillance verte** les 8 items ayant les meilleures moyennes, et en **surbrillance jaune** les 9ᵉ et 10ᵉ meilleures moyennes.
- Un bouton **Déverrouiller** permet de rouvrir le vote d'un participant qui aurait déjà validé (en cas d'erreur).
- **Réinitialiser toute la session** efface participants, items et votes pour repartir de zéro.
- **Modifier la configuration** (ajouter/retirer un participant ou un item) conserve automatiquement les votes déjà saisis pour tout participant et tout item dont le nom n'a pas changé — seuls les votes liés à un item ou un participant supprimé (ou renommé) sont perdus. Si tous les votes d'un participant restaient complets après la modification et qu'il avait déjà validé, sa validation est conservée ; sinon elle repasse "en cours".

### 2. Pages de vote (participants)

Chaque participant ouvre son lien personnel, par exemple :

```
http://<adresse-IP-du-serveur>:15000/joueur1
http://<adresse-IP-du-serveur>:15000/joueur2
```

- Pour voter depuis un **autre appareil** (téléphone, tablette, autre ordinateur) sur le même réseau Wi-Fi/local, remplacez `localhost` par l'adresse IP locale de l'ordinateur serveur (affichée dans le terminal au démarrage, ou trouvable via `ipconfig` / `ifconfig`).
- Chaque item se note avec le curseur (glissière) entre 0 et 5, par pas de 0,5.
- Les votes sont **sauvegardés automatiquement** à chaque changement — vous pouvez fermer l'onglet et reprendre plus tard, votre progression est conservée sur le serveur. Le bouton **💾 Sauvegarder** confirme simplement que tout est bien enregistré.
- Il est possible de **modifier n'importe quel vote** tant que la session n'a pas été validée.
- Le bouton **✅ Valider (fin de session)** ne devient actif que lorsque tous les items ont été notés. Une fois validé, les votes de ce participant sont verrouillés (sauf déverrouillage par l'organisateur).

## Sauvegarde des données

Toutes les données (configuration + votes) sont stockées dans le fichier `data/state.json`. Ce fichier persiste tant que vous ne cliquez pas sur « Réinitialiser » — vous pouvez donc arrêter puis relancer le serveur (`node server.js`) à tout moment, la session reprend exactement où elle en était.

## Accès multi-appareils sur un même réseau

Le serveur écoute sur toutes les interfaces réseau (`0.0.0.0:15000`). Pour que d'autres appareils du même réseau local puissent voter :

1. Trouvez l'adresse IP locale de l'ordinateur qui héberge le serveur (ex. `192.168.1.23`).
2. Sur chaque appareil, ouvrez `http://192.168.1.23:15000/joueurN` (en remplaçant l'IP et le numéro).
3. Vérifiez que le pare-feu de l'ordinateur serveur autorise les connexions entrantes sur le port 15000.
