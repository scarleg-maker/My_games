# Minuteur Arbitre / Joueur — Serveur local (sans internet)

Ce dossier remplace Firebase par un petit serveur qui tourne **sur votre PC**
et synchronise les pages "Arbitre" et "Joueur" via votre réseau local, que
vous utilisiez un partage WiFi ou un câble USB. Aucune connexion internet
n'est nécessaire.

## Contenu du dossier

```
serveur-local/
  server.js          → le serveur (fichiers + synchronisation temps réel)
  package.json
  public/
    arbitre.html      → page à ouvrir sur la tablette/l'appareil arbitre
    joueur.html        → page à ouvrir sur le PC (celle du public)
    localsync.js       → remplace Firebase, ne pas modifier
    theme-configs.js
    Images/, Minut/    → vos images (à compléter si besoin)
```

## Installation (à faire une seule fois)

Il faut avoir [Node.js](https://nodejs.org) installé sur le PC.

1. Ouvrez un terminal dans le dossier `serveur-local`
2. Lancez :
   ```
   npm install
   ```

## Démarrage

Depuis le dossier `serveur-local` :
```
npm start
```
Le terminal affiche :
```
Serveur local démarré sur le port 3000
Sur ce PC       : http://localhost:3000/joueur.html
```

Laissez cette fenêtre de terminal ouverte tant que vous jouez.

## Sur le PC (page Joueur)

Ouvrez simplement dans un navigateur :
```
http://localhost:3000/joueur.html
```

## Sur la tablette (page Arbitre)

Il faut d'abord connecter la tablette et le PC sur **le même réseau local**,
puis ouvrir `http://<IP-du-PC>:3000/arbitre.html` dans le navigateur de la
tablette. L'IP à utiliser dépend du mode de partage choisi :

### Cas 1 — Hotspot WiFi
- Si c'est le **PC** qui crée le point d'accès WiFi : trouvez son IP avec
  `ipconfig` (Windows) dans la section de l'adaptateur WiFi partagé
  (souvent quelque chose comme `192.168.137.1`)
- Si c'est **le téléphone/la tablette** qui crée le hotspot et que le PC s'y
  connecte : l'IP du PC sera attribuée par le téléphone (vérifiable avec
  `ipconfig`, généralement en `192.168.43.x` ou `172.20.10.x`)

### Cas 2 — Câble USB (partage réseau USB)
- Branchez le câble, activez le partage de connexion USB sur l'appareil
  concerné
- Windows crée une interface réseau dédiée : faites `ipconfig` et cherchez
  l'adaptateur "Ethernet" ou "USB" qui vient d'apparaître — l'IP du PC y est
  indiquée (souvent en `192.168.x.x`)

### Dans les deux cas
Une fois l'IP trouvée, ouvrez sur la tablette :
```
http://<IP-trouvée>:3000/arbitre.html
```

**Vous n'avez rien à modifier dans le code** en changeant de mode de
connexion (WiFi ou USB) : la page s'adapte automatiquement à l'adresse
utilisée pour la charger.

## En cas de souci

- **La tablette n'arrive pas à se connecter** : vérifiez que le pare-feu
  Windows autorise Node.js sur le réseau (une fenêtre de confirmation
  apparaît en général au premier lancement — acceptez "Réseaux privés")
- **Le statut affiche "Déconnecté"** : vérifiez que le terminal du serveur
  est toujours ouvert et n'a pas été fermé
- **Ajouter vos propres images** : placez-les dans `public/Images/<thème>/`
  ou `public/Minut/Desserts/` selon la page concernée, comme avant
